/**
 * Context Injection Hook
 *
 * Hook for injecting relevant memories into agent context.
 * Designed for integration with OpenClaw agent context builder.
 *
 * Usage (future OpenClaw integration):
 * ```typescript
 * import { createContextHook } from 'openclaw-memory/hooks';
 *
 * const memoryContextHook = createContextHook({
 *   maxTokens: 2000,
 *   format: 'markdown',
 * });
 *
 * // In agent context builder
 * const memoryContext = await memoryContextHook.getContext(userMessage, project);
 * systemPrompt += memoryContext.context;
 * ```
 */

import { getMemorySystem, initMemorySystem } from "../memory-system.js";
import { getMemoryEventEmitter, createTimer } from "../memory-events.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Context hook options
 */
export interface ContextHookOptions {
  /** Max tokens for memory context (default: 2000) */
  maxTokens?: number;

  /** Context format (default: markdown) */
  format?: "markdown" | "xml" | "plain" | "compact";

  /** Minimum relevance score (default: 0.5) */
  minScore?: number;

  /** Max memories to include (default: 10) */
  maxMemories?: number;

  /** Enable caching (default: true) */
  enableCache?: boolean;

  /** Cache TTL in seconds (default: 60) */
  cacheTTL?: number;

  /** Auto-initialize system (default: true) */
  autoInit?: boolean;
}

/**
 * Context hook result
 */
export interface ContextHookResult {
  /** Formatted context to inject */
  context: string;

  /** Number of memories included */
  memoryCount: number;

  /** Token count estimate */
  tokenCount: number;

  /** Time taken in ms */
  latency: number;

  /** Whether result was from cache */
  cached: boolean;
}

/**
 * Context hook metrics
 */
export interface ContextHookMetrics {
  /** Total getContext calls */
  totalCalls: number;

  /** Cache hits */
  cacheHits: number;

  /** Cache misses */
  cacheMisses: number;

  /** Average latency in ms */
  averageLatency: number;

  /** Total memories returned across all calls */
  totalMemoriesReturned: number;

  /** Error count */
  errors: number;
}

/**
 * Context hook interface
 */
export interface ContextHook {
  /**
   * Get relevant memory context for a user message
   */
  getContext(userMessage: string, project?: string): Promise<ContextHookResult>;

  /**
   * Clear the context cache
   */
  clearCache(): void;

  /**
   * Get hook metrics
   */
  getMetrics(): ContextHookMetrics;

  /**
   * Reset metrics
   */
  resetMetrics(): void;
}

// ============================================================================
// CACHE
// ============================================================================

interface CacheEntry {
  result: ContextHookResult;
  timestamp: number;
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

class ContextHookImpl implements ContextHook {
  private options: Required<ContextHookOptions>;
  private cache: Map<string, CacheEntry> = new Map();
  private metrics: ContextHookMetrics = {
    totalCalls: 0,
    cacheHits: 0,
    cacheMisses: 0,
    averageLatency: 0,
    totalMemoriesReturned: 0,
    errors: 0,
  };
  private totalLatency = 0;
  private initialized = false;
  private emitter = getMemoryEventEmitter();

  constructor(options: ContextHookOptions = {}) {
    this.options = {
      maxTokens: options.maxTokens ?? 2000,
      format: options.format ?? "markdown",
      minScore: options.minScore ?? 0.5,
      maxMemories: options.maxMemories ?? 10,
      enableCache: options.enableCache ?? true,
      cacheTTL: options.cacheTTL ?? 60,
      autoInit: options.autoInit ?? true,
    };
  }

  async getContext(userMessage: string, project?: string): Promise<ContextHookResult> {
    const timer = createTimer();
    this.metrics.totalCalls++;

    try {
      // Check cache
      if (this.options.enableCache) {
        const cacheKey = this.getCacheKey(userMessage, project);
        const cached = this.cache.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < this.options.cacheTTL * 1000) {
          this.metrics.cacheHits++;
          const latency = timer();
          this.updateLatency(latency);

          return {
            ...cached.result,
            latency,
            cached: true,
          };
        }

        this.metrics.cacheMisses++;
      }

      // Initialize system if needed
      if (this.options.autoInit && !this.initialized) {
        await this.initialize();
      }

      // Get context from memory system
      const system = getMemorySystem();
      const result = await system.recall(userMessage, {
        limit: this.options.maxMemories,
        minScore: this.options.minScore,
        maxTokens: this.options.maxTokens,
        format: this.options.format,
        project,
      });

      const hookResult: ContextHookResult = {
        context: result.context,
        memoryCount: result.memoryCount,
        tokenCount: result.tokenCount,
        latency: timer(),
        cached: false,
      };

      // Update metrics
      this.metrics.totalMemoriesReturned += result.memoryCount;
      this.updateLatency(hookResult.latency);

      // Cache result
      if (this.options.enableCache) {
        const cacheKey = this.getCacheKey(userMessage, project);
        this.cache.set(cacheKey, {
          result: hookResult,
          timestamp: Date.now(),
        });
      }

      return hookResult;
    } catch (error) {
      this.metrics.errors++;
      const latency = timer();
      this.updateLatency(latency);

      // Log error but don't throw - graceful degradation
      this.emitter.emitEvent("system:error", {
        hook: "context",
        error: error instanceof Error ? error.message : String(error),
      });

      // Return empty context on error
      return {
        context: "",
        memoryCount: 0,
        tokenCount: 0,
        latency,
        cached: false,
      };
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  getMetrics(): ContextHookMetrics {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = {
      totalCalls: 0,
      cacheHits: 0,
      cacheMisses: 0,
      averageLatency: 0,
      totalMemoriesReturned: 0,
      errors: 0,
    };
    this.totalLatency = 0;
  }

  private async initialize(): Promise<void> {
    try {
      await initMemorySystem({
        logLevel: "error", // Quiet initialization
      });
      this.initialized = true;
    } catch (error) {
      // Log but don't throw
      console.error("[ContextHook] Failed to initialize memory system:", error);
    }
  }

  private getCacheKey(message: string, project?: string): string {
    // Simple hash for cache key
    const input = `${message}:${project || ""}`;
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `ctx:${hash}`;
  }

  private updateLatency(latency: number): void {
    this.totalLatency += latency;
    this.metrics.averageLatency = Math.round(
      this.totalLatency / this.metrics.totalCalls
    );
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a context hook instance
 */
export function createContextHook(options?: ContextHookOptions): ContextHook {
  return new ContextHookImpl(options);
}

// ============================================================================
// SINGLETON
// ============================================================================

let defaultContextHook: ContextHook | null = null;

/**
 * Get the default context hook (singleton)
 */
export function getContextHook(): ContextHook {
  if (!defaultContextHook) {
    defaultContextHook = createContextHook();
  }
  return defaultContextHook;
}

/**
 * Initialize the default context hook with options
 */
export function initContextHook(options?: ContextHookOptions): ContextHook {
  defaultContextHook = createContextHook(options);
  return defaultContextHook;
}
