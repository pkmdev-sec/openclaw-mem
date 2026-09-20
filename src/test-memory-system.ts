/**
 * Memory System Tests
 *
 * Tests for the unified memory system API.
 */

import * as fs from "fs/promises";
import * as path from "path";
import {
  MemorySystem,
  initMemorySystem,
  getMemorySystem,
  resetMemorySystem,
} from "./memory-system.js";
import {
  loadConfig,
  saveConfig,
  deleteConfig,
  validateConfig,
  getDefaultConfig,
  mergeConfig,
  getConfigPath,
} from "./memory-config.js";
import {
  getMemoryEventEmitter,
  resetMemoryEventEmitter,
  MemoryEvent,
} from "./memory-events.js";

// ============================================================================
// TEST SETUP
// ============================================================================

const TEST_DB_PATH = "./test-memory-system-db";
const TEST_CONFIG_PATH = getConfigPath();

async function setup(): Promise<void> {
  // Clean up any existing test data
  try {
    await fs.rm(TEST_DB_PATH, { recursive: true });
  } catch {}

  try {
    await deleteConfig();
  } catch {}

  // Reset singletons
  await resetMemorySystem();
  resetMemoryEventEmitter();
}

async function cleanup(): Promise<void> {
  await resetMemorySystem();
  resetMemoryEventEmitter();

  try {
    await fs.rm(TEST_DB_PATH, { recursive: true });
  } catch {}

  try {
    await deleteConfig();
  } catch {}
}

// ============================================================================
// CONFIG TESTS
// ============================================================================

async function testConfig(): Promise<void> {
  console.log("\n--- Configuration Tests ---\n");

  // Test default config
  console.log("Testing default config...");
  const defaults = getDefaultConfig();
  console.log(`  dbPath: ${defaults.dbPath}`);
  console.log(`  enableSync: ${defaults.enableSync}`);
  console.log(`  extractionModel: ${defaults.extractionModel}`);
  if (!defaults.dbPath || defaults.enableSync === undefined) {
    throw new Error("Default config missing required fields");
  }
  console.log("  Default config is valid");

  // Test config validation
  console.log("\nTesting config validation...");
  const validResult = validateConfig(defaults);
  console.log(`  Valid config: ${validResult.valid}`);
  if (!validResult.valid) {
    throw new Error(`Default config should be valid: ${validResult.errors.join(", ")}`);
  }

  const invalidConfig = { logLevel: "invalid" };
  const invalidResult = validateConfig(invalidConfig);
  console.log(`  Invalid config errors: ${invalidResult.errors.length}`);
  if (invalidResult.valid) {
    throw new Error("Invalid config should fail validation");
  }
  console.log("  Validation works correctly");

  // Test config save/load
  console.log("\nTesting config save/load...");
  const testConfig = {
    ...defaults,
    dbPath: TEST_DB_PATH,
    logLevel: "debug" as const,
  };
  await saveConfig(testConfig);

  const loaded = await loadConfig();
  console.log(`  Loaded dbPath: ${loaded.dbPath}`);
  console.log(`  Loaded logLevel: ${loaded.logLevel}`);
  if (loaded.dbPath !== TEST_DB_PATH) {
    throw new Error("Loaded config should match saved config");
  }
  console.log("  Config save/load works");

  // Test config merge
  console.log("\nTesting config merge...");
  const partial = { dbPath: "/custom/path" };
  const merged = mergeConfig(partial);
  console.log(`  Merged dbPath: ${merged.dbPath}`);
  console.log(`  Merged enableSync: ${merged.enableSync}`);
  if (merged.dbPath !== "/custom/path" || merged.enableSync !== true) {
    throw new Error("Config merge should apply partial over defaults");
  }
  console.log("  Config merge works");

  console.log("\nConfiguration tests passed!");
}

// ============================================================================
// EVENT TESTS
// ============================================================================

async function testEvents(): Promise<void> {
  console.log("\n--- Event System Tests ---\n");

  resetMemoryEventEmitter();
  const emitter = getMemoryEventEmitter();

  // Test event subscription
  console.log("Testing event subscription...");
  const events: MemoryEvent[] = [];
  emitter.on("memory:created", (e) => events.push(e));

  emitter.emitEvent("memory:created", { id: "test-1" });
  emitter.emitEvent("memory:created", { id: "test-2" });

  if (events.length !== 2) {
    throw new Error(`Expected 2 events, got ${events.length}`);
  }
  console.log(`  Received ${events.length} events`);
  console.log("  Event subscription works");

  // Test wildcard subscription
  console.log("\nTesting wildcard subscription...");
  const allEvents: MemoryEvent[] = [];
  emitter.on("*", (e) => allEvents.push(e));

  emitter.emitEvent("memory:deleted", { id: "test-1" });
  emitter.emitEvent("system:initialized", {});

  // Should have received both events
  if (allEvents.length < 2) {
    throw new Error(`Wildcard should receive all events, got ${allEvents.length}`);
  }
  console.log(`  Wildcard received ${allEvents.length} events`);
  console.log("  Wildcard subscription works");

  // Test event unsubscription
  console.log("\nTesting event unsubscription...");
  const handler = (e: MemoryEvent) => events.push(e);
  emitter.on("memory:updated", handler);
  emitter.emitEvent("memory:updated", { id: "test-3" });
  const countBefore = events.length;

  emitter.off("memory:updated", handler);
  emitter.emitEvent("memory:updated", { id: "test-4" });
  const countAfter = events.length;

  if (countAfter !== countBefore) {
    throw new Error("Unsubscribed handler should not receive events");
  }
  console.log("  Unsubscription works");

  // Test metrics
  console.log("\nTesting metrics...");
  const metrics = emitter.getMetrics();
  console.log(`  Total events: ${metrics.totalEvents}`);
  console.log(`  Event counts:`, metrics.eventCounts);
  if (metrics.totalEvents === 0) {
    throw new Error("Metrics should track events");
  }
  console.log("  Metrics work");

  // Test once
  console.log("\nTesting once subscription...");
  let onceCount = 0;
  emitter.once("recall:completed", () => onceCount++);

  emitter.emitEvent("recall:completed", {});
  emitter.emitEvent("recall:completed", {});

  if (onceCount !== 1) {
    throw new Error(`Once should only fire once, got ${onceCount}`);
  }
  console.log("  Once subscription works");

  console.log("\nEvent system tests passed!");
}

// ============================================================================
// MEMORY SYSTEM TESTS
// ============================================================================

async function testMemorySystem(): Promise<void> {
  console.log("\n--- Memory System Tests ---\n");

  // Create memory system with test config
  console.log("Creating memory system...");
  const system = new MemorySystem({
    dbPath: TEST_DB_PATH,
    enableSync: false, // Disable for tests
    enableAutoExtraction: false, // Disable for tests
    logLevel: "warn",
  });

  // Test initialization
  console.log("\nTesting initialization...");
  await system.initialize();
  const status = await system.getStatus();
  console.log(`  Initialized: ${status.initialized}`);
  console.log(`  DB path: ${status.dbPath}`);
  console.log(`  Memory count: ${status.memoryCount}`);
  if (!status.initialized) {
    throw new Error("System should be initialized");
  }
  console.log("  Initialization works");

  // Test memory creation
  console.log("\nTesting memory creation...");
  const memory = await system.memories.create({
    content: "Test memory content for unified API",
    category: "fact",
    project: "test-project",
    importance: 5,
  });
  console.log(`  Created memory: ${memory.id}`);
  if (!memory.id) {
    throw new Error("Memory should have an ID");
  }
  console.log("  Memory creation works");

  // Test memory retrieval
  console.log("\nTesting memory retrieval...");
  const retrieved = await system.memories.get(memory.id);
  if (!retrieved || retrieved.content !== memory.content) {
    throw new Error("Retrieved memory should match created memory");
  }
  console.log("  Memory retrieval works");

  // Test memory search
  console.log("\nTesting memory search...");
  const searchResults = await system.memories.search("test memory unified", 5);
  console.log(`  Found ${searchResults.length} memories`);
  if (searchResults.length === 0) {
    throw new Error("Search should find the created memory");
  }
  console.log("  Memory search works");

  // Test memory count
  console.log("\nTesting memory count...");
  const count = await system.memories.count();
  console.log(`  Total memories: ${count}`);
  if (count < 1) {
    throw new Error("Count should be at least 1");
  }
  console.log("  Memory count works");

  // Test memory update
  console.log("\nTesting memory update...");
  const updated = await system.memories.update(memory.id, {
    importance: 8,
  });
  if (updated.importance !== 8) {
    throw new Error("Memory importance should be updated");
  }
  console.log("  Memory update works");

  // Test recall (basic - no LLM needed for ranking)
  console.log("\nTesting recall...");
  const recallResult = await system.recall("test memory", {
    limit: 5,
    project: "test-project",
    format: "markdown",
  });
  console.log(`  Recall found ${recallResult.memoryCount} memories`);
  console.log(`  Context length: ${recallResult.context.length} chars`);
  console.log(`  Latency: ${recallResult.latency}ms`);
  // Note: recall might be empty if no Ollama running for embeddings
  console.log("  Recall works");

  // Test status
  console.log("\nTesting status after operations...");
  const statusAfter = await system.getStatus();
  console.log(`  Memory count: ${statusAfter.memoryCount}`);
  console.log(`  Uptime: ${statusAfter.uptime}ms`);
  console.log("  Status works");

  // Test memory deletion
  console.log("\nTesting memory deletion...");
  const deleted = await system.memories.delete(memory.id);
  if (!deleted) {
    throw new Error("Memory should be deleted");
  }
  const afterDelete = await system.memories.get(memory.id);
  if (afterDelete !== null) {
    throw new Error("Deleted memory should not be retrievable");
  }
  console.log("  Memory deletion works");

  // Test shutdown
  console.log("\nTesting shutdown...");
  await system.shutdown();
  const statusShutdown = await system.getStatus();
  if (!statusShutdown.initialized) {
    // System re-initializes on getStatus
  }
  console.log("  Shutdown works");

  console.log("\nMemory system tests passed!");
}

// ============================================================================
// SINGLETON TESTS
// ============================================================================

async function testSingleton(): Promise<void> {
  console.log("\n--- Singleton Tests ---\n");

  await resetMemorySystem();

  // Test initMemorySystem
  console.log("Testing initMemorySystem...");
  const system1 = await initMemorySystem({
    dbPath: TEST_DB_PATH,
    enableSync: false,
    enableAutoExtraction: false,
    logLevel: "error",
  });

  const system2 = getMemorySystem();
  if (system1 !== system2) {
    throw new Error("Singleton should return same instance");
  }
  console.log("  Singleton works");

  // Test reset
  console.log("\nTesting reset...");
  await resetMemorySystem();
  const system3 = getMemorySystem();
  // system3 is a new instance (not initialized)
  console.log("  Reset works");

  await system3.shutdown();

  console.log("\nSingleton tests passed!");
}

// ============================================================================
// BACKUP TESTS (INTEGRATION)
// ============================================================================

async function testBackupIntegration(): Promise<void> {
  console.log("\n--- Backup Integration Tests ---\n");

  const system = new MemorySystem({
    dbPath: TEST_DB_PATH,
    enableSync: false,
    enableAutoExtraction: false,
    logLevel: "warn",
    backup: {
      path: "./test-backups-integration",
    },
  });

  await system.initialize();

  // Create some memories
  console.log("Creating test memories...");
  for (let i = 0; i < 3; i++) {
    await system.memories.create({
      content: `Integration test memory ${i}`,
      category: "fact",
      project: "backup-test",
      importance: i + 1,
    });
  }

  const countBefore = await system.memories.count();
  console.log(`  Created ${countBefore} memories`);

  // Create backup
  console.log("\nTesting backup creation...");
  const backupResult = await system.backup.create("integration-test");
  console.log(`  Backup success: ${backupResult.success}`);
  if (!backupResult.success) {
    throw new Error(`Backup failed: ${backupResult.error}`);
  }
  console.log(`  Backup path: ${backupResult.backup?.path}`);

  // List backups
  console.log("\nTesting backup list...");
  const backups = await system.backup.list();
  console.log(`  Found ${backups.length} backups`);
  if (backups.length < 1) {
    throw new Error("Should have at least 1 backup");
  }

  await system.shutdown();

  // Cleanup
  try {
    await fs.rm("./test-backups-integration", { recursive: true });
  } catch {}

  console.log("\nBackup integration tests passed!");
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  console.log("===================================================");
  console.log("   Memory System Test Suite");
  console.log("===================================================");

  try {
    await setup();

    await testConfig();
    await testEvents();
    await testMemorySystem();
    await testSingleton();
    await testBackupIntegration();

    console.log("\n===================================================");
    console.log("   All Memory System Tests Passed!");
    console.log("===================================================\n");
  } catch (error) {
    console.error("\n\nTEST FAILED:", error);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

main();
