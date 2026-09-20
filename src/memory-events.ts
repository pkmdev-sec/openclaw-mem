/**
 * Memory Event System
 *
 * Event emitter for memory system operations.
 * Enables observability, metrics collection, and external integrations.
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Memory event types
 */
export type MemoryEventType =
  // System lifecycle
  | "system:initialized"
  | "system:shutdown"
  | "system:error"
  // Memory operations
  | "memory:created"
  | "memory:updated"
  | "memory:deleted"
  | "memory:searched"
  // Extraction
  | "extraction:queued"
  | "extraction:started"
  | "extraction:completed"
  | "extraction:failed"
  | "extraction:skipped"
  // Retrieval
  | "recall:started"
  | "recall:completed"
  | "recall:cached"
  // Sync
  | "sync:started"
  | "sync:completed"
  | "sync:conflict"
  | "sync:error"
  // Backup
  | "backup:created"
  | "backup:restored"
  | "backup:failed";

/**
 * Memory event data
 */
export interface MemoryEvent {
  /** Event type */
  type: MemoryEventType;

  /** Event timestamp */
  timestamp: Date;

  /** Event-specific data */
  data: Record<string, unknown>;

  /** Operation duration in ms (if applicable) */
  duration?: number;

  /** Error message (if applicable) */
  error?: string;
}

/**
 * Event handler function
 */
export type MemoryEventHandler = (event: MemoryEvent) => void;

/**
 * Metrics summary
 */
export interface MemoryMetrics {
  /** Total events emitted */
  totalEvents: number;

  /** Events by type */
  eventCounts: Record<string, number>;

  /** Average durations by operation type */
  averageDurations: Record<string, number>;

  /** Error count */
  errorCount: number;

  /** Uptime in ms */
  uptime: number;

  /** Start time */
  startTime: Date;
}

// ============================================================================
// EVENT EMITTER
// ============================================================================

/**
 * Memory Event Emitter
 *
 * Singleton event emitter for memory system observability.
 */
class MemoryEventEmitter {
  private handlers: Map<MemoryEventType | "*", Set<MemoryEventHandler>> = new Map();
  private eventCounts: Map<string, number> = new Map();
  private durations: Map<string, number[]> = new Map();
  private errorCount = 0;
  private startTime = new Date();
  private totalEvents = 0;

  /**
   * Subscribe to an event
   *
   * @param event Event type or "*" for all events
   * @param handler Handler function
   */
  on(event: MemoryEventType | "*", handler: MemoryEventHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  /**
   * Unsubscribe from an event
   */
  off(event: MemoryEventType | "*", handler: MemoryEventHandler): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * Subscribe to an event (one-time)
   */
  once(event: MemoryEventType | "*", handler: MemoryEventHandler): void {
    const wrappedHandler = (e: MemoryEvent) => {
      handler(e);
      this.off(event, wrappedHandler);
    };
    this.on(event, wrappedHandler);
  }

  /**
   * Emit an event
   */
  emit(event: MemoryEvent): void {
    // Update metrics
    this.totalEvents++;
    const count = this.eventCounts.get(event.type) || 0;
    this.eventCounts.set(event.type, count + 1);

    if (event.duration !== undefined) {
      const durations = this.durations.get(event.type) || [];
      durations.push(event.duration);
      // Keep last 100 durations for averaging
      if (durations.length > 100) {
        durations.shift();
      }
      this.durations.set(event.type, durations);
    }

    if (event.error) {
      this.errorCount++;
    }

    // Call specific handlers
    const handlers = this.handlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (error) {
          console.error(`Event handler error for ${event.type}:`, error);
        }
      }
    }

    // Call wildcard handlers
    const wildcardHandlers = this.handlers.get("*");
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        try {
          handler(event);
        } catch (error) {
          console.error("Wildcard event handler error:", error);
        }
      }
    }
  }

  /**
   * Create and emit an event
   */
  emitEvent(
    type: MemoryEventType,
    data: Record<string, unknown> = {},
    options?: { duration?: number; error?: string }
  ): void {
    this.emit({
      type,
      timestamp: new Date(),
      data,
      duration: options?.duration,
      error: options?.error,
    });
  }

  /**
   * Get metrics summary
   */
  getMetrics(): MemoryMetrics {
    const averageDurations: Record<string, number> = {};

    for (const [type, durations] of this.durations) {
      if (durations.length > 0) {
        const sum = durations.reduce((a, b) => a + b, 0);
        averageDurations[type] = Math.round(sum / durations.length);
      }
    }

    return {
      totalEvents: this.totalEvents,
      eventCounts: Object.fromEntries(this.eventCounts),
      averageDurations,
      errorCount: this.errorCount,
      uptime: Date.now() - this.startTime.getTime(),
      startTime: this.startTime,
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.eventCounts.clear();
    this.durations.clear();
    this.errorCount = 0;
    this.totalEvents = 0;
    this.startTime = new Date();
  }

  /**
   * Remove all handlers
   */
  removeAllHandlers(): void {
    this.handlers.clear();
  }

  /**
   * Get handler count for an event
   */
  listenerCount(event: MemoryEventType | "*"): number {
    return this.handlers.get(event)?.size || 0;
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let emitterInstance: MemoryEventEmitter | null = null;

/**
 * Get the memory event emitter singleton
 */
export function getMemoryEventEmitter(): MemoryEventEmitter {
  if (!emitterInstance) {
    emitterInstance = new MemoryEventEmitter();
  }
  return emitterInstance;
}

/**
 * Reset the event emitter (for testing)
 */
export function resetMemoryEventEmitter(): void {
  if (emitterInstance) {
    emitterInstance.removeAllHandlers();
    emitterInstance.resetMetrics();
  }
  emitterInstance = null;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a timer for measuring operation duration
 */
export function createTimer(): () => number {
  const start = Date.now();
  return () => Date.now() - start;
}

/**
 * Wrap an async function with event emission
 */
export function withEvents<T extends unknown[], R>(
  startEvent: MemoryEventType,
  completeEvent: MemoryEventType,
  failEvent: MemoryEventType,
  fn: (...args: T) => Promise<R>
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    const emitter = getMemoryEventEmitter();
    const timer = createTimer();

    emitter.emitEvent(startEvent, { args: args.length });

    try {
      const result = await fn(...args);
      emitter.emitEvent(completeEvent, { success: true }, { duration: timer() });
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      emitter.emitEvent(failEvent, { success: false }, { duration: timer(), error: errorMessage });
      throw error;
    }
  };
}

/**
 * Log event to console (for debugging)
 */
export function createConsoleLogger(
  filter?: (event: MemoryEvent) => boolean
): MemoryEventHandler {
  return (event: MemoryEvent) => {
    if (filter && !filter(event)) {
      return;
    }

    const prefix = event.error ? "❌" : "✅";
    const duration = event.duration !== undefined ? ` (${event.duration}ms)` : "";

    console.log(
      `${prefix} [${event.timestamp.toISOString()}] ${event.type}${duration}`,
      Object.keys(event.data).length > 0 ? event.data : ""
    );
  };
}
