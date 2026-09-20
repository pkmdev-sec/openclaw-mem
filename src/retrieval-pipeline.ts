/**
 * Retrieval Pipeline Module
 *
 * Main entry point that orchestrates intent analysis and query execution.
 * Provides both full-featured and quick retrieval modes.
 *
 * This is the primary API for retrieving relevant memories.
 */

import { LLMProvider, createOllamaProvider } from "./llm-provider.js";
import {
  IntentAnalyzer,
  Intent,
  QueryPlan,
  GeneratedQuery,
  createIntentAnalyzer,
} from "./intent-analyzer.js";
import {
  QueryExecutor,
  ExecutionResult,
  MemoryWithScore,
  ExecutorOptions,
  createQueryExecutor,
} from "./query-executor.js";
import { Memory, MemoryCategory } from "./schema.js";
import { searchByText } from "./search.js";
import {
  MemoryRanker,
  RankedMemory,
  RankingWeights,
  RankingPreset,
  RANKING_PRESETS,
  createMemoryRanker,
} from "./memory-ranker.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for retrieval operations
 */
export interface RetrievalOptions {
  /** Maximum memories to return (default: 5) */
  limit?: number;

  /** Skip LLM analysis and use query directly (default: false) */
  skipAnalysis?: boolean;

  /** Filter by project */
  project?: string;

  /** Minimum importance score (1-10) */
  minImportance?: number;

  /** Filter by categories */
  categories?: MemoryCategory[];

  /** Search type override */
  searchType?: "vector" | "hybrid";

  /** Enable debug logging (default: false) */
  debug?: boolean;

  /** Ranking preset to use (default: 'default') */
  rankingPreset?: RankingPreset;

  /** Custom ranking weights (overrides preset) */
  rankingWeights?: RankingWeights;

  /** Include ranking explanations in debug output */
  explainRanking?: boolean;
}

/**
 * Complete result from retrieval operation
 */
export interface RetrievalResult {
  /** Retrieved memories (sorted by relevance, with scores) */
  memories: RankedMemory[];

  /** Analyzed intent from user message */
  intent: Intent;

  /** Generated query plan */
  queryPlan: QueryPlan;

  /** Execution details */
  execution: ExecutionResult;

  /** Total operation duration in ms */
  totalDuration: number;

  /** Whether analysis was skipped */
  analysisSkipped: boolean;

  /** Ranking explanations if explainRanking was true */
  explanations?: string[];
}

/**
 * Options for pipeline initialization
 */
export interface PipelineOptions {
  /** Query executor options */
  executor?: ExecutorOptions;

  /** Default retrieval options */
  defaults?: Partial<RetrievalOptions>;
}

// ============================================================================
// RETRIEVAL PIPELINE
// ============================================================================

/**
 * Retrieval Pipeline class
 *
 * Orchestrates intent analysis and query execution to retrieve
 * the most relevant memories for a user message.
 */
export class RetrievalPipeline {
  private analyzer: IntentAnalyzer;
  private executor: QueryExecutor;
  private ranker: MemoryRanker;
  private defaults: Partial<RetrievalOptions>;

  constructor(provider: LLMProvider, options: PipelineOptions = {}) {
    this.analyzer = createIntentAnalyzer(provider);
    this.executor = createQueryExecutor(options.executor);
    this.ranker = createMemoryRanker();
    this.defaults = options.defaults ?? {};
  }

  /**
   * Retrieve relevant memories for a user message
   *
   * This is the main API for memory retrieval.
   *
   * @param message User message to find relevant context for
   * @param options Retrieval options
   * @returns Complete retrieval result with memories and metadata
   */
  async retrieve(
    message: string,
    options: RetrievalOptions = {}
  ): Promise<RetrievalResult> {
    const startTime = Date.now();
    const opts = { ...this.defaults, ...options };
    const debug = opts.debug ?? false;

    if (debug) {
      console.log("\n=== Retrieval Pipeline ===");
      console.log(`Input: "${message.slice(0, 100)}${message.length > 100 ? "..." : ""}"`);
    }

    // Step 1: Analyze intent (or skip)
    let queryPlan: QueryPlan;
    let analysisSkipped = false;

    if (opts.skipAnalysis) {
      // Quick mode - use message directly
      queryPlan = this.createDirectQueryPlan(message);
      analysisSkipped = true;
      if (debug) console.log("Analysis: Skipped (direct query mode)");
    } else {
      // Full analysis
      queryPlan = await this.analyzer.generateQueryPlan(message);
      if (debug) {
        console.log(`Analysis: ${queryPlan.analysisDuration}ms`);
        console.log(`  Intent: ${queryPlan.intent.type}`);
        console.log(`  Topic: ${queryPlan.intent.mainTopic}`);
        console.log(`  Queries: ${queryPlan.queries.length}`);
      }
    }

    // Step 2: Execute queries
    if (debug) {
      console.log("\nExecuting queries:");
      queryPlan.queries.forEach((q, i) =>
        console.log(`  ${i + 1}. [${q.type}] ${q.text.slice(0, 50)}...`)
      );
    }

    const execution = await this.executor.execute(queryPlan);

    if (debug) {
      console.log(`Execution: ${execution.totalDuration}ms`);
      console.log(`  Successful: ${execution.successfulQueries}/${queryPlan.queries.length}`);
      console.log(`  Unique memories: ${execution.uniqueMemories}`);
    }

    // Step 3: Post-process results with smart ranking
    let rawMemories = execution.memories;

    // Apply pre-ranking filters (category, minImportance)
    rawMemories = this.applyFilters(rawMemories, opts);

    // Determine ranking weights
    const rankingWeights = opts.rankingWeights ??
      (opts.rankingPreset ? RANKING_PRESETS[opts.rankingPreset] : RANKING_PRESETS.default);

    // Rank with project context from intent or options
    const targetProject = opts.project ?? queryPlan.intent.project;

    const rankedMemories = this.ranker.rank(
      rawMemories.map((m) => ({
        ...m,
        _distance: m._score !== undefined ? (1 - m._score) * 2 : undefined, // Convert score back to distance estimate
      })),
      {
        weights: rankingWeights,
        targetProject,
        deduplicateBy: "content",
        mergeStrategy: "max",
      }
    );

    // Apply limit
    const limit = opts.limit ?? 5;
    const memories = rankedMemories.slice(0, limit);

    // Generate explanations if requested
    let explanations: string[] | undefined;
    if (opts.explainRanking && debug) {
      explanations = memories.map((m) => this.ranker.explain(m));
    }

    if (debug) {
      console.log(`\nFinal results: ${memories.length} memories`);
      memories.forEach((m, i) =>
        console.log(
          `  ${i + 1}. [${m.category}] ${m.content.slice(0, 50)}... (score: ${m.finalScore.toFixed(3)})`
        )
      );
      if (explanations) {
        console.log("\nRanking explanations:");
        explanations.forEach((exp, i) => console.log(`\n--- Memory ${i + 1} ---\n${exp}`));
      }
    }

    const totalDuration = Date.now() - startTime;

    return {
      memories,
      intent: queryPlan.intent,
      queryPlan,
      execution,
      totalDuration,
      analysisSkipped,
      explanations,
    };
  }

  /**
   * Quick retrieval without LLM analysis
   *
   * Use this for simple lookups where you don't need intent analysis.
   *
   * @param query Search query text
   * @param limit Maximum results (default: 5)
   * @returns Array of memories sorted by relevance
   */
  async quickRetrieve(query: string, limit: number = 5): Promise<Memory[]> {
    const result = await this.retrieve(query, {
      skipAnalysis: true,
      limit,
    });
    return result.memories;
  }

  /**
   * Retrieve with specific project context
   *
   * @param message User message
   * @param project Project to prioritize
   * @param limit Maximum results
   */
  async retrieveForProject(
    message: string,
    project: string,
    limit: number = 5
  ): Promise<RetrievalResult> {
    return this.retrieve(message, {
      project,
      limit,
    });
  }

  /**
   * Create a direct query plan without LLM analysis
   */
  private createDirectQueryPlan(message: string): QueryPlan {
    const intent: Intent = {
      mainTopic: message.slice(0, 100),
      type: "other",
      entities: [],
      keywords: [],
      confidence: 1.0, // High confidence since it's direct
    };

    const queries: GeneratedQuery[] = [
      { text: message, type: "direct", weight: 1.0 },
    ];

    return {
      intent,
      queries,
      searchStrategy: "hybrid",
      analysisDuration: 0,
    };
  }

  /**
   * Apply pre-ranking filters to memories
   * Note: Project filtering is handled by ranking weights, not hard filtering
   */
  private applyFilters(
    memories: MemoryWithScore[],
    options: RetrievalOptions
  ): MemoryWithScore[] {
    return memories.filter((memory) => {
      // Importance filter (hard filter - don't include low importance)
      if (
        options.minImportance !== undefined &&
        memory.importance < options.minImportance
      ) {
        return false;
      }

      // Category filter (hard filter - only include specified categories)
      if (
        options.categories &&
        options.categories.length > 0 &&
        !options.categories.includes(memory.category)
      ) {
        return false;
      }

      return true;
    });
  }

  /**
   * Get the underlying ranker
   */
  getRanker(): MemoryRanker {
    return this.ranker;
  }

  /**
   * Get the underlying analyzer
   */
  getAnalyzer(): IntentAnalyzer {
    return this.analyzer;
  }

  /**
   * Get the underlying executor
   */
  getExecutor(): QueryExecutor {
    return this.executor;
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let defaultPipeline: RetrievalPipeline | null = null;

/**
 * Initialize the default retrieval pipeline
 *
 * Call this once at application startup.
 *
 * @param provider LLM provider to use
 * @param options Pipeline options
 */
export function initRetrievalPipeline(
  provider: LLMProvider,
  options?: PipelineOptions
): void {
  defaultPipeline = new RetrievalPipeline(provider, options);
}

/**
 * Get the default retrieval pipeline
 *
 * @throws Error if pipeline not initialized
 */
export function getRetrievalPipeline(): RetrievalPipeline {
  if (!defaultPipeline) {
    // Auto-initialize with Ollama provider
    const provider = createOllamaProvider();
    defaultPipeline = new RetrievalPipeline(provider);
  }
  return defaultPipeline;
}

/**
 * Check if pipeline is initialized
 */
export function isPipelineInitialized(): boolean {
  return defaultPipeline !== null;
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Retrieve relevant memories (convenience wrapper)
 *
 * Uses the default pipeline.
 *
 * @param message User message
 * @param options Retrieval options
 */
export async function retrieveMemories(
  message: string,
  options?: RetrievalOptions
): Promise<RetrievalResult> {
  return getRetrievalPipeline().retrieve(message, options);
}

/**
 * Quick memory retrieval (convenience wrapper)
 *
 * Uses the default pipeline without LLM analysis.
 *
 * @param query Search query
 * @param limit Maximum results
 */
export async function quickRetrieve(
  query: string,
  limit: number = 5
): Promise<Memory[]> {
  return getRetrievalPipeline().quickRetrieve(query, limit);
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a new retrieval pipeline
 *
 * @param provider LLM provider
 * @param options Pipeline options
 */
export function createRetrievalPipeline(
  provider: LLMProvider,
  options?: PipelineOptions
): RetrievalPipeline {
  return new RetrievalPipeline(provider, options);
}

// Re-export ranking types for convenience
export type { RankingPreset, RankingWeights, RankedMemory };
export { RANKING_PRESETS };
