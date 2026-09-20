import * as lancedb from "@lancedb/lancedb";
import { createEmbeddingProvider, EmbeddingProvider } from "./embeddings.js";
import { CachedEmbeddingProvider } from "./embedding-cache.js";

const DB_PATH = "./memory-store";

export interface Memory {
  id: string;
  content: string;
  category: "decision" | "fact" | "preference" | "solution" | "context";
  project?: string;
  importance: number;
  embedding: number[];
  createdAt: number;
  updatedAt: number;
}

let db: lancedb.Connection | null = null;
let table: lancedb.Table | null = null;
let embeddingProvider: EmbeddingProvider | null = null;

export async function initStorage(): Promise<void> {
  // Initialize embedding provider with caching
  const baseProvider = createEmbeddingProvider({
    model: "nomic-embed-text",
    dimensions: 768,
    batchSize: 10,
    maxConcurrency: 3,
  });
  embeddingProvider = new CachedEmbeddingProvider(baseProvider, 1000);

  console.log(`Initialized embedding provider: ${embeddingProvider.getProviderName()}`);

  // Test connection to Ollama
  const baseOllamaProvider = baseProvider as any;
  if (baseOllamaProvider.testConnection) {
    const connectionTest = await baseOllamaProvider.testConnection();
    if (!connectionTest.available) {
      throw new Error(
        `Failed to connect to Ollama: ${connectionTest.error}\n` +
        `Please ensure Ollama is running and the model 'nomic-embed-text' is installed.`
      );
    }
  }

  db = await lancedb.connect(DB_PATH);

  const tables = await db.tableNames();
  if (tables.includes("memories")) {
    table = await db.openTable("memories");
    console.log("Opened existing memories table");
  } else {
    // Create with a dummy record to establish schema
    const dummyEmbedding = await generateEmbedding("init");
    table = await db.createTable("memories", [
      {
        id: "init",
        content: "Memory system initialized",
        category: "context",
        project: "system",
        importance: 0,
        embedding: dummyEmbedding,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);
    console.log("Created new memories table");
  }
}

export async function generateEmbedding(text: string): Promise<number[]> {
  if (!embeddingProvider) {
    throw new Error("Storage not initialized. Call initStorage() first.");
  }
  return await embeddingProvider.embed(text);
}

export async function generateEmbeddingBatch(texts: string[]): Promise<number[][]> {
  if (!embeddingProvider) {
    throw new Error("Storage not initialized. Call initStorage() first.");
  }
  return await embeddingProvider.embedBatch(texts, (progress) => {
    console.log(`Embedding progress: ${progress.completed}/${progress.total} (${progress.percentage}%)`);
  });
}

export function getEmbeddingProvider(): EmbeddingProvider | null {
  return embeddingProvider;
}

export function getCacheStats(): string | null {
  if (!embeddingProvider || !(embeddingProvider instanceof CachedEmbeddingProvider)) {
    return null;
  }
  return embeddingProvider.formatCacheStats();
}

export async function storeMemory(memory: Omit<Memory, "embedding" | "id" | "createdAt" | "updatedAt">): Promise<void> {
  if (!table) throw new Error("Storage not initialized");

  const embedding = await generateEmbedding(memory.content);
  const now = Date.now();

  // Create record with exact field order matching the schema
  const record: Memory = {
    id: `mem_${now}_${Math.random().toString(36).slice(2, 8)}`,
    content: memory.content,
    category: memory.category,
    project: memory.project || "",
    importance: memory.importance,
    embedding,
    createdAt: now,
    updatedAt: now,
  };

  await table.add([record]);
  console.log(`Stored memory: ${memory.content.slice(0, 50)}...`);
}

export async function searchMemories(query: string, limit = 10): Promise<Memory[]> {
  if (!table) throw new Error("Storage not initialized");

  const queryEmbedding = await generateEmbedding(query);

  const results = await table
    .vectorSearch(queryEmbedding)
    .limit(limit)
    .toArray();

  return results as unknown as Memory[];
}

export async function countMemories(): Promise<number> {
  if (!table) throw new Error("Storage not initialized");
  return await table.countRows();
}

export async function getAllMemories(): Promise<Memory[]> {
  if (!table) throw new Error("Storage not initialized");
  return await table.query().toArray() as unknown as Memory[];
}
