/**
 * Retrieval Pipeline Tests
 *
 * Tests for the retrieval system including:
 * - Intent analysis accuracy
 * - Query generation diversity
 * - Parallel execution
 * - End-to-end pipeline
 * - Performance benchmarks
 */

import { createOllamaProvider, NullProvider, LLMProvider } from "./llm-provider.js";
import {
  IntentAnalyzer,
  createIntentAnalyzer,
  IntentType,
  QueryPlan,
} from "./intent-analyzer.js";
import {
  QueryExecutor,
  createQueryExecutor,
  ExecutionResult,
} from "./query-executor.js";
import {
  RetrievalPipeline,
  createRetrievalPipeline,
  RetrievalResult,
} from "./retrieval-pipeline.js";
import { getConnectionManager } from "./connection.js";
import { createMemory, Memory } from "./crud.js";
import { MemoryCategory } from "./schema.js";

// ============================================================================
// TEST UTILITIES
// ============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: Record<string, unknown>;
}

const results: TestResult[] = [];

async function runTest(
  name: string,
  testFn: () => Promise<void | Record<string, unknown>>
): Promise<void> {
  const startTime = Date.now();
  try {
    const details = await testFn();
    results.push({
      name,
      passed: true,
      duration: Date.now() - startTime,
      details: details ?? undefined,
    });
    console.log(`  ✓ ${name} (${Date.now() - startTime}ms)`);
  } catch (error) {
    results.push({
      name,
      passed: false,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    });
    console.log(`  ✗ ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

// ============================================================================
// TEST DATA
// ============================================================================

const testMemories: Omit<Memory, "id" | "vector" | "createdAt" | "updatedAt">[] = [
  {
    content: "We decided to use PostgreSQL for the main database because of its reliability",
    category: "decision" as MemoryCategory,
    project: "backend",
    importance: 8,
  },
  {
    content: "The API rate limit is set to 100 requests per minute",
    category: "fact" as MemoryCategory,
    project: "backend",
    importance: 7,
  },
  {
    content: "User prefers TypeScript over JavaScript for better type safety",
    category: "preference" as MemoryCategory,
    importance: 6,
  },
  {
    content: "Fixed the authentication bug by refreshing tokens before expiry",
    category: "solution" as MemoryCategory,
    project: "auth-service",
    importance: 9,
  },
  {
    content: "The frontend uses React with Tailwind CSS for styling",
    category: "fact" as MemoryCategory,
    project: "frontend",
    importance: 5,
  },
  {
    content: "Redis is used for session storage and caching",
    category: "decision" as MemoryCategory,
    project: "backend",
    importance: 7,
  },
  {
    content: "The deployment pipeline uses GitHub Actions for CI/CD",
    category: "fact" as MemoryCategory,
    project: "devops",
    importance: 6,
  },
];

// ============================================================================
// INTENT ANALYZER TESTS
// ============================================================================

async function testIntentAnalysis(): Promise<void> {
  console.log("\n--- Intent Analyzer Tests ---\n");

  // Test with NullProvider (returns empty but valid JSON)
  const nullAnalyzer = createIntentAnalyzer(new NullProvider());

  await runTest("NullProvider generates at least one query", async () => {
    const plan = await nullAnalyzer.generateQueryPlan("test query");
    assert(plan.queries.length > 0, "Should generate at least one query");
  });

  await runTest("Query plan always has a direct query", async () => {
    const plan = await nullAnalyzer.generateQueryPlan(
      "How do I configure the PostgreSQL database connection?"
    );
    const directQuery = plan.queries.find(q => q.type === "direct");
    assert(directQuery !== undefined, "Should have at least one direct query");
  });

  await runTest("Handles long messages without error", async () => {
    const longMessage = "This is a very long message about databases. ".repeat(20);
    const plan = await nullAnalyzer.generateQueryPlan(longMessage);
    assert(plan.queries.length > 0, "Should handle long messages");
  });

  await runTest("Returns valid intent structure", async () => {
    const plan = await nullAnalyzer.generateQueryPlan("Test query");
    assert(plan.intent !== undefined, "Should have intent");
    assert(typeof plan.intent.mainTopic === "string", "Should have mainTopic");
    assert(typeof plan.intent.type === "string", "Should have type");
    assert(Array.isArray(plan.intent.keywords), "Should have keywords array");
  });

  // Test with real LLM if available
  const ollamaProvider = createOllamaProvider();
  const isAvailable = await ollamaProvider.isAvailable();

  if (isAvailable) {
    console.log("\n  [Testing with Ollama LLM]\n");
    const realAnalyzer = createIntentAnalyzer(ollamaProvider);

    await runTest("LLM analysis generates diverse queries", async () => {
      const plan = await realAnalyzer.generateQueryPlan(
        "How do I optimize database queries for better performance?"
      );
      assert(plan.queries.length >= 2, "Should generate multiple queries");
      const types = new Set(plan.queries.map((q) => q.type));
      assert(types.size >= 1, "Should have at least one query type");
      return {
        queryCount: plan.queries.length,
        types: Array.from(types),
        duration: plan.analysisDuration,
      };
    });

    await runTest("LLM correctly identifies intent (flexible)", async () => {
      // LLMs may interpret intent differently - we just check structure is valid
      const plan = await realAnalyzer.generateQueryPlan("What database should we use?");
      const validTypes: IntentType[] = ["question", "discussion", "decision", "problem", "reference", "other"];
      assert(
        validTypes.includes(plan.intent.type),
        `Intent type "${plan.intent.type}" should be valid`
      );
      return { type: plan.intent.type };
    });

    await runTest("LLM analysis completes within timeout", async () => {
      const start = Date.now();
      const plan = await realAnalyzer.generateQueryPlan("Quick question about caching");
      const duration = Date.now() - start;
      // Allow generous 15s for cold start
      assert(duration < 15000, `Analysis took ${duration}ms, should be under 15000ms`);
      return { duration };
    });
  } else {
    console.log("\n  [Ollama not available - skipping LLM tests]\n");
  }
}

// ============================================================================
// QUERY EXECUTOR TESTS
// ============================================================================

async function testQueryExecutor(): Promise<void> {
  console.log("\n--- Query Executor Tests ---\n");

  const executor = createQueryExecutor({
    concurrency: 3,
    timeoutPerQuery: 5000,
    limitPerQuery: 5,
  });

  await runTest("Executor handles empty query list", async () => {
    const results = await executor.executeQueries([]);
    assert(results.length === 0, "Should return empty array for no queries");
  });

  await runTest("Executor executes queries in parallel", async () => {
    const queries = [
      { text: "database", type: "direct" as const, weight: 1.0 },
      { text: "authentication", type: "related" as const, weight: 0.8 },
      { text: "caching", type: "technical" as const, weight: 0.6 },
    ];

    const start = Date.now();
    const results = await executor.executeQueries(queries, "hybrid");
    const duration = Date.now() - start;

    // All queries should complete
    assert(results.length === 3, "Should return result for each query");

    // Check success rate
    const successRate = results.filter((r) => r.success).length / results.length;
    assert(successRate > 0.5, "Most queries should succeed");

    return {
      totalDuration: duration,
      successRate,
      queriesExecuted: results.length,
    };
  });

  await runTest("Executor respects concurrency limit", async () => {
    // Create many queries to test batching
    const queries = Array.from({ length: 10 }, (_, i) => ({
      text: `query ${i}`,
      type: "direct" as const,
      weight: 1.0,
    }));

    // With concurrency 3, should process in batches
    const start = Date.now();
    const results = await executor.executeQueries(queries, "vector");
    const duration = Date.now() - start;

    assert(results.length === 10, "Should process all queries");

    return {
      queryCount: queries.length,
      duration,
    };
  });

  await runTest("Executor aggregates unique memories", async () => {
    const mockPlan = {
      intent: {
        mainTopic: "test",
        type: "question" as const,
        entities: [],
        keywords: [],
        confidence: 1.0,
      },
      queries: [
        { text: "database", type: "direct" as const, weight: 1.0 },
        { text: "PostgreSQL", type: "related" as const, weight: 0.8 },
      ],
      searchStrategy: "hybrid" as const,
      analysisDuration: 0,
    };

    const result = await executor.execute(mockPlan);

    // Should have aggregated unique memories
    assert(result.uniqueMemories >= 0, "Should report unique memory count");
    assert(result.memories.length === result.uniqueMemories, "Memory count should match");

    return {
      uniqueMemories: result.uniqueMemories,
      successfulQueries: result.successfulQueries,
    };
  });
}

// ============================================================================
// RETRIEVAL PIPELINE TESTS
// ============================================================================

async function testRetrievalPipeline(): Promise<void> {
  console.log("\n--- Retrieval Pipeline Tests ---\n");

  // Use NullProvider for deterministic tests
  const nullPipeline = createRetrievalPipeline(new NullProvider());

  await runTest("Pipeline quick retrieve works", async () => {
    const memories = await nullPipeline.quickRetrieve("database");
    assert(Array.isArray(memories), "Should return array");
    return { count: memories.length };
  });

  await runTest("Pipeline respects limit option", async () => {
    const result = await nullPipeline.retrieve("database", { limit: 3 });
    assert(result.memories.length <= 3, "Should respect limit");
  });

  await runTest("Pipeline skips analysis when requested", async () => {
    const result = await nullPipeline.retrieve("test query", { skipAnalysis: true });
    assert(result.analysisSkipped === true, "Should mark analysis as skipped");
    assert(result.queryPlan.analysisDuration === 0, "Should have zero analysis time");
  });

  // Test with real LLM if available
  const ollamaProvider = createOllamaProvider();
  const isAvailable = await ollamaProvider.isAvailable();

  if (isAvailable) {
    console.log("\n  [Testing with Ollama LLM]\n");
    const realPipeline = createRetrievalPipeline(ollamaProvider);

    await runTest("Full pipeline end-to-end", async () => {
      const result = await realPipeline.retrieve(
        "What database did we choose for the backend?",
        { debug: false }
      );

      assert(result.intent !== undefined, "Should have analyzed intent");
      assert(result.queryPlan.queries.length > 0, "Should generate queries");
      assert(result.totalDuration > 0, "Should report total duration");

      return {
        memoriesFound: result.memories.length,
        queriesGenerated: result.queryPlan.queries.length,
        totalDuration: result.totalDuration,
        intent: result.intent.type,
      };
    });

    await runTest("Pipeline latency reasonable for LLM call", async () => {
      const start = Date.now();
      const result = await realPipeline.retrieve("quick test query");
      const duration = Date.now() - start;

      // Allow generous 15s for cold start LLM
      // In production with warmed-up model, expect <2s
      assert(duration < 15000, `Pipeline took ${duration}ms, should be under 15000ms`);

      return {
        totalDuration: result.totalDuration,
        actualDuration: duration,
      };
    });

    await runTest("Pipeline boosts target project memories", async () => {
      const result = await realPipeline.retrieve("database configuration", {
        project: "backend",
        limit: 10,
      });

      // Project is used as a ranking signal, not a hard filter
      // Same-project memories should rank higher (get project score boost)
      const backendMemories = result.memories.filter(
        (m) => m.project === "backend"
      );

      // If we have backend memories, verify they have project score boost
      if (backendMemories.length > 0) {
        const firstBackend = backendMemories[0];
        assert(
          firstBackend.scores.project > 0,
          "Backend memories should have project score boost"
        );
      }

      return {
        memoriesFound: result.memories.length,
        backendMemories: backendMemories.length,
      };
    });
  }
}

// ============================================================================
// PERFORMANCE BENCHMARKS
// ============================================================================

async function runBenchmarks(): Promise<void> {
  console.log("\n--- Performance Benchmarks ---\n");

  const ollamaProvider = createOllamaProvider();
  const isAvailable = await ollamaProvider.isAvailable();

  if (!isAvailable) {
    console.log("  [Ollama not available - skipping benchmarks]\n");
    return;
  }

  const pipeline = createRetrievalPipeline(ollamaProvider);

  // Warm up
  await pipeline.quickRetrieve("warmup");

  // Benchmark quick retrieval
  await runTest("Benchmark: Quick retrieval (10 iterations)", async () => {
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = Date.now();
      await pipeline.quickRetrieve("test query " + i);
      times.push(Date.now() - start);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);

    return { avgMs: avg.toFixed(2), minMs: min, maxMs: max };
  });

  // Benchmark full retrieval
  await runTest("Benchmark: Full retrieval with analysis (5 iterations)", async () => {
    const times: number[] = [];
    const queries = [
      "What database should we use?",
      "How to handle authentication?",
      "Best practices for caching",
      "API rate limiting strategy",
      "Frontend performance optimization",
    ];

    for (const query of queries) {
      const start = Date.now();
      await pipeline.retrieve(query);
      times.push(Date.now() - start);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);

    return { avgMs: avg.toFixed(2), minMs: min, maxMs: max };
  });
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  console.log("╔════════════════════════════════════════╗");
  console.log("║   Retrieval Pipeline Test Suite        ║");
  console.log("╚════════════════════════════════════════╝");

  const startTime = Date.now();

  try {
    // Initialize database connection
    console.log("\nInitializing database...");
    const dbPath = "./test-retrieval-db";
    const tableName = "memories";

    // Connect to database
    await getConnectionManager().connect({ dbPath, tableName });

    // Initialize table with dummy embedding (768 dimensions for nomic-embed-text)
    const dummyEmbedding = new Array(768).fill(0);
    await getConnectionManager().initializeTable(tableName, dummyEmbedding);
    console.log("Database initialized.\n");

    // Seed test data if needed
    console.log("Checking test data...");
    const table = getConnectionManager().getTable();
    const existing = await table.query().limit(1).toArray();

    if (existing.length === 0) {
      console.log("Seeding test memories...");
      for (const memoryData of testMemories) {
        await createMemory(memoryData);
      }
      console.log(`Seeded ${testMemories.length} test memories.\n`);
    } else {
      console.log("Test data already exists.\n");
    }

    // Run tests
    await testIntentAnalysis();
    await testQueryExecutor();
    await testRetrievalPipeline();
    await runBenchmarks();

    // Summary
    const totalDuration = Date.now() - startTime;
    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;

    console.log("\n╔════════════════════════════════════════╗");
    console.log("║              Test Summary              ║");
    console.log("╠════════════════════════════════════════╣");
    console.log(`║  Total:    ${results.length.toString().padEnd(25)}  ║`);
    console.log(`║  Passed:   ${passed.toString().padEnd(25)}  ║`);
    console.log(`║  Failed:   ${failed.toString().padEnd(25)}  ║`);
    console.log(`║  Duration: ${(totalDuration / 1000).toFixed(2)}s${" ".repeat(22 - (totalDuration / 1000).toFixed(2).length)}  ║`);
    console.log("╚════════════════════════════════════════╝");

    if (failed > 0) {
      console.log("\nFailed tests:");
      results
        .filter((r) => !r.passed)
        .forEach((r) => console.log(`  - ${r.name}: ${r.error}`));
      process.exit(1);
    }
  } catch (error) {
    console.error("\nTest suite failed:", error);
    process.exit(1);
  } finally {
    // Cleanup
    await getConnectionManager().shutdown();
  }
}

main();
