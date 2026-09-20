/**
 * Memory Context Integration Module
 *
 * High-level API that combines retrieval and formatting for easy integration.
 * Provides a single function to get context for a message.
 *
 * Features:
 * - Single function to get context string
 * - Caching for repeated queries
 * - Configurable via options or presets
 * - Metrics collection
 */

import { LLMProvider, createOllamaProvider } from "./llm-provider.js";
import {
  RetrievalPipeline,
  RetrievalOptions,
  createRetrievalPipeline,
  RANKING_PRESETS,
  RankingPreset,
} from "./retrieval-pipeline.js";
import { RankedMemory, RankingWeights } from "./memory-ranker.js";
import {
  ContextFormatter,
  ContextFormat,
  FormatterOptions,
  createContextFormatter,
} from "./context-formatter.js";
import { MemoryCategory } from "./schema.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Combined options for context retrieval
 */
export interface ContextOptions {
  // Retrieval options
  /** Maximum memories to retrieve (default: 5) */
  limit?: number;

  /** Filter by project */
  project?: string;

  /** Filter by categories */
  categories?: MemoryCategory[];

  /** Minimum importance */
  minImportance?: number;

  /** Skip LLM analysis */
  skipAnalysis?: boolean;

  /** Ranking preset */
  rankingPreset?: RankingPreset;

  /** Custom ranking weights */
  rankingWeights?: RankingWeights;

  // Formatting options
  /** Output format (default: 'markdown') */
  format?: ContextFormat;

  /** Token budget */
  maxTokens?: number;

  /** Include metadata in output */
  includeMetadata?: boolean;

  // Behavior options
  /** Return empty string if no memories (default: true) */
  skipIfEmpty?: boolean;

  /** Cache results (default: true) */
  cache?: boolean;

  /** Cache TTL in ms (default: 60000) */
  cacheTTL?: number;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Full result from context retrieval
 */
export interface ContextResult {
  /** Formatted context string */
  context: string;

  /** Retrieved memories */
  memories: RankedMemory[];

  /** Token count estimate */
  tokensUsed: number;

  /** Retrieval time in ms */
  retrievalTime: number;

  /** Formatting time in ms */
  formattingTime: number;

  /** Whether result came from cache */
  cached: boolean;
}

/**
 * Cache entry
 */
interface CacheEntry {
  result: ContextResult;
  timestamp: number;
}

/**
 * Default options
 */
const DEFAULT_CONTEXT_OPTIONS: Required<ContextOptions> = {
  limit: 5,
  project: "",
  categories: [],
  minImportance: 0,
  skipAnalysis: false,
  rankingPreset: "default",
  rankingWeights: RANKING_PRESETS.default,
  format: "markdown",
  maxTokens: 0,
  includeMetadata: true,
  skipIfEmpty: true,
  cache: true,
  cacheTTL: 60000,
  debug: false,
};

// ============================================================================
// MEMORY CONTEXT SERVICE
// ============================================================================

/**
 * Memory Context Service
 *
 * Manages retrieval, formatting, and caching of memory context.
 */
class MemoryContextService {
  private pipeline: RetrievalPipeline;
  private formatter: ContextFormatter;
  private cache: Map<string, CacheEntry>;
  private defaultOptions: Partial<ContextOptions>;

  constructor(
    provider: LLMProvider,
    options: Partial<ContextOptions> = {}
  ) {
    this.pipeline = createRetrievalPipeline(provider);
    this.formatter = createContextFormatter();
    this.cache = new Map();
    this.defaultOptions = options;
  }

  /**
   * Get context for a message
   *
   * @param message User message to find context for
   * @param options Context options
   * @returns Full context result with metadata
   */
  async getContextForMessage(
    message: string,
    options?: ContextOptions
  ): Promise<ContextResult> {
    const opts = { ...DEFAULT_CONTEXT_OPTIONS, ...this.defaultOptions, ...options };

    // Check cache
    const cacheKey = this.getCacheKey(message, opts);
    if (opts.cache) {
      const cached = this.getFromCache(cacheKey, opts.cacheTTL);
      if (cached) {
        if (opts.debug) {
          console.log("[MemoryContext] Cache hit");
        }
        return { ...cached, cached: true };
      }
    }

    // Retrieve memories
    const retrievalStart = Date.now();
    const retrievalResult = await this.pipeline.retrieve(message, {
      limit: opts.limit,
      project: opts.project || undefined,
      categories: opts.categories?.length ? opts.categories : undefined,
      minImportance: opts.minImportance || undefined,
      skipAnalysis: opts.skipAnalysis,
      rankingPreset: opts.rankingPreset,
      rankingWeights: opts.rankingWeights !== RANKING_PRESETS.default ? opts.rankingWeights : undefined,
      debug: opts.debug,
    });
    const retrievalTime = Date.now() - retrievalStart;

    // Format context
    const formattingStart = Date.now();
    const formatterOpts: FormatterOptions = {
      format: opts.format,
      maxTokens: opts.maxTokens || undefined,
      includeScores: opts.includeMetadata,
      includeProject: opts.includeMetadata,
      includeCategory: opts.includeMetadata,
    };

    const formatted = this.formatter.format(
      retrievalResult.memories,
      formatterOpts
    );
    const formattingTime = Date.now() - formattingStart;

    // Build result
    const result: ContextResult = {
      context: opts.skipIfEmpty && retrievalResult.memories.length === 0
        ? ""
        : formatted.text,
      memories: retrievalResult.memories,
      tokensUsed: formatted.estimatedTokens,
      retrievalTime,
      formattingTime,
      cached: false,
    };

    // Cache result
    if (opts.cache) {
      this.cache.set(cacheKey, {
        result,
        timestamp: Date.now(),
      });
    }

    if (opts.debug) {
      console.log(`[MemoryContext] Retrieved ${result.memories.length} memories in ${retrievalTime}ms`);
      console.log(`[MemoryContext] Formatted in ${formattingTime}ms, ${result.tokensUsed} tokens`);
    }

    return result;
  }

  /**
   * Quick context retrieval (convenience method)
   *
   * @param message User message
   * @returns Formatted context string
   */
  async getContext(message: string): Promise<string> {
    const result = await this.getContextForMessage(message);
    return result.context;
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hitRate: number } {
    return {
      size: this.cache.size,
      hitRate: 0, // Would need to track hits/misses for real implementation
    };
  }

  private getCacheKey(message: string, opts: ContextOptions): string {
    // Create a deterministic key from message and relevant options
    const keyParts = [
      message,
      opts.limit,
      opts.project,
      opts.categories?.join(",") ?? "",
      opts.format,
      opts.maxTokens,
    ];
    return keyParts.join("|");
  }

  private getFromCache(
    key: string,
    ttl: number
  ): ContextResult | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    // Check TTL
    if (Date.now() - entry.timestamp > ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.result;
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let defaultService: MemoryContextService | null = null;

/**
 * Initialize the context retrieval service
 *
 * @param provider LLM provider
 * @param options Default options
 */
export function initContextRetrieval(
  provider: LLMProvider,
  options?: Partial<ContextOptions>
): void {
  defaultService = new MemoryContextService(provider, options);
}

/**
 * Get the default context service
 *
 * Auto-initializes with Ollama if not initialized
 */
function getService(): MemoryContextService {
  if (!defaultService) {
    const provider = createOllamaProvider();
    defaultService = new MemoryContextService(provider);
  }
  return defaultService;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Get formatted context for a message
 *
 * This is the main API for getting context to inject into prompts.
 *
 * @param message User message to find context for
 * @param options Context options
 * @returns Full context result
 */
export async function getContextForMessage(
  message: string,
  options?: ContextOptions
): Promise<ContextResult> {
  return getService().getContextForMessage(message, options);
}

/**
 * Quick context retrieval (convenience function)
 *
 * @param message User message
 * @returns Formatted context string
 */
export async function getContext(message: string): Promise<string> {
  return getService().getContext(message);
}

/**
 * Clear the context cache
 */
export function clearContextCache(): void {
  getService().clearCache();
}

/**
 * Create a new context service
 *
 * @param provider LLM provider
 * @param options Default options
 */
export function createContextService(
  provider: LLMProvider,
  options?: Partial<ContextOptions>
): MemoryContextService {
  return new MemoryContextService(provider, options);
}

// Re-export types
export type { ContextFormat } from "./context-formatter.js";
