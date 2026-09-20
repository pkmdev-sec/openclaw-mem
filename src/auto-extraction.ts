import { createHash } from "crypto";
import { ConversationTurn } from "./extraction-prompts.js";
import { ProcessingQueue, createProcessingQueue, QueueItem } from "./processing-queue.js";
import { ExtractionEngine } from "./extraction-engine.js";
import { LLMProvider } from "./llm-provider.js";

/**
 * Statistics for auto-extraction service
 */
export interface AutoExtractionStats {
  queued: number;
  processed: number;
  failed: number;
  memoriesCreated: number;
  duplicatesSkipped: number;
  uptime: number; // milliseconds
}

/**
 * Configuration for auto-extraction service
 */
export interface AutoExtractionConfig {
  provider: LLMProvider;
  queueConcurrency?: number;
  enableDeduplication?: boolean;
  autoStart?: boolean;
}

/**
 * AutoExtractionService - Singleton service for background memory extraction
 *
 * Features:
 * - Non-blocking enqueue (< 1ms)
 * - Hash-based deduplication
 * - Statistics tracking
 * - Singleton pattern for easy integration
 */
export class AutoExtractionService {
  private static instance: AutoExtractionService | null = null;

  private queue: ProcessingQueue;
  private engine: ExtractionEngine;
  private seenHashes: Set<string>;
  private stats: AutoExtractionStats;
  private startTime: number;
  private isRunning: boolean = false;
  private config: Required<AutoExtractionConfig>;

  private constructor(config: AutoExtractionConfig) {
    this.config = {
      provider: config.provider,
      queueConcurrency: config.queueConcurrency ?? 3,
      enableDeduplication: config.enableDeduplication ?? true,
      autoStart: config.autoStart ?? true,
    };

    // Initialize components
    this.engine = new ExtractionEngine({ provider: this.config.provider });
    this.queue = createProcessingQueue({
      concurrency: this.config.queueConcurrency,
    });
    this.seenHashes = new Set();

    // Initialize stats
    this.startTime = Date.now();
    this.stats = {
      queued: 0,
      processed: 0,
      failed: 0,
      memoriesCreated: 0,
      duplicatesSkipped: 0,
      uptime: 0,
    };

    // Load existing queue items into seen hashes
    this.loadExistingHashes();

    // Set up event handlers
    this.setupEventHandlers();

    // Auto-start if configured
    if (this.config.autoStart) {
      this.start();
    }
  }

  /**
   * Get singleton instance
   */
  static getInstance(config?: AutoExtractionConfig): AutoExtractionService {
    if (!AutoExtractionService.instance) {
      if (!config) {
        throw new Error(
          "AutoExtractionService not initialized. Provide config on first call."
        );
      }
      AutoExtractionService.instance = new AutoExtractionService(config);
    }
    return AutoExtractionService.instance;
  }

  /**
   * Reset singleton (useful for testing)
   */
  static reset(): void {
    if (AutoExtractionService.instance) {
      AutoExtractionService.instance.stop();
      AutoExtractionService.instance = null;
    }
  }

  /**
   * Check if instance exists
   */
  static hasInstance(): boolean {
    return AutoExtractionService.instance !== null;
  }

  /**
   * Load hashes from existing queue items to prevent duplicates
   */
  private loadExistingHashes(): void {
    // Only load if deduplication is enabled
    if (!this.config.enableDeduplication) {
      return;
    }

    const items = this.queue.getItems();
    for (const item of items) {
      const hash = this.hashConversation(item.turns);
      this.seenHashes.add(hash);
    }
  }

  /**
   * Set up event handlers for queue events
   */
  private setupEventHandlers(): void {
    // Handle item execution
    this.queue.on("item:execute", async (item: QueueItem) => {
      return await this.processItem(item);
    });

    // Track completed items
    this.queue.on("item:completed", (item: QueueItem) => {
      this.stats.processed++;
    });

    // Track failed items
    this.queue.on("item:failed", (item: QueueItem) => {
      this.stats.failed++;
    });

    // Clean up completed items periodically
    this.queue.on("item:completed", () => {
      // Every 10 completions, clear old completed items
      if (this.stats.processed % 10 === 0) {
        this.queue.clearCompleted();
      }
    });
  }

  /**
   * Process a single queue item
   */
  private async processItem(item: QueueItem): Promise<void> {
    try {
      const result = await this.engine.extractAndStore(item.turns, item.project);
      this.stats.memoriesCreated += result.stored;
    } catch (error) {
      console.error(`Failed to process item ${item.id}:`, error);
      throw error; // Re-throw to trigger retry logic
    }
  }

  /**
   * Enqueue conversation for extraction (non-blocking, < 1ms)
   */
  enqueue(turns: ConversationTurn[], project?: string): void {
    const startTime = Date.now();

    // Deduplication check
    if (this.config.enableDeduplication) {
      const hash = this.hashConversation(turns);

      if (this.seenHashes.has(hash)) {
        this.stats.duplicatesSkipped++;
        return; // Skip duplicate
      }

      this.seenHashes.add(hash);
    }

    // Add to queue (non-blocking)
    this.queue.add(turns, project);
    this.stats.queued++;

    const duration = Date.now() - startTime;

    // Warn if enqueue took too long
    if (duration > 1) {
      console.warn(`Enqueue took ${duration}ms (expected < 1ms)`);
    }
  }

  /**
   * Start the service (begin processing queue)
   */
  start(): void {
    if (this.isRunning) {
      console.warn("AutoExtractionService already running");
      return;
    }

    this.isRunning = true;
    this.startTime = Date.now();

    // Start processing queue
    this.queue.process().catch((error) => {
      console.error("Queue processing error:", error);
      this.isRunning = false;
    });

    console.log("AutoExtractionService started");
  }

  /**
   * Stop the service (wait for active items to complete)
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    await this.queue.stop();
    this.isRunning = false;

    console.log("AutoExtractionService stopped");
  }

  /**
   * Pause processing (can be resumed)
   */
  pause(): void {
    this.queue.pause();
  }

  /**
   * Resume processing
   */
  resume(): void {
    this.queue.resume();
  }

  /**
   * Flush all pending items (process immediately)
   */
  async flush(): Promise<void> {
    if (!this.isRunning) {
      this.start();
    }

    // Wait for queue to complete
    const checkInterval = 100; // Check every 100ms
    while (true) {
      const status = this.queue.getStatus();
      if (status.pending === 0 && status.processing === 0) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }
  }

  /**
   * Get current statistics
   */
  getStats(): AutoExtractionStats {
    const uptime = this.isRunning ? Date.now() - this.startTime : 0;

    return {
      ...this.stats,
      uptime,
    };
  }

  /**
   * Get queue status
   */
  getQueueStatus() {
    return this.queue.getStatus();
  }

  /**
   * Clear all completed items
   */
  clearCompleted(): number {
    return this.queue.clearCompleted();
  }

  /**
   * Reset statistics (useful for testing)
   */
  resetStats(): void {
    this.stats = {
      queued: 0,
      processed: 0,
      failed: 0,
      memoriesCreated: 0,
      duplicatesSkipped: 0,
      uptime: 0,
    };
    this.startTime = Date.now();
  }

  /**
   * Clear deduplication cache
   */
  clearDeduplicationCache(): void {
    this.seenHashes.clear();
  }

  /**
   * Hash a conversation for deduplication
   * Uses content-based hash that's consistent across identical conversations
   */
  private hashConversation(turns: ConversationTurn[]): string {
    // Create a stable string representation
    const content = turns
      .map((turn) => `${turn.role}:${turn.content}`)
      .join("|");

    // Hash using SHA-256
    return createHash("sha256").update(content).digest("hex");
  }

  /**
   * Get the underlying extraction engine (useful for testing)
   */
  getEngine(): ExtractionEngine {
    return this.engine;
  }

  /**
   * Get the underlying queue (useful for testing)
   */
  getQueue(): ProcessingQueue {
    return this.queue;
  }

  /**
   * Check if service is running
   */
  isActive(): boolean {
    return this.isRunning;
  }
}

/**
 * Initialize the auto-extraction service
 * Must be called once at application startup
 */
export function initAutoExtraction(
  config: AutoExtractionConfig
): AutoExtractionService {
  return AutoExtractionService.getInstance(config);
}

/**
 * Get the auto-extraction service instance
 * Throws if not initialized
 */
export function getAutoExtraction(): AutoExtractionService {
  return AutoExtractionService.getInstance();
}

/**
 * Convenience function to enqueue a conversation
 */
export function enqueueConversation(
  turns: ConversationTurn[],
  project?: string
): void {
  const service = AutoExtractionService.getInstance();
  service.enqueue(turns, project);
}

/**
 * Convenience function to enqueue a user/assistant pair
 */
export function enqueueUserAssistant(
  userMessage: string,
  assistantResponse: string,
  project?: string
): void {
  const turns: ConversationTurn[] = [
    { role: "user", content: userMessage },
    { role: "assistant", content: assistantResponse },
  ];

  enqueueConversation(turns, project);
}
