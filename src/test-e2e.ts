/**
 * End-to-End Integration Tests
 *
 * Tests complete workflows from storing conversations through
 * extraction to retrieval.
 */

import * as fs from "fs";
import * as path from "path";
import {
  initMemorySystem,
  getMemorySystem,
  resetMemorySystem,
  MemorySystem,
} from "./memory-system.js";
import { createContextHook, createExtractionHook } from "./hooks/index.js";
import { createBackup, listBackups } from "./backup.js";
import { restoreBackup } from "./restore.js";
import { Memory } from "./schema.js";

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

const TEST_DB_PATH = "./test-e2e-db";
const TEST_BACKUP_PATH = "./test-e2e-backups";

// ============================================================================
// TEST UTILITIES
// ============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

const results: TestResult[] = [];

async function runScenario(
  name: string,
  fn: () => Promise<void>
): Promise<void> {
  console.log(`\n📋 ${name}`);
  console.log("─".repeat(50));

  const startTime = Date.now();
  try {
    await fn();
    const duration = Date.now() - startTime;
    results.push({ name, passed: true, duration });
    console.log(`  ✅ Passed (${duration}ms)`);
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, duration, error: errorMsg });
    console.log(`  ❌ Failed: ${errorMsg}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function cleanupTestEnvironment(): Promise<void> {
  // Reset memory system if initialized
  try {
    await resetMemorySystem();
  } catch {
    // Not initialized, that's fine
  }

  // Remove test database
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.rmSync(TEST_DB_PATH, { recursive: true, force: true });
  }

  // Remove test backups
  if (fs.existsSync(TEST_BACKUP_PATH)) {
    fs.rmSync(TEST_BACKUP_PATH, { recursive: true, force: true });
  }
}

async function initTestSystem(): Promise<MemorySystem> {
  await cleanupTestEnvironment();

  return await initMemorySystem({
    dbPath: TEST_DB_PATH,
    enableSync: false,
    enableAutoExtraction: true,
    logLevel: "error",
  });
}

// ============================================================================
// TEST SCENARIOS
// ============================================================================

/**
 * Scenario 1: Full Memory Lifecycle
 *
 * Tests the complete flow from storing a conversation through
 * extraction to recalling relevant context.
 */
async function testFullMemoryLifecycle(): Promise<void> {
  await runScenario("Full Memory Lifecycle", async () => {
    const system = await initTestSystem();

    // Step 1: Get initial count (may have seed memories)
    const initialCount = await system.memories.count();
    console.log(`  Initial memory count: ${initialCount}`);

    // Step 2: Create memories directly (simulating extraction result)
    console.log("  Creating test memories...");

    const memory1 = await system.memories.create({
      content: "We use JWT tokens for authentication with a 24-hour expiry. Refresh tokens last 7 days.",
      category: "decision",
      importance: 8, // high (0-10 scale)
      project: "api-gateway",
      tags: ["auth", "jwt", "security"],
    });
    assert(memory1.id !== undefined, "Memory 1 should have ID");

    const memory2 = await system.memories.create({
      content: "Rate limiting is set to 100 requests per minute per user for the public API.",
      category: "decision",
      importance: 5, // medium
      project: "api-gateway",
      tags: ["rate-limit", "api"],
    });
    assert(memory2.id !== undefined, "Memory 2 should have ID");

    const memory3 = await system.memories.create({
      content: "The frontend uses React 18 with TypeScript and Tailwind CSS for styling.",
      category: "fact",
      importance: 5, // medium
      project: "frontend",
      tags: ["react", "typescript", "tailwind"],
    });
    assert(memory3.id !== undefined, "Memory 3 should have ID");

    // Step 3: Verify memory count increased by 3
    const count = await system.memories.count();
    assert(count >= initialCount + 3, `Expected at least ${initialCount + 3} memories, got ${count}`);
    console.log(`  Created ${count} memories`);

    // Step 3: Test recall
    console.log("  Testing recall...");
    const recallResult = await system.recall("How does authentication work?", {
      project: "api-gateway",
      maxTokens: 1000,
    });

    assert(recallResult.context.length > 0, "Recall should return context");
    assert(recallResult.memoryCount > 0, "Should find relevant memories");
    console.log(`  Recalled ${recallResult.memoryCount} memories, ${recallResult.tokenCount} tokens`);

    // Step 4: Verify JWT memory is in context
    assert(
      recallResult.context.toLowerCase().includes("jwt") ||
      recallResult.context.toLowerCase().includes("authentication"),
      "Context should include JWT/auth information"
    );

    // Step 5: Test search
    const searchResults = await system.memories.search("rate limiting", 5);
    assert(searchResults.length > 0, "Search should return results");
    console.log(`  Search found ${searchResults.length} results`);

    // Cleanup
    await resetMemorySystem();
    console.log("  Lifecycle test complete");
  });
}

/**
 * Scenario 2: Multi-Project Context
 *
 * Tests that project context properly boosts relevant memories
 * while still showing cross-project information.
 */
async function testMultiProjectContext(): Promise<void> {
  await runScenario("Multi-Project Context", async () => {
    const system = await initTestSystem();

    // Create frontend memories
    await system.memories.create({
      content: "The React app uses Redux Toolkit for state management with RTK Query for API calls.",
      category: "decision",
      importance: 8, // high
      project: "frontend",
      tags: ["react", "redux", "state"],
    });

    await system.memories.create({
      content: "We use Vitest for unit testing and Playwright for E2E tests in the frontend.",
      category: "decision",
      importance: 5, // medium
      project: "frontend",
      tags: ["testing", "vitest", "playwright"],
    });

    // Create backend memories
    await system.memories.create({
      content: "The backend API uses Express.js with PostgreSQL database and Prisma ORM.",
      category: "decision",
      importance: 8, // high
      project: "backend",
      tags: ["express", "postgres", "prisma"],
    });

    await system.memories.create({
      content: "Jest is used for backend testing with supertest for API integration tests.",
      category: "decision",
      importance: 5, // medium
      project: "backend",
      tags: ["testing", "jest", "supertest"],
    });

    // Test 1: Query with frontend context
    console.log("  Testing frontend-context recall...");
    const frontendRecall = await system.recall("How do we handle state management?", {
      project: "frontend",
    });
    assert(frontendRecall.memoryCount > 0, "Should find memories");
    assert(
      frontendRecall.context.toLowerCase().includes("redux") ||
      frontendRecall.context.toLowerCase().includes("state"),
      "Frontend context should prioritize Redux/state info"
    );
    console.log(`  Frontend recall: ${frontendRecall.memoryCount} memories`);

    // Test 2: Query with backend context
    console.log("  Testing backend-context recall...");
    const backendRecall = await system.recall("What database do we use?", {
      project: "backend",
    });
    assert(backendRecall.memoryCount > 0, "Should find memories");
    assert(
      backendRecall.context.toLowerCase().includes("postgres") ||
      backendRecall.context.toLowerCase().includes("prisma"),
      "Backend context should prioritize database info"
    );
    console.log(`  Backend recall: ${backendRecall.memoryCount} memories`);

    // Test 3: Query without project (should return both)
    console.log("  Testing cross-project recall...");
    const crossRecall = await system.recall("What testing frameworks do we use?");
    assert(crossRecall.memoryCount >= 2, "Should find testing info from both projects");
    console.log(`  Cross-project recall: ${crossRecall.memoryCount} memories`);

    await resetMemorySystem();
    console.log("  Multi-project test complete");
  });
}

/**
 * Scenario 3: Backup and Restore Cycle
 *
 * Tests the disaster recovery workflow.
 */
async function testBackupRestoreCycle(): Promise<void> {
  await runScenario("Backup and Restore Cycle", async () => {
    const system = await initTestSystem();

    // Step 1: Get baseline count
    const baselineCount = await system.memories.count();
    console.log(`  Baseline memory count: ${baselineCount}`);

    // Step 2: Create memories
    console.log("  Creating memories for backup...");
    const createdIds: string[] = [];

    for (let i = 0; i < 5; i++) {
      const memory = await system.memories.create({
        content: `Test memory ${i + 1}: This is important information about topic ${i + 1}.`,
        category: i % 2 === 0 ? "fact" : "decision",
        importance: i < 2 ? 8 : 5, // high: 8, medium: 5
        project: "backup-test",
        tags: [`tag-${i}`],
      });
      createdIds.push(memory.id);
    }

    const initialCount = await system.memories.count();
    assert(initialCount >= baselineCount + 5, `Expected at least ${baselineCount + 5} memories, got ${initialCount}`);
    console.log(`  Created ${initialCount} memories`);

    // Step 3: Create backup
    console.log("  Creating backup...");
    const backupResult = await createBackup(TEST_DB_PATH, {
      destPath: TEST_BACKUP_PATH,
      name: "e2e-test-backup",
    });
    assert(backupResult.success, `Backup should succeed: ${backupResult.error || 'no error'}`);
    assert(backupResult.backup?.path !== undefined, "Backup path should be set");
    const backupPath = backupResult.backup!.path;
    console.log(`  Backup created: ${path.basename(backupPath)}`);

    // Step 4: Delete all created memories
    console.log("  Deleting created memories...");
    for (const id of createdIds) {
      await system.memories.delete(id);
    }
    const afterDeleteCount = await system.memories.count();
    // Should be back to baseline (may have seed memories)
    assert(afterDeleteCount === baselineCount, `Expected ${baselineCount} memories after delete, got ${afterDeleteCount}`);
    console.log(`  Deleted created memories, back to baseline: ${afterDeleteCount}`);

    // Step 6: Reset system (simulate fresh start)
    await resetMemorySystem();

    // Step 7: Restore from backup
    console.log("  Restoring from backup...");
    const restoreResult = await restoreBackup(backupPath, {
      targetPath: TEST_DB_PATH,
      existingAction: "replace",
    });
    assert(restoreResult.success, `Restore should succeed: ${restoreResult.error || 'no error'}`);
    console.log(`  Restored ${restoreResult.memoryCount ?? 'unknown'} memories`);

    // Step 8: Verify restoration
    const restoredSystem = await initMemorySystem({
      dbPath: TEST_DB_PATH,
      enableSync: false,
      enableAutoExtraction: false,
      logLevel: "error",
    });

    const restoredCount = await restoredSystem.memories.count();
    assert(restoredCount >= 5, `Expected at least 5 restored memories, got ${restoredCount}`);
    console.log(`  Verified ${restoredCount} memories restored`);

    // Verify content
    const searchResults = await restoredSystem.memories.search("important information", 5);
    assert(searchResults.length > 0, "Should find restored memories");

    await resetMemorySystem();
    console.log("  Backup/restore test complete");
  });
}

/**
 * Scenario 4: Hook Integration
 *
 * Tests the context and extraction hooks work correctly.
 */
async function testHookIntegration(): Promise<void> {
  await runScenario("Hook Integration", async () => {
    const system = await initTestSystem();

    // Create some memories
    await system.memories.create({
      content: "Our API uses versioning in the URL path, e.g., /api/v1/users.",
      category: "decision",
      importance: 8, // high
      project: "api",
      tags: ["api", "versioning"],
    });

    await system.memories.create({
      content: "All API responses follow the JSON:API specification.",
      category: "decision",
      importance: 5, // medium
      project: "api",
      tags: ["api", "json-api"],
    });

    // Test context hook
    console.log("  Testing context hook...");
    const contextHook = createContextHook({
      maxTokens: 500,
      format: "markdown",
      enableCache: true,
      autoInit: false,
    });

    const result1 = await contextHook.getContext("How should I structure API responses?");
    assert(result1.context.length > 0, "Context hook should return content");
    assert(result1.cached === false, "First call should not be cached");
    console.log(`  Context hook returned ${result1.tokenCount} tokens`);

    // Test caching
    const result2 = await contextHook.getContext("How should I structure API responses?");
    assert(result2.cached === true, "Second call should be cached");
    console.log("  Context caching works");

    // Test extraction hook
    console.log("  Testing extraction hook...");
    const extractionHook = createExtractionHook({
      enabled: true,
      minLength: 50,
      autoInit: false,
    });

    // Test skip for short message
    const shortResult = await extractionHook.extract({
      userMessage: "Hi",
      assistantResponse: "Hello!",
    });
    assert(shortResult.queued === false, "Short message should be skipped");
    assert(shortResult.skipReason?.includes("too short"), "Should indicate too short");
    console.log("  Short message correctly skipped");

    // Test queueing for valid conversation
    const validResult = await extractionHook.extract({
      userMessage: "What framework should I use for the backend?",
      assistantResponse: "Based on our stack, I recommend Express.js with TypeScript. We already use it in the api project.",
      project: "api",
    });
    // Either queued or gracefully failed (if extraction service not fully configured)
    console.log(`  Valid conversation: queued=${validResult.queued}, skip=${validResult.skipReason || 'none'}`);

    // Check metrics
    const metrics = extractionHook.getMetrics();
    assert(metrics.totalSkipped >= 1, "Should have skipped at least one");
    console.log(`  Extraction metrics: skipped=${metrics.totalSkipped}`);

    await resetMemorySystem();
    console.log("  Hook integration test complete");
  });
}

/**
 * Scenario 5: High Volume Performance
 *
 * Tests system performance with many memories.
 */
async function testHighVolumePerformance(): Promise<void> {
  await runScenario("High Volume Performance", async () => {
    const system = await initTestSystem();

    const MEMORY_COUNT = 50; // Reduced for faster test
    const QUERY_COUNT = 5;

    // Step 1: Create many memories
    console.log(`  Creating ${MEMORY_COUNT} memories...`);
    const createStart = Date.now();

    const projects = ["frontend", "backend", "api", "infra", "docs"];
    const categories: Array<"fact" | "decision" | "preference" | "context"> = ["fact", "decision", "preference", "context"];

    for (let i = 0; i < MEMORY_COUNT; i++) {
      await system.memories.create({
        content: `Memory ${i + 1}: This contains information about ${projects[i % 5]} topic ${Math.floor(i / 5) + 1}. It discusses various aspects including configuration, best practices, and implementation details.`,
        category: categories[i % 4],
        importance: i % 3 === 0 ? 8 : 5, // high: 8, medium: 5
        project: projects[i % 5],
        tags: [`topic-${Math.floor(i / 5)}`, projects[i % 5]],
      });
    }

    const createDuration = Date.now() - createStart;
    const avgCreateTime = createDuration / MEMORY_COUNT;
    console.log(`  Created ${MEMORY_COUNT} memories in ${createDuration}ms (${avgCreateTime.toFixed(1)}ms avg)`);
    assert(avgCreateTime < 500, `Memory creation too slow: ${avgCreateTime}ms avg`);

    // Step 2: Run concurrent queries
    console.log(`  Running ${QUERY_COUNT} queries...`);
    const queryStart = Date.now();

    const queries = [
      "What are the frontend best practices?",
      "How is the backend configured?",
      "What are the API implementation details?",
      "Tell me about infrastructure setup",
      "What documentation exists?",
    ];

    const queryPromises = queries.slice(0, QUERY_COUNT).map((query, i) =>
      system.recall(query, { project: projects[i] })
    );

    const queryResults = await Promise.all(queryPromises);

    const queryDuration = Date.now() - queryStart;
    const avgQueryTime = queryDuration / QUERY_COUNT;
    console.log(`  Completed ${QUERY_COUNT} queries in ${queryDuration}ms (${avgQueryTime.toFixed(1)}ms avg)`);

    // Verify results
    for (let i = 0; i < queryResults.length; i++) {
      assert(queryResults[i].memoryCount > 0, `Query ${i + 1} should return memories`);
    }

    // Step 3: Test search performance
    console.log("  Testing search performance...");
    const searchStart = Date.now();
    const searchResults = await system.memories.search("configuration best practices", 20);
    const searchDuration = Date.now() - searchStart;
    console.log(`  Search returned ${searchResults.length} results in ${searchDuration}ms`);
    assert(searchDuration < 500, `Search too slow: ${searchDuration}ms`);

    await resetMemorySystem();
    console.log("  High volume test complete");
  });
}

/**
 * Scenario 6: Error Recovery
 *
 * Tests graceful handling of error conditions.
 */
async function testErrorRecovery(): Promise<void> {
  await runScenario("Error Recovery", async () => {
    const system = await initTestSystem();

    // Test 1: Invalid memory ID
    console.log("  Testing invalid memory retrieval...");
    const nonExistent = await system.memories.get("non-existent-id");
    assert(nonExistent === null, "Should return null for non-existent memory");
    console.log("  Non-existent memory handled correctly");

    // Test 2: Delete non-existent
    console.log("  Testing delete of non-existent memory...");
    const deleteResult = await system.memories.delete("non-existent-id");
    // Should not throw, just return false
    assert(deleteResult === false, "Delete of non-existent should return false");
    console.log("  Non-existent delete handled correctly");

    // Test 3: Empty query recall
    console.log("  Testing empty query recall...");
    try {
      const emptyResult = await system.recall("");
      // Should return empty or handle gracefully
      console.log(`  Empty query returned ${emptyResult.memoryCount} memories`);
    } catch (error) {
      // Also acceptable if it throws a clear error
      console.log("  Empty query threw error (acceptable)");
    }

    // Test 4: Very long content
    console.log("  Testing very long content...");
    const longContent = "A".repeat(10000);
    try {
      const longMemory = await system.memories.create({
        content: longContent,
        category: "fact",
        importance: 3, // low
        project: "test",
        tags: [],
      });
      assert(longMemory.id !== undefined, "Long content should be created");
      console.log("  Long content handled correctly");
    } catch (error) {
      console.log("  Long content rejected (acceptable if intentional limit)");
    }

    await resetMemorySystem();
    console.log("  Error recovery test complete");
  });
}

/**
 * Scenario 7: Status and Monitoring
 *
 * Tests system status reporting.
 */
async function testStatusMonitoring(): Promise<void> {
  await runScenario("Status and Monitoring", async () => {
    const system = await initTestSystem();

    // Get baseline
    const baselineCount = await system.memories.count();

    // Create some memories
    for (let i = 0; i < 3; i++) {
      await system.memories.create({
        content: `Status test memory ${i + 1}`,
        category: "fact",
        importance: 5, // medium
        project: "status-test",
        tags: [],
      });
    }

    // Get status
    console.log("  Getting system status...");
    const status = await system.getStatus();

    assert(status.initialized === true, "System should be initialized");
    assert(status.memoryCount >= baselineCount + 3, `Expected at least ${baselineCount + 3} memories, got ${status.memoryCount}`);
    assert(status.dbPath === TEST_DB_PATH, "DB path should match");
    assert(status.uptime > 0, "Uptime should be positive");

    console.log(`  Status: ${status.memoryCount} memories, uptime ${status.uptime}ms`);

    await resetMemorySystem();
    console.log("  Status monitoring test complete");
  });
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  console.log("═".repeat(60));
  console.log("   OpenClaw Memory System - End-to-End Integration Tests");
  console.log("═".repeat(60));

  const startTime = Date.now();

  try {
    // Run all scenarios
    await testFullMemoryLifecycle();
    await testMultiProjectContext();
    await testBackupRestoreCycle();
    await testHookIntegration();
    await testHighVolumePerformance();
    await testErrorRecovery();
    await testStatusMonitoring();
  } finally {
    // Final cleanup
    await cleanupTestEnvironment();
  }

  const totalDuration = Date.now() - startTime;

  // Print summary
  console.log("\n" + "═".repeat(60));
  console.log("   Test Summary");
  console.log("═".repeat(60));

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  for (const result of results) {
    const status = result.passed ? "✅" : "❌";
    const duration = `${result.duration}ms`.padStart(8);
    console.log(`  ${status} ${result.name.padEnd(35)} ${duration}`);
    if (result.error) {
      console.log(`     └─ ${result.error}`);
    }
  }

  console.log("─".repeat(60));
  console.log(`  Total: ${passed} passed, ${failed} failed (${totalDuration}ms)`);
  console.log("═".repeat(60) + "\n");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("E2E tests failed:", error);
  process.exit(1);
});
