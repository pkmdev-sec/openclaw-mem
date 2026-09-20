import { getConnectionManager } from "./connection.js";
import { Memory, MemoryCategory } from "./schema.js";
import { createEmbeddingProvider } from "./embeddings.js";
import { CachedEmbeddingProvider } from "./embedding-cache.js";

/**
 * Singleton vector provider with caching for search operations
 */
const vectorProvider = new CachedEmbeddingProvider(
  createEmbeddingProvider(),
  1000
);

/**
 * Filter options for search operations
 */
export interface SearchFilter {
  category?: MemoryCategory;
  project?: string;
  since?: number; // Unix timestamp - only memories created after this
  minImportance?: number;
}

/**
 * Options for search operations
 */
export interface SearchOptions {
  limit?: number;
  threshold?: number; // Minimum similarity score (0-1)
  filter?: SearchFilter;
  includeScore?: boolean;
}

/**
 * Search result with optional similarity score
 */
export interface SearchResult {
  memory: Memory;
  score?: number; // Similarity score (0-1, higher is better)
}

/**
 * Options for hybrid search
 */
export interface HybridSearchOptions extends SearchOptions {
  vectorWeight?: number; // Weight for vector search (0-1), default 0.7
  keywordWeight?: number; // Weight for keyword search (0-1), default 0.3
}

/**
 * Result of a search operation with timing info
 */
export interface SearchOperationResult {
  results: SearchResult[];
  duration: number; // milliseconds
  totalFound: number;
}

// ============================================================================
// VECTOR SEARCH
// ============================================================================

/**
 * Search memories by text using vector similarity
 * Automatically generates vector for the query text
 * @param text Query text to search for
 * @param options Search options (limit, threshold, filters)
 * @returns Ranked search results with optional similarity scores
 */
export async function searchByText(
  text: string,
  options: SearchOptions = {}
): Promise<SearchOperationResult> {
  const startTime = Date.now();

  try {
    const {
      limit = 10,
      threshold = 0.0,
      filter,
      includeScore = false,
    } = options;

    // Generate query vector
    const queryEmbedding = await vectorProvider.embed(text);

    // Get table and perform vector search
    const table = getConnectionManager().getTable();
    let query = table.vectorSearch(queryEmbedding);

    // Apply limit (request more than needed for filtering)
    const fetchLimit = filter ? limit * 3 : limit;
    query = query.limit(fetchLimit);

    // Execute search
    const rawResults = await query.toArray();

    // Convert to Memory objects with scores
    let results: SearchResult[] = rawResults.map((row: any) => ({
      memory: {
        id: row.id,
        content: row.content,
        category: row.category,
        project: row.project,
        importance: row.importance,
        vector: row.vector,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      } as Memory,
      score: row._distance !== undefined ? 1 / (1 + row._distance) : undefined,
    }));

    // Apply threshold filter
    if (threshold > 0) {
      results = results.filter((r) => (r.score ?? 0) >= threshold);
    }

    // Apply custom filters
    if (filter) {
      results = applyFilters(results, filter);
    }

    // Limit to requested number
    results = results.slice(0, limit);

    // Remove scores if not requested
    if (!includeScore) {
      results.forEach((r) => delete r.score);
    }

    const duration = Date.now() - startTime;

    return {
      results,
      duration,
      totalFound: results.length,
    };
  } catch (error) {
    throw new Error(
      `Failed to search by text: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Apply filters to search results
 */
function applyFilters(
  results: SearchResult[],
  filter: SearchFilter
): SearchResult[] {
  return results.filter((result) => {
    const { memory } = result;

    if (filter.category && memory.category !== filter.category) {
      return false;
    }

    if (filter.project && memory.project !== filter.project) {
      return false;
    }

    if (filter.since !== undefined && memory.createdAt < filter.since) {
      return false;
    }

    if (
      filter.minImportance !== undefined &&
      memory.importance < filter.minImportance
    ) {
      return false;
    }

    return true;
  });
}

// ============================================================================
// KEYWORD SEARCH
// ============================================================================

/**
 * Perform keyword-based search on memory content
 * Uses simple case-insensitive substring matching
 */
function keywordSearch(
  memories: Memory[],
  query: string,
  limit: number = 10
): SearchResult[] {
  const queryLower = query.toLowerCase();
  const keywords = queryLower.split(/\s+/).filter((k) => k.length > 0);

  // Score each memory based on keyword matches
  const scored = memories.map((memory) => {
    const contentLower = memory.content.toLowerCase();
    let score = 0;

    // Exact phrase match gets highest score
    if (contentLower.includes(queryLower)) {
      score += 10;
    }

    // Individual keyword matches
    for (const keyword of keywords) {
      const matches = contentLower.split(keyword).length - 1;
      score += matches;
    }

    // Bonus for matches at the start
    if (contentLower.startsWith(queryLower)) {
      score += 5;
    }

    return {
      memory,
      score: score / (memory.content.length / 100), // Normalize by content length
    };
  });

  // Sort by score and return top results
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ============================================================================
// HYBRID SEARCH
// ============================================================================

/**
 * Perform hybrid search combining vector similarity and keyword matching
 * Results are ranked by a weighted combination of both methods
 * @param text Query text to search for
 * @param options Hybrid search options including weights
 * @returns Deduplicated and ranked search results
 */
export async function hybridSearch(
  text: string,
  options: HybridSearchOptions = {}
): Promise<SearchOperationResult> {
  const startTime = Date.now();

  try {
    const {
      limit = 10,
      threshold = 0.0,
      filter,
      includeScore = false,
      vectorWeight = 0.7,
      keywordWeight = 0.3,
    } = options;

    // Validate weights
    const totalWeight = vectorWeight + keywordWeight;
    if (Math.abs(totalWeight - 1.0) > 0.01) {
      throw new Error("Vector and keyword weights must sum to 1.0");
    }

    // Perform vector search (get more results for better hybrid ranking)
    const vectorResults = await searchByText(text, {
      limit: limit * 2,
      threshold: threshold * vectorWeight, // Adjust threshold by weight
      filter,
      includeScore: true,
    });

    // Get all memories for keyword search
    const table = getConnectionManager().getTable();
    let allMemoriesQuery = table.query().limit(1000); // Reasonable limit

    // Apply filters to keyword search as well
    if (filter) {
      const conditions: string[] = [];

      if (filter.category) {
        conditions.push(`category = '${filter.category}'`);
      }

      if (filter.project) {
        conditions.push(`project = '${filter.project}'`);
      }

      if (filter.since !== undefined) {
        conditions.push(`createdAt >= ${filter.since}`);
      }

      if (filter.minImportance !== undefined) {
        conditions.push(`importance >= ${filter.minImportance}`);
      }

      if (conditions.length > 0) {
        allMemoriesQuery = allMemoriesQuery.filter(conditions.join(" AND "));
      }
    }

    const allMemories = (await allMemoriesQuery.toArray()) as unknown as Memory[];

    // Perform keyword search
    const keywordResults = keywordSearch(allMemories, text, limit * 2);

    // Combine and deduplicate results
    const combinedScores = new Map<string, number>();

    // Add vector search scores
    for (const result of vectorResults.results) {
      const id = result.memory.id;
      const vectorScore = result.score ?? 0;
      combinedScores.set(id, vectorScore * vectorWeight);
    }

    // Add keyword search scores (or combine if already exists)
    for (const result of keywordResults) {
      const id = result.memory.id;
      const keywordScore = result.score ?? 0;
      const currentScore = combinedScores.get(id) ?? 0;
      combinedScores.set(id, currentScore + keywordScore * keywordWeight);
    }

    // Build final result set
    const memoryMap = new Map<string, Memory>();
    for (const result of vectorResults.results) {
      memoryMap.set(result.memory.id, result.memory);
    }
    for (const result of keywordResults) {
      if (!memoryMap.has(result.memory.id)) {
        memoryMap.set(result.memory.id, result.memory);
      }
    }

    // Create ranked results
    let results: SearchResult[] = Array.from(combinedScores.entries())
      .map(([id, score]) => ({
        memory: memoryMap.get(id)!,
        score,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // Apply threshold
    if (threshold > 0) {
      results = results.filter((r) => r.score >= threshold);
    }

    // Remove scores if not requested
    if (!includeScore) {
      results.forEach((r) => delete r.score);
    }

    const duration = Date.now() - startTime;

    return {
      results,
      duration,
      totalFound: results.length,
    };
  } catch (error) {
    throw new Error(
      `Failed to perform hybrid search: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ============================================================================
// SPECIALIZED SEARCH FUNCTIONS
// ============================================================================

/**
 * Search for similar memories to a given memory ID
 * Useful for finding related memories
 */
export async function searchSimilar(
  memoryId: string,
  options: Omit<SearchOptions, "threshold"> = {}
): Promise<SearchOperationResult> {
  const startTime = Date.now();

  try {
    // Get the memory
    const table = getConnectionManager().getTable();
    const allResults = await table.query().toArray();
    const results = allResults.filter((row: any) => row.id === memoryId);

    if (results.length === 0) {
      throw new Error(`Memory with ID ${memoryId} not found`);
    }

    const memory = results[0] as unknown as Memory;

    // Use its vector for vector search
    const { limit = 10, filter, includeScore = false } = options;

    let query = table.vectorSearch(memory.vector);
    query = query.limit(limit + 1); // +1 to exclude the original

    const rawResults = await query.toArray();

    // Convert and filter out the original memory
    let searchResults: SearchResult[] = rawResults
      .filter((row: any) => row.id !== memoryId)
      .map((row: any) => ({
        memory: {
          id: row.id,
          content: row.content,
          category: row.category,
          project: row.project,
          importance: row.importance,
          vector: row.vector,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        } as Memory,
        score: row._distance !== undefined ? 1 / (1 + row._distance) : undefined,
      }));

    // Apply filters
    if (filter) {
      searchResults = applyFilters(searchResults, filter);
    }

    // Limit results
    searchResults = searchResults.slice(0, limit);

    // Remove scores if not requested
    if (!includeScore) {
      searchResults.forEach((r) => delete r.score);
    }

    const duration = Date.now() - startTime;

    return {
      results: searchResults,
      duration,
      totalFound: searchResults.length,
    };
  } catch (error) {
    throw new Error(
      `Failed to search similar memories: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Search memories by category with optional text query
 */
export async function searchByCategory(
  category: MemoryCategory,
  textQuery?: string,
  options: SearchOptions = {}
): Promise<SearchOperationResult> {
  const filterOptions: SearchOptions = {
    ...options,
    filter: {
      ...options.filter,
      category,
    },
  };

  if (textQuery) {
    return searchByText(textQuery, filterOptions);
  }

  // No text query - just filter by category
  const startTime = Date.now();
  const table = getConnectionManager().getTable();

  const allResults = await table.query().toArray();
  const filtered = allResults.filter((row: any) => row.category === category);
  const limited = filtered.slice(0, options.limit ?? 100);

  const memories = limited as unknown as Memory[];
  const searchResults: SearchResult[] = memories.map((memory) => ({ memory }));

  return {
    results: searchResults,
    duration: Date.now() - startTime,
    totalFound: searchResults.length,
  };
}

/**
 * Search memories by project with optional text query
 */
export async function searchByProject(
  project: string,
  textQuery?: string,
  options: SearchOptions = {}
): Promise<SearchOperationResult> {
  const filterOptions: SearchOptions = {
    ...options,
    filter: {
      ...options.filter,
      project,
    },
  };

  if (textQuery) {
    return searchByText(textQuery, filterOptions);
  }

  // No text query - just filter by project
  const startTime = Date.now();
  const table = getConnectionManager().getTable();

  const allResults = await table.query().toArray();
  const filtered = allResults.filter((row: any) => row.project === project);
  const limited = filtered.slice(0, options.limit ?? 100);

  const memories = limited as unknown as Memory[];
  const searchResults: SearchResult[] = memories.map((memory) => ({ memory }));

  return {
    results: searchResults,
    duration: Date.now() - startTime,
    totalFound: searchResults.length,
  };
}

/**
 * Get cache statistics for the vector provider
 */
export function getSearchCacheStats() {
  return vectorProvider.getCacheStats();
}

/**
 * Clear the search vector cache
 */
export function clearSearchCache() {
  vectorProvider.clearCache();
}
