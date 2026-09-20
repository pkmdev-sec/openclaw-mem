/**
 * Query Executor Module
 *
 * Executes multiple search queries in parallel with configurable
 * concurrency, timeout handling, and result aggregation.
 *
 * Works with both vector and hybrid search from Phase 1.
 */

import { Memory } from "./schema.js";
import {
  searchByText,
  hybridSearch,
  SearchOperationResult,
  SearchOptions,
  HybridSearchOptions,
} from "./search.js";
import { GeneratedQuery, QueryPlan, SearchStrategy } from "./intent-analyzer.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result from executing a single query
 */
export interface QueryResult {
  /** The query that was executed */
  query: GeneratedQuery;

  /** Memories found by this query */
  memories: MemoryWithScore[];

  /** Execution time in ms */
  duration: number;

  /** Whether the query succeeded */
  success: boolean;

  /** Error message if failed */
  error?: string;
}

/**
 * Memory with similarity score and provenance
 */
export interface MemoryWithScore extends Memory {
  /** Similarity score (0-1, higher is better) */
  _score?: number;

  /** Distance from vector search (lower is better) */
  _distance?: number;
}

/**
 * Aggregated result from executing multiple queries
 */
export interface ExecutionResult {
  /** Results from each query */
  results: QueryResult[];

  /** Total execution time in ms */
  totalDuration: number;

  /** Number of unique memories found */
  uniqueMemories: number;

  /** All unique memories (deduplicated) */
  memories: MemoryWithScore[];

  /** Search strategy used */
  strategy: SearchStrategy;

  /** Number of successful queries */
  successfulQueries: number;

  /** Number of failed queries */
  failedQueries: number;
}

/**
 * Options for query execution
 */
export interface ExecutorOptions {
  /** Maximum concurrent queries (default: 3) */
  concurrency?: number;

  /** Timeout per query in ms (default: 5000) */
  timeoutPerQuery?: number;

  /** Search type to use (default: 'hybrid') */
  searchType?: "vector" | "hybrid";

  /** Maximum results per query (default: 10) */
  limitPerQuery?: number;

  /** Include similarity scores in results (default: true) */
  includeScores?: boolean;
}

// ============================================================================
// QUERY EXECUTOR
// ============================================================================

/**
 * Query Executor class
 *
 * Executes multiple queries in parallel with fault tolerance.
 * Uses Promise.allSettled for graceful error handling.
 */
export class QueryExecutor {
  private options: Required<ExecutorOptions>;

  constructor(options: ExecutorOptions = {}) {
    this.options = {
      concurrency: options.concurrency ?? 3,
      timeoutPerQuery: options.timeoutPerQuery ?? 5000,
      searchType: options.searchType ?? "hybrid",
      limitPerQuery: options.limitPerQuery ?? 10,
      includeScores: options.includeScores ?? true,
    };
  }

  /**
   * Execute a complete query plan
   */
  async execute(plan: QueryPlan): Promise<ExecutionResult> {
    const startTime = Date.now();

    // Use the plan's recommended strategy, or fall back to options
    const strategy =
      plan.searchStrategy === "keyword" ? "hybrid" : plan.searchStrategy;

    // Execute queries with the appropriate strategy
    const results = await this.executeQueries(plan.queries, strategy);

    // Aggregate results
    const executionResult = this.aggregateResults(results, strategy, startTime);

    return executionResult;
  }

  /**
   * Execute multiple queries with concurrency control
   */
  async executeQueries(
    queries: GeneratedQuery[],
    strategy: SearchStrategy = "hybrid"
  ): Promise<QueryResult[]> {
    if (queries.length === 0) {
      return [];
    }

    const results: QueryResult[] = [];
    const batches = this.createBatches(queries, this.options.concurrency);

    for (const batch of batches) {
      const batchResults = await this.executeBatch(batch, strategy);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Create batches of queries for concurrent execution
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Execute a batch of queries concurrently
   */
  private async executeBatch(
    queries: GeneratedQuery[],
    strategy: SearchStrategy
  ): Promise<QueryResult[]> {
    const promises = queries.map((query) =>
      this.executeWithTimeout(query, strategy)
    );

    // Use allSettled for fault tolerance
    const settlements = await Promise.allSettled(promises);

    return settlements.map((settlement, index) => {
      if (settlement.status === "fulfilled") {
        return settlement.value;
      } else {
        // Failed query
        return {
          query: queries[index],
          memories: [],
          duration: 0,
          success: false,
          error: settlement.reason?.message || "Unknown error",
        };
      }
    });
  }

  /**
   * Execute a single query with timeout
   */
  private async executeWithTimeout(
    query: GeneratedQuery,
    strategy: SearchStrategy
  ): Promise<QueryResult> {
    const startTime = Date.now();

    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Query timeout after ${this.options.timeoutPerQuery}ms`));
      }, this.options.timeoutPerQuery);
    });

    // Create search promise
    const searchPromise = this.performSearch(query.text, strategy);

    try {
      // Race between search and timeout
      const searchResult = await Promise.race([searchPromise, timeoutPromise]);

      const memories = this.extractMemories(searchResult);

      return {
        query,
        memories,
        duration: Date.now() - startTime,
        success: true,
      };
    } catch (error) {
      return {
        query,
        memories: [],
        duration: Date.now() - startTime,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Perform search based on strategy
   */
  private async performSearch(
    text: string,
    strategy: SearchStrategy
  ): Promise<SearchOperationResult> {
    const baseOptions: SearchOptions = {
      limit: this.options.limitPerQuery,
      includeScore: this.options.includeScores,
    };

    if (strategy === "hybrid") {
      const hybridOptions: HybridSearchOptions = {
        ...baseOptions,
        vectorWeight: 0.7,
        keywordWeight: 0.3,
      };
      return hybridSearch(text, hybridOptions);
    } else {
      // semantic/vector search
      return searchByText(text, baseOptions);
    }
  }

  /**
   * Extract memories from search result
   */
  private extractMemories(result: SearchOperationResult): MemoryWithScore[] {
    return result.results.map((r) => ({
      ...r.memory,
      _score: r.score,
    }));
  }

  /**
   * Aggregate results from multiple queries
   */
  private aggregateResults(
    results: QueryResult[],
    strategy: SearchStrategy,
    startTime: number
  ): ExecutionResult {
    // Deduplicate memories by ID, keeping highest score
    const memoryMap = new Map<string, MemoryWithScore>();

    for (const result of results) {
      if (!result.success) continue;

      for (const memory of result.memories) {
        const existing = memoryMap.get(memory.id);
        if (!existing || (memory._score ?? 0) > (existing._score ?? 0)) {
          memoryMap.set(memory.id, memory);
        }
      }
    }

    const uniqueMemories = Array.from(memoryMap.values());
    const successfulQueries = results.filter((r) => r.success).length;
    const failedQueries = results.filter((r) => !r.success).length;

    return {
      results,
      totalDuration: Date.now() - startTime,
      uniqueMemories: uniqueMemories.length,
      memories: uniqueMemories,
      strategy,
      successfulQueries,
      failedQueries,
    };
  }

  /**
   * Get current executor options
   */
  getOptions(): Required<ExecutorOptions> {
    return { ...this.options };
  }

  /**
   * Update executor options
   */
  setOptions(options: Partial<ExecutorOptions>): void {
    this.options = {
      ...this.options,
      ...options,
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a query executor with default options
 */
export function createQueryExecutor(options?: ExecutorOptions): QueryExecutor {
  return new QueryExecutor(options);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Deduplicate memories by content (not just ID)
 * Keeps the memory with the highest score
 */
export function deduplicateByContent(
  memories: MemoryWithScore[]
): MemoryWithScore[] {
  const contentMap = new Map<string, MemoryWithScore>();

  for (const memory of memories) {
    // Normalize content for comparison
    const normalizedContent = memory.content.toLowerCase().trim();
    const existing = contentMap.get(normalizedContent);

    if (!existing || (memory._score ?? 0) > (existing._score ?? 0)) {
      contentMap.set(normalizedContent, memory);
    }
  }

  return Array.from(contentMap.values());
}

/**
 * Sort memories by score (descending)
 */
export function sortByScore(memories: MemoryWithScore[]): MemoryWithScore[] {
  return [...memories].sort((a, b) => (b._score ?? 0) - (a._score ?? 0));
}

/**
 * Filter memories by minimum score
 */
export function filterByScore(
  memories: MemoryWithScore[],
  minScore: number
): MemoryWithScore[] {
  return memories.filter((m) => (m._score ?? 0) >= minScore);
}
