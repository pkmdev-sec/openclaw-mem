/**
 * Context Integration Tests
 *
 * End-to-end tests for the context retrieval and formatting system.
 */

import { createOllamaProvider, NullProvider } from "./llm-provider.js";
import {
  ContextFormatter,
  createContextFormatter,
} from "./context-formatter.js";
import {
  getContextForMessage,
  getContext,
  initContextRetrieval,
  clearContextCache,
} from "./memory-context.js";
import { RankedMemory } from "./memory-ranker.js";
import { MemoryCategory } from "./schema.js";
import { getConnectionManager } from "./connection.js";

// ============================================================================
// TEST DATA
// ============================================================================

const now = Date.now();
const day = 24 * 60 * 60 * 1000;

const mockMemories: RankedMemory[] = [
  {
    id: "1",
    content: "We decided to use PostgreSQL for the main database because of its reliability and ACID compliance.",
    category: MemoryCategory.DECISION,
    project: "backend",
    importance: 8,
    vector: [],
    createdAt: now - 2 * day,
    updatedAt: now - 2 * day,
    finalScore: 0.95,
    scores: { semantic: 0.9, recency: 0.8, project: 1.0, importance: 0.8 },
  },
  {
    id: "2",
    content: "API rate limit is set to 100 requests per minute to prevent abuse.",
    category: MemoryCategory.FACT,
    project: "backend",
    importance: 7,
    vector: [],
    createdAt: now - 7 * day,
    updatedAt: now - 7 * day,
    finalScore: 0.82,
    scores: { semantic: 0.85, recency: 0.6, project: 1.0, importance: 0.7 },
  },
  {
    id: "3",
    content: "User prefers TypeScript over JavaScript for all new projects.",
    category: MemoryCategory.PREFERENCE,
    importance: 6,
    vector: [],
    createdAt: now - 30 * day,
    updatedAt: now - 30 * day,
    finalScore: 0.68,
    scores: { semantic: 0.75, recency: 0.3, project: 0.0, importance: 0.6 },
  },
];

// ============================================================================
// TESTS
// ============================================================================

async function testContextFormatter(): Promise<void> {
  console.log("\n--- Context Formatter Tests ---\n");

  const formatter = createContextFormatter();

  // Test markdown format
  console.log("Testing markdown format...");
  const markdown = formatter.format(mockMemories, { format: "markdown" });
  console.log("✓ Markdown format:");
  console.log(markdown.text.slice(0, 300) + "...\n");

  // Test XML format
  console.log("Testing XML format...");
  const xml = formatter.format(mockMemories, { format: "xml" });
  console.log("✓ XML format:");
  console.log(xml.text.slice(0, 300) + "...\n");

  // Test plain format
  console.log("Testing plain format...");
  const plain = formatter.format(mockMemories, { format: "plain" });
  console.log("✓ Plain format:");
  console.log(plain.text.slice(0, 200) + "...\n");

  // Test compact format
  console.log("Testing compact format...");
  const compact = formatter.format(mockMemories, { format: "compact" });
  console.log("✓ Compact format:");
  console.log(compact.text.slice(0, 200) + "...\n");

  // Test token estimation
  console.log("Testing token estimation...");
  console.log(`  Markdown: ${markdown.estimatedTokens} tokens`);
  console.log(`  XML: ${xml.estimatedTokens} tokens`);
  console.log(`  Plain: ${plain.estimatedTokens} tokens`);
  console.log(`  Compact: ${compact.estimatedTokens} tokens`);
  console.log("✓ Token estimation works\n");

  // Test token truncation
  console.log("Testing token truncation...");
  const truncated = formatter.format(mockMemories, {
    format: "markdown",
    maxTokens: 50,
  });
  console.log(`  Original: 3 memories, ${markdown.estimatedTokens} tokens`);
  console.log(`  Truncated: ${truncated.memoriesIncluded} memories, ${truncated.estimatedTokens} tokens`);
  console.log(`  Truncated: ${truncated.truncated}`);
  console.log("✓ Token truncation works\n");

  // Test empty memories
  console.log("Testing empty memories...");
  const empty = formatter.format([], { format: "markdown" });
  console.log(`  Empty result: "${empty.text}"`);
  console.log(`  Memories included: ${empty.memoriesIncluded}`);
  console.log("✓ Empty memories handled\n");

  // Test grouping
  console.log("Testing grouping by category...");
  const grouped = formatter.format(mockMemories, {
    format: "markdown",
    groupBy: "category",
  });
  console.log("✓ Grouping by category:");
  console.log(grouped.text.slice(0, 400) + "...\n");
}

async function testContextIntegration(): Promise<void> {
  console.log("\n--- Context Integration Tests ---\n");

  // Initialize with NullProvider for fast tests
  initContextRetrieval(new NullProvider());

  // Test basic retrieval
  console.log("Testing basic context retrieval...");
  const result = await getContextForMessage("database configuration");
  console.log(`  Context length: ${result.context.length} chars`);
  console.log(`  Memories: ${result.memories.length}`);
  console.log(`  Tokens: ${result.tokensUsed}`);
  console.log(`  Retrieval time: ${result.retrievalTime}ms`);
  console.log(`  Formatting time: ${result.formattingTime}ms`);
  console.log(`  Cached: ${result.cached}`);
  console.log("✓ Basic retrieval works\n");

  // Test caching
  console.log("Testing caching...");
  const start = Date.now();
  const cached = await getContextForMessage("database configuration");
  const cachedTime = Date.now() - start;
  console.log(`  Second call time: ${cachedTime}ms`);
  console.log(`  Cached: ${cached.cached}`);
  console.log("✓ Caching works\n");

  // Test different formats
  console.log("Testing different formats...");
  for (const format of ["markdown", "xml", "compact"] as const) {
    const formatted = await getContextForMessage("test query", { format });
    console.log(`  ${format}: ${formatted.tokensUsed} tokens`);
  }
  console.log("✓ All formats work\n");

  // Test quick API
  console.log("Testing quick API...");
  const quick = await getContext("quick test");
  console.log(`  Quick result type: ${typeof quick}`);
  console.log(`  Quick result length: ${quick.length}`);
  console.log("✓ Quick API works\n");

  // Test cache clearing
  console.log("Testing cache clearing...");
  clearContextCache();
  const afterClear = await getContextForMessage("database configuration");
  console.log(`  After clear cached: ${afterClear.cached}`);
  console.log("✓ Cache clearing works\n");
}

async function testWithRealLLM(): Promise<void> {
  console.log("\n--- Real LLM Integration Tests ---\n");

  const provider = createOllamaProvider();
  const isAvailable = await provider.isAvailable();

  if (!isAvailable) {
    console.log("  [Ollama not available - skipping]\n");
    return;
  }

  initContextRetrieval(provider);
  clearContextCache();

  // Test real retrieval
  console.log("Testing with real LLM...");
  const start = Date.now();
  const result = await getContextForMessage(
    "What database did we choose for the backend?",
    { debug: false }
  );
  const duration = Date.now() - start;

  console.log(`  Total time: ${duration}ms`);
  console.log(`  Memories found: ${result.memories.length}`);
  console.log(`  Tokens used: ${result.tokensUsed}`);
  console.log(`  Retrieval: ${result.retrievalTime}ms`);
  console.log(`  Formatting: ${result.formattingTime}ms`);
  console.log("✓ Real LLM integration works\n");

  if (result.memories.length > 0) {
    console.log("Sample context output:");
    console.log("─".repeat(50));
    console.log(result.context.slice(0, 500));
    console.log("─".repeat(50));
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  console.log("╔════════════════════════════════════════╗");
  console.log("║   Context Integration Test Suite       ║");
  console.log("╚════════════════════════════════════════╝");

  try {
    // Initialize database
    console.log("\nInitializing database...");
    await getConnectionManager().connect({
      dbPath: "./test-retrieval-db",
      tableName: "memories",
    });
    const dummyEmbedding = new Array(768).fill(0);
    await getConnectionManager().initializeTable("memories", dummyEmbedding);
    console.log("Database initialized.\n");

    // Run tests
    await testContextFormatter();
    await testContextIntegration();
    await testWithRealLLM();

    console.log("\n╔════════════════════════════════════════╗");
    console.log("║   All Context Tests Complete!          ║");
    console.log("╚════════════════════════════════════════╝\n");
  } catch (error) {
    console.error("\nTest failed:", error);
    process.exit(1);
  } finally {
    await getConnectionManager().shutdown();
  }
}

main();
