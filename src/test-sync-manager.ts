/**
 * Sync Manager Tests
 *
 * Tests for the Syncthing integration layer including:
 * - Sync configuration
 * - Syncthing helper utilities
 * - Conflict detection and resolution
 * - Sync manager orchestration
 */

import * as fs from "fs/promises";
import * as path from "path";
import {
  SyncConfig,
  getDefaultDbPath,
  initSyncConfig,
  loadSyncConfig,
  saveSyncConfig,
  generateFolderId,
  expandPath,
} from "./sync-config.js";
import {
  getSyncStatus,
  generateSetupInstructions,
  writeStIgnore,
  generateStIgnore,
} from "./syncthing-helper.js";
import {
  ConflictDetector,
  createConflictDetector,
} from "./conflict-detector.js";
import {
  SyncManager,
  createSyncManager,
  getSyncManager,
  initSyncManager,
} from "./sync-manager.js";

// ============================================================================
// TEST SETUP
// ============================================================================

const TEST_DB_PATH = "./test-sync-db";
let testConfig: SyncConfig;

async function setup(): Promise<void> {
  // Clean up any existing test directory
  try {
    await fs.rm(TEST_DB_PATH, { recursive: true });
  } catch {
    // Directory doesn't exist
  }

  // Create test directory
  await fs.mkdir(TEST_DB_PATH, { recursive: true });

  // Create a basic config for testing
  testConfig = {
    dbPath: TEST_DB_PATH,
    folderId: "test-sync-folder",
    folderLabel: "Test Sync",
    versioning: true,
    versionCount: 5,
    ignorePatterns: ["*.tmp", "*.lock"],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

async function cleanup(): Promise<void> {
  try {
    await fs.rm(TEST_DB_PATH, { recursive: true });
  } catch {
    // Directory might not exist
  }
}

// ============================================================================
// SYNC CONFIG TESTS
// ============================================================================

async function testSyncConfig(): Promise<void> {
  console.log("\n--- Sync Config Tests ---\n");

  // Test folder ID generation
  console.log("Testing folder ID generation...");
  const folderId1 = generateFolderId();
  const folderId2 = generateFolderId();

  console.log(`  Generated: ${folderId1}`);
  console.log(`  Generated: ${folderId2}`);

  if (folderId1 === folderId2) {
    throw new Error("Folder IDs should be unique");
  }
  if (!folderId1.startsWith("openclaw-memory-")) {
    throw new Error("Folder ID should have openclaw-memory- prefix");
  }
  console.log("  Folder IDs are unique and properly formatted");

  // Test default path
  console.log("Testing default path...");
  const defaultPath = getDefaultDbPath();
  console.log(`  Default path: ${defaultPath}`);
  if (!defaultPath.includes("openclaw-memory")) {
    throw new Error("Default path should contain openclaw-memory");
  }
  console.log("  Default path is valid");

  // Test path expansion
  console.log("Testing path expansion...");
  const expanded = expandPath("~/test/path");
  console.log(`  ~/test/path -> ${expanded}`);
  if (expanded.includes("~")) {
    throw new Error("Path should not contain ~");
  }
  console.log("  Path expansion works");

  // Test config init
  console.log("Testing config initialization...");
  const config = await initSyncConfig(TEST_DB_PATH);
  console.log(`  Config created for: ${config.dbPath}`);
  console.log(`  Folder ID: ${config.folderId}`);
  if (!config.folderId || !config.dbPath) {
    throw new Error("Config should have folderId and dbPath");
  }
  console.log("  Config initialization works");

  // Test config save/load
  console.log("Testing config save/load...");
  await saveSyncConfig(config);
  const loaded = await loadSyncConfig(TEST_DB_PATH);
  if (!loaded) {
    throw new Error("Failed to load saved config");
  }
  if (loaded.folderId !== config.folderId) {
    throw new Error("Loaded config should match saved config");
  }
  console.log("  Config save/load works");

  console.log("\nSync config tests passed!");
}

// ============================================================================
// SYNCTHING HELPER TESTS
// ============================================================================

async function testSyncthingHelper(): Promise<void> {
  console.log("\n--- Syncthing Helper Tests ---\n");

  // Test .stignore generation
  console.log("Testing .stignore generation...");
  const stignore = generateStIgnore(testConfig);
  console.log("  Generated .stignore:");
  console.log("  " + stignore.split("\n").slice(0, 5).join("\n  ") + "...");

  if (!stignore.includes("*.lock")) {
    throw new Error(".stignore should contain lock file pattern");
  }
  if (!stignore.includes("*.tmp")) {
    throw new Error(".stignore should contain tmp file pattern");
  }
  console.log("  .stignore content is correct");

  // Test .stignore write
  console.log("Testing .stignore write...");
  await writeStIgnore(TEST_DB_PATH, testConfig);
  const stignorePath = path.join(TEST_DB_PATH, ".stignore");
  const content = await fs.readFile(stignorePath, "utf-8");
  if (!content.includes("OpenClaw Memory")) {
    throw new Error(".stignore file should contain OpenClaw Memory header");
  }
  if (!content.includes("*.lock")) {
    throw new Error(".stignore file should contain *.lock pattern from config");
  }
  console.log("  .stignore file written successfully");

  // Test setup instructions
  console.log("Testing setup instructions...");
  const instructions = generateSetupInstructions(testConfig);
  console.log("  Generated instructions (first 200 chars):");
  console.log("  " + instructions.slice(0, 200).replace(/\n/g, "\n  ") + "...");

  if (!instructions.includes("Syncthing")) {
    throw new Error("Instructions should mention Syncthing");
  }
  if (!instructions.includes(testConfig.folderId)) {
    throw new Error("Instructions should contain folder ID");
  }
  console.log("  Setup instructions are complete");

  // Test sync status (will be "unknown" without Syncthing running)
  console.log("Testing sync status...");
  const status = await getSyncStatus(testConfig);
  console.log(`  Running: ${status.running}`);
  console.log(`  State: ${status.state}`);
  console.log(`  Connected devices: ${status.connectedDevices}`);
  console.log("  Status check completed (Syncthing may not be running)");

  console.log("\nSyncthing helper tests passed!");
}

// ============================================================================
// CONFLICT DETECTOR TESTS
// ============================================================================

async function testConflictDetector(): Promise<void> {
  console.log("\n--- Conflict Detector Tests ---\n");

  // Create detector
  console.log("Testing conflict detector creation...");
  const detector = createConflictDetector(TEST_DB_PATH);
  console.log("  Detector created");

  // Test scan with no conflicts
  console.log("Testing scan (no conflicts)...");
  const noConflicts = await detector.scan();
  console.log(`  Found ${noConflicts.length} conflicts`);
  if (noConflicts.length !== 0) {
    throw new Error("Should find no conflicts in empty directory");
  }
  console.log("  Empty scan works");

  // Create a fake conflict file
  console.log("Testing conflict file detection...");
  const conflictFileName = "test.sync-conflict-20260203-120000-ABCD1234.txt";
  const conflictFilePath = path.join(TEST_DB_PATH, conflictFileName);
  await fs.writeFile(conflictFilePath, "conflict content");

  // Also create the "original" file
  const originalFilePath = path.join(TEST_DB_PATH, "test.txt");
  await fs.writeFile(originalFilePath, "original content");

  const conflicts = await detector.scan();
  console.log(`  Found ${conflicts.length} conflicts`);

  if (conflicts.length !== 1) {
    throw new Error(`Expected 1 conflict, found ${conflicts.length}`);
  }

  const conflict = conflicts[0];
  console.log(`  Conflict path: ${conflict.conflictPath}`);
  console.log(`  Original path: ${conflict.originalPath}`);
  console.log(`  Device ID: ${conflict.deviceId}`);
  console.log(`  Timestamp: ${conflict.timestamp.toISOString()}`);

  if (conflict.deviceId !== "ABCD1234") {
    throw new Error("Device ID should be ABCD1234");
  }
  console.log("  Conflict parsing works");

  // Test summary
  console.log("Testing conflict summary...");
  const summary = await detector.getSummary();
  console.log(`  Total conflicts: ${summary.totalConflicts}`);
  console.log(`  By device:`, summary.byDevice);
  console.log(`  By extension:`, summary.byExtension);
  if (summary.totalConflicts !== 1) {
    throw new Error("Summary should show 1 conflict");
  }
  console.log("  Summary works");

  // Test conflict resolution (last-write-wins)
  console.log("Testing conflict resolution...");
  const resolved = await detector.resolveAll();
  console.log(`  Resolved ${resolved} conflicts`);
  if (resolved !== 1) {
    throw new Error("Should have resolved 1 conflict");
  }

  // Verify conflict file is gone
  const afterResolve = await detector.scan();
  if (afterResolve.length !== 0) {
    throw new Error("Conflicts should be resolved");
  }
  console.log("  Conflict resolution works");

  // Test conflict log
  console.log("Testing conflict log...");
  const log = await detector.getConflictLog();
  console.log(`  Log entries: ${log.length}`);
  if (log.length !== 1) {
    throw new Error("Should have 1 log entry");
  }
  console.log(`  Resolution: ${log[0].resolution}`);
  console.log(`  Strategy: ${log[0].strategy}`);
  console.log("  Conflict logging works");

  // Clean up log
  await detector.clearConflictLog();
  const clearedLog = await detector.getConflictLog();
  if (clearedLog.length !== 0) {
    throw new Error("Log should be cleared");
  }
  console.log("  Log clearing works");

  console.log("\nConflict detector tests passed!");
}

// ============================================================================
// SYNC MANAGER TESTS
// ============================================================================

async function testSyncManager(): Promise<void> {
  console.log("\n--- Sync Manager Tests ---\n");

  // Test manager creation
  console.log("Testing sync manager creation...");
  const manager = createSyncManager({
    dbPath: TEST_DB_PATH,
    conflictStrategy: "last-write-wins",
    autoResolve: true,
    debug: true,
  });
  console.log("  Manager created");

  // Test initialization
  console.log("Testing initialization...");
  await manager.initialize();
  const config = manager.getConfig();
  if (!config) {
    throw new Error("Config should exist after initialization");
  }
  console.log(`  Initialized with folder ID: ${config.folderId}`);

  // Test get info
  console.log("Testing getInfo...");
  const info = await manager.getInfo();
  console.log(`  Enabled: ${info.enabled}`);
  console.log(`  Folder path: ${info.folderPath}`);
  console.log(`  Pending conflicts: ${info.pendingConflicts}`);
  console.log(`  .stignore exists: ${info.stIgnoreExists}`);

  if (!info.enabled) {
    throw new Error("Sync should be enabled");
  }
  if (!info.stIgnoreExists) {
    throw new Error(".stignore should exist");
  }
  console.log("  Info retrieval works");

  // Test setup instructions
  console.log("Testing setup instructions from manager...");
  const instructions = manager.getSetupInstructions();
  if (!instructions.includes(config.folderId)) {
    throw new Error("Instructions should contain folder ID");
  }
  console.log("  Setup instructions work");

  // Test config update
  console.log("Testing config update...");
  await manager.updateConfig({ folderLabel: "Updated Label" });
  const updatedConfig = manager.getConfig();
  if (updatedConfig?.folderLabel !== "Updated Label") {
    throw new Error("Config should be updated");
  }
  console.log("  Config update works");

  // Test conflict checking
  console.log("Testing conflict check...");

  // Create a conflict file
  const conflictFileName = "data.sync-conflict-20260203-140000-DEVICE123.json";
  const conflictFilePath = path.join(TEST_DB_PATH, conflictFileName);
  await fs.writeFile(conflictFilePath, '{"test": "conflict"}');
  const originalFilePath = path.join(TEST_DB_PATH, "data.json");
  await fs.writeFile(originalFilePath, '{"test": "original"}');

  const resolved = await manager.checkConflicts();
  console.log(`  Resolved ${resolved} conflicts`);
  if (resolved !== 1) {
    throw new Error("Should have resolved 1 conflict");
  }
  console.log("  Conflict checking works");

  // Test force check
  console.log("Testing force check...");
  const forceInfo = await manager.forceCheck();
  console.log(`  Pending conflicts after force check: ${forceInfo.pendingConflicts}`);
  if (forceInfo.pendingConflicts !== 0) {
    throw new Error("No conflicts should be pending after force check");
  }
  console.log("  Force check works");

  // Test monitoring (brief test)
  console.log("Testing monitoring...");
  let callbackCalled = false;
  manager.startMonitoring((info) => {
    callbackCalled = true;
    console.log(`  Monitoring callback - conflicts: ${info.pendingConflicts}`);
  });

  // Wait a bit for callback
  await new Promise((resolve) => setTimeout(resolve, 100));
  manager.stopMonitoring();

  if (!callbackCalled) {
    throw new Error("Monitoring callback should be called");
  }
  console.log("  Monitoring works");

  // Test shutdown
  console.log("Testing shutdown...");
  await manager.shutdown();
  if (manager.getConfig() !== null) {
    throw new Error("Config should be null after shutdown");
  }
  console.log("  Shutdown works");

  // Test singleton
  console.log("Testing singleton...");
  initSyncManager({ dbPath: TEST_DB_PATH });
  const singleton = getSyncManager();
  await singleton.initialize();
  if (!singleton.getConfig()) {
    throw new Error("Singleton should have config");
  }
  await singleton.shutdown();
  console.log("  Singleton works");

  console.log("\nSync manager tests passed!");
}

// ============================================================================
// INTEGRATION TEST
// ============================================================================

async function testIntegration(): Promise<void> {
  console.log("\n--- Integration Test ---\n");

  // Simulate full sync workflow
  console.log("Simulating full sync workflow...\n");

  // 1. Initialize sync manager
  console.log("1. Initializing sync manager...");
  const manager = createSyncManager({
    dbPath: TEST_DB_PATH,
    debug: false,
  });
  await manager.initialize();
  console.log("   Done\n");

  // 2. Display setup instructions
  console.log("2. Setup instructions:");
  const instructions = manager.getSetupInstructions();
  console.log("   " + instructions.split("\n").slice(0, 8).join("\n   "));
  console.log("   ...\n");

  // 3. Check initial status
  console.log("3. Initial sync status:");
  let info = await manager.getInfo();
  console.log(`   Enabled: ${info.enabled}`);
  console.log(`   Status: ${info.status.state}`);
  console.log(`   Conflicts: ${info.pendingConflicts}\n`);

  // 4. Simulate conflicts
  console.log("4. Simulating sync conflicts...");
  const files = [
    { conflict: "file1.sync-conflict-20260203-100000-DEV1.txt", original: "file1.txt" },
    { conflict: "file2.sync-conflict-20260203-110000-DEV2.txt", original: "file2.txt" },
    { conflict: "file3.sync-conflict-20260203-120000-DEV1.txt", original: "file3.txt" },
  ];

  for (const f of files) {
    await fs.writeFile(path.join(TEST_DB_PATH, f.conflict), "conflict data");
    await fs.writeFile(path.join(TEST_DB_PATH, f.original), "original data");
  }

  const pending = await manager.getPendingConflicts();
  console.log(`   Created ${pending.length} conflicts\n`);

  // 5. Check conflict summary
  console.log("5. Conflict summary:");
  const summary = await manager.getConflictSummary();
  console.log(`   Total: ${summary.totalConflicts}`);
  console.log(`   By device:`, summary.byDevice);
  console.log(`   By extension:`, summary.byExtension);
  console.log("");

  // 6. Resolve conflicts
  console.log("6. Resolving conflicts...");
  const resolved = await manager.checkConflicts();
  console.log(`   Resolved: ${resolved} conflicts\n`);

  // 7. Check final status
  console.log("7. Final sync status:");
  info = await manager.getInfo();
  console.log(`   Pending conflicts: ${info.pendingConflicts}`);

  // 8. Check conflict log
  console.log("\n8. Conflict log:");
  const log = await manager.getConflictLog();
  console.log(`   Total entries: ${log.length}`);
  for (const entry of log.slice(0, 2)) {
    console.log(`   - ${path.basename(entry.conflictPath)}: ${entry.resolution}`);
  }
  if (log.length > 2) {
    console.log(`   ... and ${log.length - 2} more`);
  }

  // Cleanup
  await manager.shutdown();

  console.log("\nIntegration test passed!");
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  console.log("===================================================");
  console.log("   Sync Manager Test Suite");
  console.log("===================================================");

  try {
    await setup();

    await testSyncConfig();
    await testSyncthingHelper();
    await testConflictDetector();
    await testSyncManager();
    await testIntegration();

    console.log("\n===================================================");
    console.log("   All Sync Tests Passed!");
    console.log("===================================================\n");
  } catch (error) {
    console.error("\n\nTEST FAILED:", error);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

main();
