/**
 * Performance Benchmarks
 *
 * Comprehensive benchmark suite for the OpenClaw Smart Memory System.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { initMemorySystem, getMemorySystem, resetMemorySystem } from "./memory-system.js";
import { createContextHook } from "./hooks/context-hook.js";
import { searchByText } from "./search.js";
import { getConnectionManager } from "./connection.js";
import { Memory } from "./schema.js";

// ============================================================================
// TYPES
// ============================================================================

interface BenchmarkResult {
  name: string;
  category: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p95Ms: number;
  opsPerSecond: number;
}

interface BenchmarkSuite {
  name: string;
  category: string;
  warmup: number;
  iterations: number;
  fn: () => Promise<void>;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const BENCHMARK_DB_PATH = "./benchmark-db";
const BENCHMARK_RESULTS_DIR = "./benchmarks";

// ============================================================================
// UTILITIES
// ============================================================================

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

async function runBenchmark(suite: BenchmarkSuite): Promise<BenchmarkResult> {
  const times: number[] = [];

  // Warmup
  for (let i = 0; i < suite.warmup; i++) {
    await suite.fn();
  }

  // Actual benchmark
  for (let i = 0; i < suite.iterations; i++) {
    const start = performance.now();
    await suite.fn();
    times.push(performance.now() - start);
  }

  const totalMs = times.reduce((a, b) => a + b, 0);
  const avgMs = totalMs / times.length;
  const minMs = Math.min(...times);
  const maxMs = Math.max(...times);
  const p95Ms = percentile(times, 95);
  const opsPerSecond = 1000 / avgMs;

  return {
    name: suite.name,
    category: suite.category,
    iterations: suite.iterations,
    totalMs: Math.round(totalMs),
    avgMs: Math.round(avgMs * 100) / 100,
    minMs: Math.round(minMs * 100) / 100,
    maxMs: Math.round(maxMs * 100) / 100,
    p95Ms: Math.round(p95Ms * 100) / 100,
    opsPerSecond: Math.round(opsPerSecond * 10) / 10,
  };
}

// ============================================================================
// BENCHMARK SUITES
// ============================================================================

async function getStorageBenchmarks(): Promise<BenchmarkSuite[]> {
  const system = getMemorySystem();
  let testMemoryId: string | null = null;

  return [
    {
      name: "Memory Create (single)",
      category: "Storage",
      warmup: 2,
      iterations: 20,
      fn: async () => {
        const memory = await system.memories.create({
          content: `Benchmark memory created at ${Date.now()}`,
          category: "fact",
          importance: 5,
          project: "benchmark",
          tags: ["bench"],
        });
        testMemoryId = memory.id;
      },
    },
    {
      name: "Memory Get",
      category: "Storage",
      warmup: 2,
      iterations: 50,
      fn: async () => {
        if (testMemoryId) {
          await system.memories.get(testMemoryId);
        }
      },
    },
    {
      name: "Memory Update",
      category: "Storage",
      warmup: 2,
      iterations: 20,
      fn: async () => {
        if (testMemoryId) {
          await system.memories.update(testMemoryId, {
            importance: Math.floor(Math.random() * 10),
          });
        }
      },
    },
    {
      name: "Memory Count",
      category: "Storage",
      warmup: 2,
      iterations: 50,
      fn: async () => {
        await system.memories.count();
      },
    },
  ];
}

async function getSearchBenchmarks(): Promise<BenchmarkSuite[]> {
  const system = getMemorySystem();

  return [
    {
      name: "Vector Search (limit 5)",
      category: "Search",
      warmup: 3,
      iterations: 20,
      fn: async () => {
        await system.memories.search("benchmark test query for search", 5);
      },
    },
    {
      name: "Vector Search (limit 20)",
      category: "Search",
      warmup: 3,
      iterations: 20,
      fn: async () => {
        await system.memories.search("benchmark test query for search", 20);
      },
    },
  ];
}

async function getRetrievalBenchmarks(): Promise<BenchmarkSuite[]> {
  const system = getMemorySystem();

  return [
    {
      name: "Recall (warm)",
      category: "Retrieval",
      warmup: 2,
      iterations: 5,
      fn: async () => {
        await system.recall("How do we handle authentication in our system?", {
          maxTokens: 1000,
          project: "benchmark",
        });
      },
    },
    {
      name: "Context Hook (cached)",
      category: "Retrieval",
      warmup: 2,
      iterations: 20,
      fn: async () => {
        const hook = createContextHook({
          enableCache: true,
          autoInit: false,
        });
        await hook.getContext("benchmark query for caching");
      },
    },
  ];
}

// ============================================================================
// MAIN
// ============================================================================

async function setupBenchmarkEnvironment(): Promise<void> {
  // Clean up any existing benchmark data
  try {
    await fs.rm(BENCHMARK_DB_PATH, { recursive: true, force: true });
  } catch {
    // Ignore
  }

  // Initialize system
  await initMemorySystem({
    dbPath: BENCHMARK_DB_PATH,
    enableSync: false,
    enableAutoExtraction: true,
    logLevel: "error",
  });

  // Seed with some data
  const system = getMemorySystem();
  const projects = ["frontend", "backend", "api", "infra"];
  const categories: Array<"fact" | "decision" | "preference" | "context"> = [
    "fact",
    "decision",
    "preference",
    "context",
  ];

  console.log("  Seeding benchmark data...");
  for (let i = 0; i < 100; i++) {
    await system.memories.create({
      content: `Memory ${i + 1}: This is benchmark data about ${projects[i % 4]} discussing topic ${Math.floor(i / 10) + 1}. It contains information about configuration, best practices, and implementation details for testing purposes.`,
      category: categories[i % 4],
      importance: (i % 10) + 1,
      project: projects[i % 4],
      tags: [`topic-${Math.floor(i / 10)}`, projects[i % 4]],
    });
  }
  console.log("  Seeded 100 memories");
}

async function cleanupBenchmarkEnvironment(): Promise<void> {
  await resetMemorySystem();
  try {
    await fs.rm(BENCHMARK_DB_PATH, { recursive: true, force: true });
  } catch {
    // Ignore
  }
}

function formatResultsTable(results: BenchmarkResult[]): string {
  const lines: string[] = [];
  let currentCategory = "";

  for (const result of results) {
    if (result.category !== currentCategory) {
      if (currentCategory !== "") {
        lines.push("");
      }
      currentCategory = result.category;
      lines.push(`${currentCategory}`);
      lines.push("─".repeat(60));
    }

    const name = result.name.padEnd(30);
    const avg = `${result.avgMs}ms`.padStart(10);
    const ops = `${result.opsPerSecond} ops/s`.padStart(12);
    const p95 = `p95: ${result.p95Ms}ms`.padStart(14);

    lines.push(`  ${name} | ${avg} | ${ops} | ${p95}`);
  }

  return lines.join("\n");
}

async function saveResults(results: BenchmarkResult[]): Promise<string> {
  // Ensure results directory exists
  await fs.mkdir(BENCHMARK_RESULTS_DIR, { recursive: true });

  // Generate filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `benchmark-${timestamp}.json`;
  const filepath = path.join(BENCHMARK_RESULTS_DIR, filename);

  // Save results
  const data = {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    results,
  };

  await fs.writeFile(filepath, JSON.stringify(data, null, 2));
  return filepath;
}

async function main(): Promise<void> {
  console.log("═".repeat(60));
  console.log("   OpenClaw Memory System - Performance Benchmarks");
  console.log("═".repeat(60));
  console.log("");

  const allResults: BenchmarkResult[] = [];

  try {
    // Setup
    console.log("Setting up benchmark environment...");
    await setupBenchmarkEnvironment();
    console.log("");

    // Storage benchmarks
    console.log("Running Storage benchmarks...");
    const storageSuites = await getStorageBenchmarks();
    for (const suite of storageSuites) {
      process.stdout.write(`  ${suite.name}...`);
      const result = await runBenchmark(suite);
      allResults.push(result);
      console.log(` ${result.avgMs}ms avg`);
    }
    console.log("");

    // Search benchmarks
    console.log("Running Search benchmarks...");
    const searchSuites = await getSearchBenchmarks();
    for (const suite of searchSuites) {
      process.stdout.write(`  ${suite.name}...`);
      const result = await runBenchmark(suite);
      allResults.push(result);
      console.log(` ${result.avgMs}ms avg`);
    }
    console.log("");

    // Retrieval benchmarks
    console.log("Running Retrieval benchmarks...");
    const retrievalSuites = await getRetrievalBenchmarks();
    for (const suite of retrievalSuites) {
      process.stdout.write(`  ${suite.name}...`);
      const result = await runBenchmark(suite);
      allResults.push(result);
      console.log(` ${result.avgMs}ms avg`);
    }
    console.log("");

  } finally {
    // Cleanup
    console.log("Cleaning up...");
    await cleanupBenchmarkEnvironment();
  }

  // Print results
  console.log("");
  console.log("═".repeat(60));
  console.log("   Results");
  console.log("═".repeat(60));
  console.log("");
  console.log(formatResultsTable(allResults));
  console.log("");

  // Save results
  const savedPath = await saveResults(allResults);
  console.log(`Results saved to: ${savedPath}`);

  // Summary
  console.log("");
  console.log("═".repeat(60));
  console.log("   Summary");
  console.log("═".repeat(60));

  const storageResults = allResults.filter((r) => r.category === "Storage");
  const searchResults = allResults.filter((r) => r.category === "Search");
  const retrievalResults = allResults.filter((r) => r.category === "Retrieval");

  if (storageResults.length > 0) {
    const avgStorage = storageResults.reduce((a, b) => a + b.avgMs, 0) / storageResults.length;
    console.log(`  Storage avg:    ${avgStorage.toFixed(1)}ms`);
  }
  if (searchResults.length > 0) {
    const avgSearch = searchResults.reduce((a, b) => a + b.avgMs, 0) / searchResults.length;
    console.log(`  Search avg:     ${avgSearch.toFixed(1)}ms`);
  }
  if (retrievalResults.length > 0) {
    const avgRetrieval = retrievalResults.reduce((a, b) => a + b.avgMs, 0) / retrievalResults.length;
    console.log(`  Retrieval avg:  ${avgRetrieval.toFixed(1)}ms`);
  }

  console.log("");
  console.log("═".repeat(60));
}

main().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
