import { Ollama } from "ollama";
import { getConnectionManager } from "./connection.js";
import {
  Memory,
  MemoryCategory,
  CreateMemoryInput,
  validateCreateMemoryInput,
  generateMemoryId,
  toMemoryCategory,
} from "./schema.js";

const EMBEDDING_MODEL = "nomic-embed-text";
const DB_PATH = "./memory-store";
const TABLE_NAME = "memories";

const ollama = new Ollama();
const connectionManager = getConnectionManager();

/**
 * Initialize storage with the new connection manager
 */
export async function initStorage(): Promise<void> {
  try {
    // Connect to database
    await connectionManager.connect({
      dbPath: DB_PATH,
      tableName: TABLE_NAME,
      vectorDimensions: 768, // nomic-embed-text dimensions
    });

    // Generate a dummy vector for table initialization
    const dummyEmbedding = await generateEmbedding("init");

    // Initialize table (auto-creates if doesn't exist)
    await connectionManager.initializeTable(TABLE_NAME, dummyEmbedding);

    console.log("Storage initialized successfully");
  } catch (error) {
    console.error("Failed to initialize storage:", error);
    throw error;
  }
}

/**
 * Generate vector for text using Ollama
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await ollama.embed({
      model: EMBEDDING_MODEL,
      input: text,
    });
    return response.embeddings[0];
  } catch (error) {
    console.error("Failed to generate embedding:", error);
    throw error;
  }
}

/**
 * Store a memory with validation
 * Maintains backward compatibility with the original API
 */
export async function storeMemory(
  memory: Omit<Memory, "vector" | "id" | "createdAt" | "updatedAt">
): Promise<void> {
  try {
    // Convert to CreateMemoryInput and validate
    const input: CreateMemoryInput = {
      content: memory.content,
      category: toMemoryCategory(memory.category),
      importance: memory.importance,
      project: memory.project,
    };

    validateCreateMemoryInput(input);

    // Generate vector
    const vector = await generateEmbedding(memory.content);
    const now = Date.now();

    // Create complete memory record
    const record: Memory = {
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
    const table = connectionManager.getTable();
    await table.add([record]);

    console.log(`Stored memory: ${memory.content.slice(0, 50)}...`);
  } catch (error) {
    console.error("Failed to store memory:", error);
    throw error;
  }
}

/**
 * Search for similar memories using vector similarity
 */
export async function searchMemories(
  query: string,
  limit = 10
): Promise<Memory[]> {
  try {
    const queryEmbedding = await generateEmbedding(query);
    const table = connectionManager.getTable();

    const results = await table
      .vectorSearch(queryEmbedding)
      .limit(limit)
      .toArray();

    return results as unknown as Memory[];
  } catch (error) {
    console.error("Failed to search memories:", error);
    throw error;
  }
}

/**
 * Count total number of memories
 */
export async function countMemories(): Promise<number> {
  try {
    const table = connectionManager.getTable();
    return await table.countRows();
  } catch (error) {
    console.error("Failed to count memories:", error);
    throw error;
  }
}

/**
 * Get all memories (use with caution for large datasets)
 */
export async function getAllMemories(): Promise<Memory[]> {
  try {
    const table = connectionManager.getTable();
    return (await table.query().toArray()) as unknown as Memory[];
  } catch (error) {
    console.error("Failed to get all memories:", error);
    throw error;
  }
}

/**
 * Get memories by category
 */
export async function getMemoriesByCategory(
  category: MemoryCategory
): Promise<Memory[]> {
  try {
    const table = connectionManager.getTable();
    const results = await table
      .filter(`category = '${category}'`)
      .toArray();
    return results as unknown as Memory[];
  } catch (error) {
    console.error("Failed to get memories by category:", error);
    throw error;
  }
}

/**
 * Get memories by project
 */
export async function getMemoriesByProject(project: string): Promise<Memory[]> {
  try {
    const table = connectionManager.getTable();
    const results = await table
      .filter(`project = '${project}'`)
      .toArray();
    return results as unknown as Memory[];
  } catch (error) {
    console.error("Failed to get memories by project:", error);
    throw error;
  }
}

/**
 * Get memories with importance >= threshold
 */
export async function getImportantMemories(
  minImportance: number = 7
): Promise<Memory[]> {
  try {
    const table = connectionManager.getTable();
    const results = await table
      .filter(`importance >= ${minImportance}`)
      .toArray();
    return results as unknown as Memory[];
  } catch (error) {
    console.error("Failed to get important memories:", error);
    throw error;
  }
}

/**
 * Update a memory's importance
 */
export async function updateMemoryImportance(
  id: string,
  newImportance: number
): Promise<void> {
  try {
    // Note: LanceDB doesn't support in-place updates yet
    // For now, we'd need to delete and re-insert
    console.warn("Memory updates not yet implemented in LanceDB");
    throw new Error("Memory updates not yet supported");
  } catch (error) {
    console.error("Failed to update memory:", error);
    throw error;
  }
}

/**
 * Delete a memory by ID
 */
export async function deleteMemory(id: string): Promise<void> {
  try {
    const table = connectionManager.getTable();
    await table.delete(`id = '${id}'`);
    console.log(`Deleted memory: ${id}`);
  } catch (error) {
    console.error("Failed to delete memory:", error);
    throw error;
  }
}

/**
 * Gracefully shutdown storage
 */
export async function shutdownStorage(): Promise<void> {
  try {
    await connectionManager.shutdown();
    console.log("Storage shutdown complete");
  } catch (error) {
    console.error("Failed to shutdown storage:", error);
    throw error;
  }
}

/**
 * Get storage health status
 */
export async function getStorageHealth() {
  return await connectionManager.healthCheck();
}
