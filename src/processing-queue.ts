import { EventEmitter } from "events";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { ConversationTurn } from "./extraction-prompts.js";

/**
 * Status of a queue item
 */
export type QueueItemStatus = "pending" | "processing" | "completed" | "failed";

/**
 * Item in the processing queue
 */
export interface QueueItem {
  id: string;
  turns: ConversationTurn[];
  project?: string;
  addedAt: number;
  attempts: number;
  status: QueueItemStatus;
  lastError?: string;
  completedAt?: number;
}

/**
 * Queue statistics
 */
export interface QueueStatus {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  isProcessing: boolean;
  isPaused: boolean;
}

/**
 * Queue configuration
 */
export interface QueueConfig {
  persistPath?: string;
  concurrency?: number;
  maxRetries?: number;
  retryDelayBase?: number; // Base delay in ms for exponential backoff
  autoSave?: boolean;
}

/**
 * ProcessingQueue - Manages asynchronous extraction jobs with persistence
 *
 * Features:
 * - File-based persistence for crash recovery
 * - Configurable concurrency limit
 * - Event emitter for progress tracking
 * - Retry logic with exponential backoff
 * - Pause/resume capability
 */
export class ProcessingQueue extends EventEmitter {
  private items: Map<string, QueueItem>;
  private config: Required<QueueConfig>;
  private isProcessingActive: boolean = false;
  private isPausedState: boolean = false;
  private activeProcessing: Set<string> = new Set();
  private processingPromises: Set<Promise<void>> = new Set();

  constructor(config: QueueConfig = {}) {
    super();

    // Set up configuration with defaults
    const defaultPath = join(process.cwd(), ".openclaw", "queue.json");
    this.config = {
      persistPath: config.persistPath ?? defaultPath,
      concurrency: config.concurrency ?? 3,
      maxRetries: config.maxRetries ?? 3,
      retryDelayBase: config.retryDelayBase ?? 1000,
      autoSave: config.autoSave ?? true,
    };

    // Initialize queue
    this.items = new Map();

    // Ensure persist directory exists
    const persistDir = join(this.config.persistPath, "..");
    if (!existsSync(persistDir)) {
      mkdirSync(persistDir, { recursive: true });
    }

    // Load existing queue from disk
    this.load();
  }

  /**
   * Add an item to the queue
   * Non-blocking, returns immediately with item ID
   */
  add(turns: ConversationTurn[], project?: string): string {
    const id = this.generateId();

    const item: QueueItem = {
      id,
      turns,
      project,
      addedAt: Date.now(),
      attempts: 0,
      status: "pending",
    };

    this.items.set(id, item);
    this.save();

    this.emit("item:added", item);

    // Trigger processing if already running
    if (this.isProcessingActive && !this.isPausedState) {
      this.processNext();
    }

    return id;
  }

  /**
   * Start processing the queue
   * Processes items concurrently up to concurrency limit
   */
  async process(): Promise<void> {
    if (this.isProcessingActive) {
      console.warn("Queue is already processing");
      return;
    }

    this.isProcessingActive = true;
    this.isPausedState = false;
    this.emit("queue:started");

    // Start processing items
    await this.processLoop();

    this.emit("queue:completed");
  }

  /**
   * Main processing loop
   */
  private async processLoop(): Promise<void> {
    while (this.isProcessingActive && !this.isPausedState) {
      // Check if we have capacity for more processing
      if (this.activeProcessing.size < this.config.concurrency) {
        const nextItem = this.getNextPendingItem();

        if (nextItem) {
          // Start processing this item
          this.processItem(nextItem);
        } else if (this.activeProcessing.size === 0) {
          // No pending items and nothing processing, we're done
          break;
        } else {
          // Wait for some items to complete
          await this.waitForAnyCompletion();
        }
      } else {
        // At capacity, wait for something to complete
        await this.waitForAnyCompletion();
      }
    }

    // Wait for all active processing to complete
    await Promise.all(Array.from(this.processingPromises));
    this.isProcessingActive = false;
  }

  /**
   * Process the next available item
   */
  private processNext(): void {
    if (
      !this.isProcessingActive ||
      this.isPausedState ||
      this.activeProcessing.size >= this.config.concurrency
    ) {
      return;
    }

    const nextItem = this.getNextPendingItem();
    if (nextItem) {
      this.processItem(nextItem);
    }
  }

  /**
   * Process a single item
   */
  private processItem(item: QueueItem): void {
    this.activeProcessing.add(item.id);

    const promise = this.executeItem(item)
      .then(() => {
        this.activeProcessing.delete(item.id);
        this.processingPromises.delete(promise);
        this.processNext(); // Try to process another item
      })
      .catch((error) => {
        console.error(`Unexpected error processing item ${item.id}:`, error);
        this.activeProcessing.delete(item.id);
        this.processingPromises.delete(promise);
        this.processNext();
      });

    this.processingPromises.add(promise);
  }

  /**
   * Execute a single queue item with retry logic
   */
  private async executeItem(item: QueueItem): Promise<void> {
    // Update status to processing
    item.status = "processing";
    item.attempts++;
    this.save();
    this.emit("item:processing", item);

    try {
      // Emit event that allows external handlers to process the item
      // The handler should be registered via queue.on('item:execute', handler)
      const result = await this.emitAsync("item:execute", item);

      // If execution was successful
      item.status = "completed";
      item.completedAt = Date.now();
      delete item.lastError;
      this.save();
      this.emit("item:completed", item);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      item.lastError = errorMessage;

      // Check if we should retry
      if (item.attempts < this.config.maxRetries) {
        // Exponential backoff: base * 2^(attempts-1)
        const delay =
          this.config.retryDelayBase * Math.pow(2, item.attempts - 1);
        console.warn(
          `Item ${item.id} failed (attempt ${item.attempts}/${this.config.maxRetries}), retrying in ${delay}ms...`
        );

        item.status = "pending"; // Reset to pending for retry
        this.save();
        this.emit("item:retry", item, delay);

        // Schedule retry
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        // Max retries reached
        item.status = "failed";
        this.save();
        this.emit("item:failed", item, errorMessage);
      }
    }
  }

  /**
   * Emit async event and wait for handler
   */
  private async emitAsync(
    event: string,
    ...args: any[]
  ): Promise<any> {
    const listeners = this.listeners(event);
    if (listeners.length === 0) {
      throw new Error(`No handler registered for event: ${event}`);
    }

    // Call the first listener (should be the extraction handler)
    const handler = listeners[0];
    return await handler(...args);
  }

  /**
   * Wait for any active processing to complete
   */
  private async waitForAnyCompletion(): Promise<void> {
    if (this.processingPromises.size === 0) {
      return;
    }

    await Promise.race(Array.from(this.processingPromises));
  }

  /**
   * Get the next pending item to process
   */
  private getNextPendingItem(): QueueItem | null {
    for (const item of this.items.values()) {
      if (item.status === "pending" && !this.activeProcessing.has(item.id)) {
        return item;
      }
    }
    return null;
  }

  /**
   * Pause processing
   */
  pause(): void {
    if (!this.isProcessingActive) {
      console.warn("Queue is not processing");
      return;
    }

    this.isPausedState = true;
    this.emit("queue:paused");
  }

  /**
   * Resume processing
   */
  resume(): void {
    if (!this.isProcessingActive) {
      console.warn("Queue is not processing, use process() to start");
      return;
    }

    if (!this.isPausedState) {
      console.warn("Queue is not paused");
      return;
    }

    this.isPausedState = false;
    this.emit("queue:resumed");

    // Restart processing loop
    this.processLoop();
  }

  /**
   * Stop processing (waits for active items to complete)
   */
  async stop(): Promise<void> {
    if (!this.isProcessingActive) {
      return;
    }

    this.isProcessingActive = false;
    this.emit("queue:stopping");

    // Wait for active processing to complete
    await Promise.all(Array.from(this.processingPromises));

    this.emit("queue:stopped");
  }

  /**
   * Get queue status
   */
  getStatus(): QueueStatus {
    const statuses = Array.from(this.items.values());

    return {
      total: statuses.length,
      pending: statuses.filter((i) => i.status === "pending").length,
      processing: statuses.filter((i) => i.status === "processing").length,
      completed: statuses.filter((i) => i.status === "completed").length,
      failed: statuses.filter((i) => i.status === "failed").length,
      isProcessing: this.isProcessingActive,
      isPaused: this.isPausedState,
    };
  }

  /**
   * Get all items with specific status
   */
  getItems(status?: QueueItemStatus): QueueItem[] {
    const items = Array.from(this.items.values());
    if (status) {
      return items.filter((i) => i.status === status);
    }
    return items;
  }

  /**
   * Get a specific item by ID
   */
  getItem(id: string): QueueItem | undefined {
    return this.items.get(id);
  }

  /**
   * Clear completed items from queue
   */
  clearCompleted(): number {
    let cleared = 0;
    for (const [id, item] of this.items.entries()) {
      if (item.status === "completed") {
        this.items.delete(id);
        cleared++;
      }
    }

    if (cleared > 0) {
      this.save();
      this.emit("queue:cleared", cleared);
    }

    return cleared;
  }

  /**
   * Clear all items (useful for testing)
   */
  clear(): void {
    this.items.clear();
    this.save();
    this.emit("queue:cleared", "all");
  }

  /**
   * Save queue to disk
   */
  private save(): void {
    if (!this.config.autoSave) {
      return;
    }

    try {
      const data = {
        version: 1,
        savedAt: Date.now(),
        items: Array.from(this.items.values()),
      };

      writeFileSync(this.config.persistPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error("Failed to save queue:", error);
      this.emit("queue:save:error", error);
    }
  }

  /**
   * Load queue from disk
   */
  private load(): void {
    try {
      if (!existsSync(this.config.persistPath)) {
        return;
      }

      const content = readFileSync(this.config.persistPath, "utf-8");
      const data = JSON.parse(content);

      if (data.items && Array.isArray(data.items)) {
        for (const item of data.items) {
          // Reset processing items to pending on load
          if (item.status === "processing") {
            item.status = "pending";
          }
          this.items.set(item.id, item);
        }

        this.emit("queue:loaded", data.items.length);
      }
    } catch (error) {
      console.error("Failed to load queue:", error);
      this.emit("queue:load:error", error);
    }
  }

  /**
   * Generate unique item ID
   */
  private generateId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `qi_${timestamp}_${random}`;
  }

  /**
   * Force save (useful when autoSave is disabled)
   */
  saveNow(): void {
    const autoSave = this.config.autoSave;
    this.config.autoSave = true;
    this.save();
    this.config.autoSave = autoSave;
  }
}

/**
 * Factory function to create a processing queue with defaults
 */
export function createProcessingQueue(
  config?: QueueConfig
): ProcessingQueue {
  return new ProcessingQueue(config);
}
