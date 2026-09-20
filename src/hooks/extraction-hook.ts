/**
 * Extraction Hook
 *
 * Hook for triggering memory extraction after conversations.
 * Designed for integration with OpenClaw auto-reply dispatch.
 *
 * Usage (future OpenClaw integration):
 * ```typescript
 * import { createExtractionHook } from 'openclaw-memory/hooks';
 *
 * const memoryExtractionHook = createExtractionHook();
 *
 * // After agent response
 * await memoryExtractionHook.extract({
 *   userMessage,
 *   assistantResponse,
 *   project,
 * });
 * ```
 */

import { getMemorySystem, initMemorySystem } from "../memory-system.js";
import { getMemoryEventEmitter } from "../memory-events.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Extraction hook options
 */
export interface ExtractionHookOptions {
  /** Enable extraction (default: true) */
  enabled?: boolean;

  /** Minimum message length to extract (default: 50) */
  minLength?: number;

  /** Skip patterns (greetings, etc.) */
  skipPatterns?: RegExp[];

  /** Max concurrent extractions (default: 2) */
  concurrency?: number;

  /** Auto-initialize system (default: true) */
  autoInit?: boolean;

  /** Deduplication window in seconds (default: 300) */
  dedupeWindow?: number;
}

/**
 * Conversation input for extraction
 */
export interface ConversationInput {
  /** User's message */
  userMessage: string;

  /** Assistant's response */
  assistantResponse: string;

  /** Project context */
  project?: string;

  /** Conversation ID for deduplication */
  conversationId?: string;
}

/**
 * Extraction hook result
 */
export interface ExtractionHookResult {
  /** Whether extraction was queued */
  queued: boolean;

  /** Queue position (if queued) */
  queuePosition?: number;

  /** Reason if not queued */
  skipReason?: string;

  /** Estimated extraction time in ms */
  estimatedTime?: number;
}

/**
 * Queue status
 */
export interface QueueStatus {
  /** Pending extractions */
  pending: number;

  /** Currently processing */
  processing: number;

  /** Completed in session */
  completed: number;

  /** Failed in session */
  failed: number;
}

/**
 * Extraction hook metrics
 */
export interface ExtractionHookMetrics {
  /** Total conversations queued */
  totalQueued: number;

  /** Total completed extractions */
  totalCompleted: number;

  /** Total skipped (too short, patterns, etc.) */
  totalSkipped: number;

  /** Total failed extractions */
  totalFailed: number;

  /** Average extraction time in ms */
  averageExtractionTime: number;

  /** Total memories extracted */
  memoriesExtracted: number;
}

/**
 * Extraction hook interface
 */
export interface ExtractionHook {
  /**
   * Queue a conversation for extraction
   */
  extract(input: ConversationInput): Promise<ExtractionHookResult>;

  /**
   * Get current queue status
   */
  getQueueStatus(): QueueStatus;

  /**
   * Wait for all pending extractions
   */
  flush(): Promise<void>;

  /**
   * Get hook metrics
   */
  getMetrics(): ExtractionHookMetrics;

  /**
   * Reset metrics
   */
  resetMetrics(): void;

  /**
   * Check if extraction is enabled
   */
  isEnabled(): boolean;

  /**
   * Enable/disable extraction
   */
  setEnabled(enabled: boolean): void;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_SKIP_PATTERNS = [
  // Greetings
  /^(hi|hello|hey|thanks|thank you|bye|goodbye)\s*[!.?]*$/i,
  // Acknowledgments
  /^(ok|okay|sure|yes|no|got it|understood|makes sense)\s*[!.?]*$/i,
  // Single words
  /^\w+[!.?]*$/,
  // Very short responses
  /^.{1,20}$/,
];

// ============================================================================
// IMPLEMENTATION
// ============================================================================

class ExtractionHookImpl implements ExtractionHook {
  private options: Required<ExtractionHookOptions>;
  private metrics: ExtractionHookMetrics = {
    totalQueued: 0,
    totalCompleted: 0,
    totalSkipped: 0,
    totalFailed: 0,
    averageExtractionTime: 0,
    memoriesExtracted: 0,
  };
  private queueStatus: QueueStatus = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
  };
  private recentConversations: Map<string, number> = new Map();
  private totalExtractionTime = 0;
  private initialized = false;
  private emitter = getMemoryEventEmitter();

  constructor(options: ExtractionHookOptions = {}) {
    this.options = {
      enabled: options.enabled ?? true,
      minLength: options.minLength ?? 50,
      skipPatterns: options.skipPatterns ?? DEFAULT_SKIP_PATTERNS,
      concurrency: options.concurrency ?? 2,
      autoInit: options.autoInit ?? true,
      dedupeWindow: options.dedupeWindow ?? 300,
    };
  }

  async extract(input: ConversationInput): Promise<ExtractionHookResult> {
    // Check if enabled
    if (!this.options.enabled) {
      return {
        queued: false,
        skipReason: "Extraction is disabled",
      };
    }

    // Check minimum length
    const totalLength = input.userMessage.length + input.assistantResponse.length;
    if (totalLength < this.options.minLength) {
      this.metrics.totalSkipped++;
      return {
        queued: false,
        skipReason: `Message too short (${totalLength} < ${this.options.minLength})`,
      };
    }

    // Check skip patterns
    const skipReason = this.checkSkipPatterns(input);
    if (skipReason) {
      this.metrics.totalSkipped++;
      return {
        queued: false,
        skipReason,
      };
    }

    // Check deduplication
    const dedupeKey = this.getDedupeKey(input);
    const lastSeen = this.recentConversations.get(dedupeKey);
    if (lastSeen && Date.now() - lastSeen < this.options.dedupeWindow * 1000) {
      this.metrics.totalSkipped++;
      return {
        queued: false,
        skipReason: "Duplicate conversation",
      };
    }

    // Record for deduplication
    this.recentConversations.set(dedupeKey, Date.now());
    this.cleanupDedupeCache();

    try {
      // Initialize system if needed
      if (this.options.autoInit && !this.initialized) {
        await this.initialize();
      }

      // Format conversation text
      const conversationText = this.formatConversation(input);

      // Queue for extraction
      const system = getMemorySystem();
      await system.storeConversation(conversationText, input.project);

      this.metrics.totalQueued++;
      this.queueStatus.pending++;

      this.emitter.emitEvent("extraction:queued", {
        project: input.project,
        length: conversationText.length,
      });

      return {
        queued: true,
        queuePosition: this.queueStatus.pending,
        estimatedTime: 3000, // Rough estimate
      };
    } catch (error) {
      this.metrics.totalFailed++;
      this.queueStatus.failed++;

      this.emitter.emitEvent("extraction:failed", {
        error: error instanceof Error ? error.message : String(error),
      });

      // Return failure but don't throw - graceful degradation
      return {
        queued: false,
        skipReason: `Extraction failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  getQueueStatus(): QueueStatus {
    return { ...this.queueStatus };
  }

  async flush(): Promise<void> {
    // Wait for queue to drain
    // In a real implementation, this would wait for the extraction service
    while (this.queueStatus.pending > 0 || this.queueStatus.processing > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  getMetrics(): ExtractionHookMetrics {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = {
      totalQueued: 0,
      totalCompleted: 0,
      totalSkipped: 0,
      totalFailed: 0,
      averageExtractionTime: 0,
      memoriesExtracted: 0,
    };
    this.queueStatus = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    };
    this.totalExtractionTime = 0;
  }

  isEnabled(): boolean {
    return this.options.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.options.enabled = enabled;
  }

  private async initialize(): Promise<void> {
    try {
      await initMemorySystem({
        logLevel: "error",
      });
      this.initialized = true;
    } catch (error) {
      console.error("[ExtractionHook] Failed to initialize memory system:", error);
    }
  }

  private checkSkipPatterns(input: ConversationInput): string | null {
    for (const pattern of this.options.skipPatterns) {
      if (pattern.test(input.userMessage)) {
        return `User message matches skip pattern: ${pattern}`;
      }
      if (pattern.test(input.assistantResponse)) {
        return `Assistant response matches skip pattern: ${pattern}`;
      }
    }
    return null;
  }

  private formatConversation(input: ConversationInput): string {
    return `User: ${input.userMessage}\n\nAssistant: ${input.assistantResponse}`;
  }

  private getDedupeKey(input: ConversationInput): string {
    if (input.conversationId) {
      return input.conversationId;
    }

    // Hash the content
    const content = `${input.userMessage}:${input.assistantResponse}`;
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `conv:${hash}`;
  }

  private cleanupDedupeCache(): void {
    const cutoff = Date.now() - this.options.dedupeWindow * 1000;
    for (const [key, timestamp] of this.recentConversations) {
      if (timestamp < cutoff) {
        this.recentConversations.delete(key);
      }
    }
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create an extraction hook instance
 */
export function createExtractionHook(options?: ExtractionHookOptions): ExtractionHook {
  return new ExtractionHookImpl(options);
}

// ============================================================================
// SINGLETON
// ============================================================================

let defaultExtractionHook: ExtractionHook | null = null;

/**
 * Get the default extraction hook (singleton)
 */
export function getExtractionHook(): ExtractionHook {
  if (!defaultExtractionHook) {
    defaultExtractionHook = createExtractionHook();
  }
  return defaultExtractionHook;
}

/**
 * Initialize the default extraction hook with options
 */
export function initExtractionHook(options?: ExtractionHookOptions): ExtractionHook {
  defaultExtractionHook = createExtractionHook(options);
  return defaultExtractionHook;
}
