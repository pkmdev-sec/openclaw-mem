import { getConnectionManager } from "./connection.js";
import {
  Memory,
  MemoryCategory,
  CreateMemoryInput,
  validateCreateMemoryInput,
  generateMemoryId,
  validateContent,
  validateImportance,
} from "./schema.js";
import { createEmbeddingProvider } from "./embeddings.js";
import { CachedEmbeddingProvider } from "./embedding-cache.js";

/**
 * Singleton vector provider with caching
 */
const embeddingProvider = new CachedEmbeddingProvider(
  createEmbeddingProvider(),
  1000
);

/**
 * Options for getAllMemories
 */
export interface GetAllMemoriesOptions {
  limit?: number;
  offset?: number;
  category?: MemoryCategory;
  project?: string;
  since?: number; // Unix timestamp - only memories created after this
  orderBy?: "createdAt" | "updatedAt" | "importance";
  orderDirection?: "asc" | "desc";
}

/**
 * Options for countMemories
 */
export interface CountMemoriesFilter {
  category?: MemoryCategory;
  project?: string;
  since?: number;
  minImportance?: number;
}

/**
 * Result of a memory operation with timing info
 */
export interface OperationResult<T> {
  data: T;
  duration: number; // milliseconds
}

/**
 * Update data for a memory
 */
export interface UpdateMemoryData {
  content?: string;
  category?: MemoryCategory;
  importance?: number;
  project?: string;
}

// ============================================================================
// CREATE OPERATIONS
// ============================================================================

/**
 * Create a single memory with auto-generated ID and auto-vector
 * @returns The created memory with ID and timestamps
 */
export async function createMemory(
  input: CreateMemoryInput
): Promise<OperationResult<Memory>> {
  const startTime = Date.now();

  try {
    // Validate input
    validateCreateMemoryInput(input);

    // Generate vector
    const vector = await embeddingProvider.embed(input.content);
    const now = Date.now();

    // Create complete memory record
    const memory: Memory = {
      id: generateMemoryId(),
      content: input.content,
      category: input.category,
      project: input.project,
      importance: input.importance,
      vector,
      createdAt: now,
      updatedAt: now,
    };

    // Store in database
    const table = getConnectionManager().getTable();
    await table.add([memory]);

    const duration = Date.now() - startTime;
    return { data: memory, duration };
  } catch (error) {
    throw new Error(
      `Failed to create memory: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Create multiple memories efficiently with batch vector
 * @returns Array of created memories with IDs and timestamps
 */
export async function createMemories(
  inputs: CreateMemoryInput[]
): Promise<OperationResult<Memory[]>> {
  const startTime = Date.now();

  try {
    if (inputs.length === 0) {
      return { data: [], duration: 0 };
    }

    // Validate all inputs
    for (const input of inputs) {
      validateCreateMemoryInput(input);
    }

    // Extract content for batch vector
    const contents = inputs.map((input) => input.content);

    // Generate vectors in batch
    const vectors = await embeddingProvider.embedBatch(contents);

    // Create memory records
    const now = Date.now();
    const memories: Memory[] = inputs.map((input, index) => ({
      id: generateMemoryId(),
      content: input.content,
      category: input.category,
      project: input.project,
      importance: input.importance,
      vector: vectors[index],
      createdAt: now,
      updatedAt: now,
    }));

    // Store all in database
    const table = getConnectionManager().getTable();
    await table.add(memories);

    const duration = Date.now() - startTime;
    return { data: memories, duration };
  } catch (error) {
    throw new Error(
      `Failed to create memories: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ============================================================================
// READ OPERATIONS
// ============================================================================

/**
 * Get a single memory by ID
 * @returns The memory or null if not found
 */
export async function getMemory(
  id: string
): Promise<OperationResult<Memory | null>> {
  const startTime = Date.now();

  try {
    const table = getConnectionManager().getTable();

    // Get all results and filter in-memory for compatibility
    const allResults = await table.query().toArray();
    const filtered = allResults.filter((row: any) => row.id === id);

    const memory = filtered.length > 0 ? (filtered[0] as unknown as Memory) : null;
    const duration = Date.now() - startTime;

    return { data: memory, duration };
  } catch (error) {
    throw new Error(
      `Failed to get memory: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get multiple memories by IDs efficiently
 * @returns Array of found memories (may be fewer than requested if some IDs don't exist)
 */
export async function getMemories(
  ids: string[]
): Promise<OperationResult<Memory[]>> {
  const startTime = Date.now();

  try {
    if (ids.length === 0) {
      return { data: [], duration: 0 };
    }

    const table = getConnectionManager().getTable();
    const idSet = new Set(ids);

    // Get all and filter in-memory
    const allResults = await table.query().toArray();
    const filtered = allResults.filter((row: any) => idSet.has(row.id));

    const memories = filtered as unknown as Memory[];
    const duration = Date.now() - startTime;

    return { data: memories, duration };
  } catch (error) {
    throw new Error(
      `Failed to get memories: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get all memories with optional pagination and filtering
 * @returns Paginated list of memories
 */
export async function getAllMemories(
  options: GetAllMemoriesOptions = {}
): Promise<OperationResult<Memory[]>> {
  const startTime = Date.now();

  try {
    const {
      limit = 100,
      offset = 0,
      category,
      project,
      since,
      orderBy = "createdAt",
      orderDirection = "desc",
    } = options;

    const table = getConnectionManager().getTable();

    // Get all results
    const allResults = await table.query().toArray();

    // Apply filters in-memory
    let filtered = allResults.filter((row: any) => {
      if (category && row.category !== category) {
        return false;
      }
      if (project && row.project !== project) {
        return false;
      }
      if (since !== undefined && row.createdAt < since) {
        return false;
      }
      return true;
    });

    let memories = filtered as unknown as Memory[];

    // Sort results
    memories.sort((a, b) => {
      let aVal: number;
      let bVal: number;

      if (orderBy === "createdAt") {
        aVal = a.createdAt;
        bVal = b.createdAt;
      } else if (orderBy === "updatedAt") {
        aVal = a.updatedAt;
        bVal = b.updatedAt;
      } else {
        aVal = a.importance;
        bVal = b.importance;
      }

      return orderDirection === "asc" ? aVal - bVal : bVal - aVal;
    });

    // Apply pagination
    const paginated = memories.slice(offset, offset + limit);

    const duration = Date.now() - startTime;
    return { data: paginated, duration };
  } catch (error) {
    throw new Error(
      `Failed to get all memories: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Count memories with optional filtering
 * @returns Count of memories matching the filter
 */
export async function countMemories(
  filter?: CountMemoriesFilter
): Promise<OperationResult<number>> {
  const startTime = Date.now();

  try {
    const table = getConnectionManager().getTable();

    if (!filter || Object.keys(filter).length === 0) {
      // No filter - count all
      const count = await table.countRows();
      const duration = Date.now() - startTime;
      return { data: count, duration };
    }

    // Get all results and filter in-memory
    const allResults = await table.query().toArray();

    const filtered = allResults.filter((row: any) => {
      if (filter.category && row.category !== filter.category) {
        return false;
      }
      if (filter.project && row.project !== filter.project) {
        return false;
      }
      if (filter.since !== undefined && row.createdAt < filter.since) {
        return false;
      }
      if (filter.minImportance !== undefined && row.importance < filter.minImportance) {
        return false;
      }
      return true;
    });

    const count = filtered.length;

    const duration = Date.now() - startTime;
    return { data: count, duration };
  } catch (error) {
    throw new Error(
      `Failed to count memories: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ============================================================================
// UPDATE OPERATIONS
// ============================================================================

/**
 * Update a memory by ID
 * If content is updated, the vector is automatically regenerated
 * @returns The updated memory or null if not found
 */
export async function updateMemory(
  id: string,
  updates: UpdateMemoryData
): Promise<OperationResult<Memory | null>> {
  const startTime = Date.now();

  try {
    // Validate updates
    if (updates.content !== undefined) {
      validateContent(updates.content);
    }
    if (updates.importance !== undefined) {
      validateImportance(updates.importance);
    }

    // Get existing memory
    const existingResult = await getMemory(id);
    if (!existingResult.data) {
      return { data: null, duration: Date.now() - startTime };
    }

    const existing = existingResult.data;

    // Prepare updated memory
    const updated: Memory = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };

    // Re-generate vector if content changed
    if (updates.content !== undefined && updates.content !== existing.content) {
      updated.vector = await embeddingProvider.embed(updates.content);
    } else {
      // Ensure vector is a proper array (LanceDB might return it as a TypedArray)
      updated.vector = Array.isArray(existing.vector)
        ? existing.vector
        : Array.from(existing.vector);
    }

    // Delete old and insert new (LanceDB doesn't support in-place updates)
    const table = getConnectionManager().getTable();
    await table.delete(`id = '${id}'`);
    await table.add([updated]);

    const duration = Date.now() - startTime;
    return { data: updated, duration };
  } catch (error) {
    throw new Error(
      `Failed to update memory: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ============================================================================
// DELETE OPERATIONS
// ============================================================================

/**
 * Delete a single memory by ID
 * @returns true if deleted, false if not found
 */
export async function deleteMemory(
  id: string
): Promise<OperationResult<boolean>> {
  const startTime = Date.now();

  try {
    const table = getConnectionManager().getTable();

    // Check if exists first
    const existing = await getMemory(id);
    if (!existing.data) {
      return { data: false, duration: Date.now() - startTime };
    }

    // Delete
    await table.delete(`id = '${id}'`);

    const duration = Date.now() - startTime;
    return { data: true, duration };
  } catch (error) {
    throw new Error(
      `Failed to delete memory: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Delete multiple memories by IDs efficiently
 * @returns Number of memories actually deleted
 */
export async function deleteMemories(
  ids: string[]
): Promise<OperationResult<number>> {
  const startTime = Date.now();

  try {
    if (ids.length === 0) {
      return { data: 0, duration: 0 };
    }

    const table = getConnectionManager().getTable();

    // Get existing memories first to count how many will be deleted
    const existing = await getMemories(ids);
    const existingCount = existing.data.length;

    if (existingCount === 0) {
      return { data: 0, duration: Date.now() - startTime };
    }

    // Build delete filter for multiple IDs
    const idFilter = ids.map((id) => `id = '${id}'`).join(" OR ");
    await table.delete(idFilter);

    const duration = Date.now() - startTime;
    return { data: existingCount, duration };
  } catch (error) {
    throw new Error(
      `Failed to delete memories: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Delete memories matching a filter
 * @returns Number of memories deleted
 */
export async function deleteByFilter(
  filter: CountMemoriesFilter
): Promise<OperationResult<number>> {
  const startTime = Date.now();

  try {
    // Build filter conditions
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

    if (conditions.length === 0) {
      throw new Error("Delete filter cannot be empty - provide at least one condition");
    }

    // Get memories matching filter
    const countResult = await countMemories(filter);
    const count = countResult.data;

    if (count === 0) {
      return { data: 0, duration: Date.now() - startTime };
    }

    // Get all memories and filter to find IDs to delete
    const table = getConnectionManager().getTable();
    const allResults = await table.query().toArray();

    const toDelete = allResults.filter((row: any) => {
      if (filter.category && row.category !== filter.category) {
        return false;
      }
      if (filter.project && row.project !== filter.project) {
        return false;
      }
      if (filter.since !== undefined && row.createdAt < filter.since) {
        return false;
      }
      if (filter.minImportance !== undefined && row.importance < filter.minImportance) {
        return false;
      }
      return true;
    });

    // Delete each matching memory
    for (const row of toDelete) {
      await table.delete(`id = '${(row as any).id}'`);
    }

    const duration = Date.now() - startTime;
    return { data: toDelete.length, duration };
  } catch (error) {
    throw new Error(
      `Failed to delete by filter: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get cache statistics for the vector provider
 */
export function getEmbeddingCacheStats() {
  return embeddingProvider.getCacheStats();
}

/**
 * Clear the vector cache
 */
export function clearEmbeddingCache() {
  embeddingProvider.clearCache();
}
