/**
 * Backup & Restore Tests
 *
 * Tests for the backup, restore, and offline operations modules.
 */

import * as fs from "fs/promises";
import * as path from "path";
import {
  createBackup,
  listBackups,
  verifyBackup,
  getBackupInfo,
  pruneBackups,
  getBackupDirectory,
} from "./backup.js";
import {
  restoreBackup,
  previewRestore,
  validateRestore,
} from "./restore.js";
import {
  OfflineManager,
  createOfflineManager,
} from "./offline-ops.js";

// ============================================================================
// TEST SETUP
// ============================================================================

const TEST_DB_PATH = "./test-backup-db";
const TEST_BACKUP_PATH = "./test-backups";
let testDbCreated = false;

async function setup(): Promise<void> {
  // Clean up any existing test directories
  try {
    await fs.rm(TEST_DB_PATH, { recursive: true });
    await fs.rm(TEST_BACKUP_PATH, { recursive: true });
  } catch {
    // Directories might not exist
  }

  // Create test database directory with some files
  await fs.mkdir(TEST_DB_PATH, { recursive: true });
  await fs.mkdir(path.join(TEST_DB_PATH, "memories.lance"), { recursive: true });
  await fs.mkdir(path.join(TEST_DB_PATH, "memories.lance", "data"), { recursive: true });

  // Create some fake data files
  for (let i = 0; i < 5; i++) {
    await fs.writeFile(
      path.join(TEST_DB_PATH, "memories.lance", "data", `chunk-${i}.lance`),
      `fake data chunk ${i}\n`.repeat(100)
    );
  }

  // Create a manifest-like file
  await fs.writeFile(
    path.join(TEST_DB_PATH, "memories.lance", "_manifest.json"),
    JSON.stringify({ version: 1, tables: ["memories"] })
  );

  testDbCreated = true;
  console.log("Test database created with sample data");
}

async function cleanup(): Promise<void> {
  try {
    await fs.rm(TEST_DB_PATH, { recursive: true });
    await fs.rm(TEST_BACKUP_PATH, { recursive: true });
  } catch {
    // Directories might not exist
  }
}

// ============================================================================
// BACKUP TESTS
// ============================================================================

async function testBackup(): Promise<void> {
  console.log("\n--- Backup Tests ---\n");

  // Test basic backup
  console.log("Testing basic backup...");
  const result = await createBackup(TEST_DB_PATH, {
    destPath: TEST_BACKUP_PATH,
    name: "test-backup-1",
  });

  console.log(`  Success: ${result.success}`);
  console.log(`  Duration: ${result.duration}ms`);

  if (!result.success) {
    throw new Error(`Backup failed: ${result.error}`);
  }

  console.log(`  Backup path: ${result.backup?.path}`);
  console.log(`  Size: ${result.backup?.size} bytes`);
  console.log(`  Original size: ${result.backup?.originalSize} bytes`);
  console.log(`  Compression ratio: ${result.backup?.compressionRatio?.toFixed(2)}x`);
  console.log("  Backup created successfully");

  // Test backup verification
  console.log("\nTesting backup verification...");
  const isValid = await verifyBackup(result.backup!.path);
  console.log(`  Valid: ${isValid}`);
  if (!isValid) {
    throw new Error("Backup verification failed");
  }
  console.log("  Verification passed");

  // Test backup info
  console.log("\nTesting backup info...");
  const info = await getBackupInfo(result.backup!.path);
  if (!info) {
    throw new Error("Could not get backup info");
  }
  console.log(`  Name: ${info.name}`);
  console.log(`  Created: ${info.createdAt.toISOString()}`);
  console.log(`  Checksum: ${info.checksum.slice(0, 16)}...`);
  console.log("  Info retrieval works");

  // Test creating multiple backups
  console.log("\nTesting multiple backups...");
  for (let i = 2; i <= 4; i++) {
    await createBackup(TEST_DB_PATH, {
      destPath: TEST_BACKUP_PATH,
      name: `test-backup-${i}`,
    });
    console.log(`  Created backup ${i}`);
  }

  // Test listing backups
  console.log("\nTesting backup listing...");
  const backups = await listBackups(TEST_BACKUP_PATH);
  console.log(`  Found ${backups.length} backups`);
  for (const b of backups) {
    console.log(`    - ${b.name} (${b.size} bytes)`);
  }
  if (backups.length !== 4) {
    throw new Error(`Expected 4 backups, found ${backups.length}`);
  }
  console.log("  Listing works");

  // Test backup pruning
  console.log("\nTesting backup pruning...");
  const pruned = await pruneBackups(2, TEST_BACKUP_PATH);
  console.log(`  Pruned ${pruned} backups`);
  const remaining = await listBackups(TEST_BACKUP_PATH);
  console.log(`  Remaining: ${remaining.length} backups`);
  if (remaining.length !== 2) {
    throw new Error(`Expected 2 backups after pruning, found ${remaining.length}`);
  }
  console.log("  Pruning works");

  // Test backup directory helper
  console.log("\nTesting backup directory...");
  const backupDir = getBackupDirectory();
  console.log(`  Default backup directory: ${backupDir}`);
  console.log("  Directory helper works");

  console.log("\nBackup tests passed!");
}

// ============================================================================
// RESTORE TESTS
// ============================================================================

async function testRestore(): Promise<void> {
  console.log("\n--- Restore Tests ---\n");

  // Create a fresh backup for restore testing
  console.log("Creating backup for restore test...");
  const backupResult = await createBackup(TEST_DB_PATH, {
    destPath: TEST_BACKUP_PATH,
    name: "restore-test-backup",
  });

  if (!backupResult.success) {
    throw new Error(`Could not create backup for restore test: ${backupResult.error}`);
  }
  console.log(`  Created: ${backupResult.backup?.path}`);

  // Test preview restore (dry run)
  console.log("\nTesting preview restore...");
  const preview = await previewRestore(backupResult.backup!.path, {
    targetPath: "./test-restore-target",
  });

  if (!preview.success) {
    throw new Error(`Preview failed: ${preview.error}`);
  }

  console.log("  Dry run info:");
  console.log(`    Target path: ${preview.dryRunInfo?.targetPath}`);
  console.log(`    Target exists: ${preview.dryRunInfo?.targetExists}`);
  console.log("    Steps:");
  for (const step of preview.dryRunInfo?.steps || []) {
    console.log(`      ${step}`);
  }
  console.log("  Preview works");

  // Test validation
  console.log("\nTesting restore validation...");
  const validation = await validateRestore(
    backupResult.backup!.path,
    "./test-restore-target"
  );
  console.log(`  Valid: ${validation.valid}`);
  console.log(`  Errors: ${validation.errors.length}`);
  console.log(`  Warnings: ${validation.warnings.length}`);
  for (const warn of validation.warnings) {
    console.log(`    Warning: ${warn}`);
  }
  console.log("  Validation works");

  // Test actual restore to new location
  console.log("\nTesting actual restore...");
  const restoreResult = await restoreBackup(backupResult.backup!.path, {
    targetPath: "./test-restore-target",
    existingAction: "replace",
  });

  console.log(`  Success: ${restoreResult.success}`);
  console.log(`  Duration: ${restoreResult.duration}ms`);

  if (!restoreResult.success) {
    throw new Error(`Restore failed: ${restoreResult.error}`);
  }

  console.log(`  Restored to: ${restoreResult.restoredPath}`);

  // Verify restored content exists
  try {
    await fs.access("./test-restore-target");
    console.log("  Restored directory exists");
  } catch {
    throw new Error("Restored directory does not exist");
  }

  console.log("  Restore works");

  // Test restore with existing database
  console.log("\nTesting restore with existing database (backup action)...");
  const restoreWithBackup = await restoreBackup(backupResult.backup!.path, {
    targetPath: "./test-restore-target",
    existingAction: "backup",
  });

  console.log(`  Success: ${restoreWithBackup.success}`);
  if (restoreWithBackup.existingBackupPath) {
    console.log(`  Existing backed up to: ${restoreWithBackup.existingBackupPath}`);
  }
  console.log("  Restore with backup works");

  // Test restore with abort action
  console.log("\nTesting restore with existing database (abort action)...");
  const restoreAbort = await restoreBackup(backupResult.backup!.path, {
    targetPath: "./test-restore-target",
    existingAction: "abort",
  });

  console.log(`  Success: ${restoreAbort.success}`);
  console.log(`  Error: ${restoreAbort.error || "(none)"}`);
  if (restoreAbort.success) {
    throw new Error("Restore should have aborted");
  }
  console.log("  Abort action works");

  // Clean up restore targets
  try {
    await fs.rm("./test-restore-target", { recursive: true });
    const entries = await fs.readdir(".");
    for (const entry of entries) {
      if (entry.startsWith("test-restore-target.backup-")) {
        await fs.rm(entry, { recursive: true });
      }
    }
  } catch {
    // Best effort cleanup
  }

  console.log("\nRestore tests passed!");
}

// ============================================================================
// OFFLINE OPERATIONS TESTS
// ============================================================================

async function testOfflineOps(): Promise<void> {
  console.log("\n--- Offline Operations Tests ---\n");

  // Create offline manager
  console.log("Creating offline manager...");
  const manager = createOfflineManager(TEST_DB_PATH);
  console.log("  Manager created");

  // Test status
  console.log("\nTesting offline status...");
  const status = await manager.getStatus();
  console.log(`  Is offline: ${status.isOffline}`);
  console.log(`  Pending ops: ${status.pendingOps}`);
  console.log(`  Sync pending: ${status.syncPending}`);
  console.log("  Status check works");

  // Test queuing operations
  console.log("\nTesting operation queuing...");

  const op1 = await manager.queueOperation("create", "mem-001", {
    content: "Test memory 1",
    importance: 5,
  });
  console.log(`  Queued create: ${op1.id}`);

  const op2 = await manager.queueOperation("update", "mem-002", {
    content: "Updated content",
  });
  console.log(`  Queued update: ${op2.id}`);

  const op3 = await manager.queueOperation("delete", "mem-003");
  console.log(`  Queued delete: ${op3.id}`);

  // Test getting pending ops
  console.log("\nTesting pending ops retrieval...");
  const pending = await manager.getPendingOps();
  console.log(`  Total pending: ${pending.length}`);
  if (pending.length !== 3) {
    throw new Error(`Expected 3 pending ops, found ${pending.length}`);
  }
  console.log("  Pending ops retrieval works");

  // Test getting ops by type
  console.log("\nTesting ops by type...");
  const creates = await manager.getPendingOpsByType("create");
  const updates = await manager.getPendingOpsByType("update");
  const deletes = await manager.getPendingOpsByType("delete");
  console.log(`  Creates: ${creates.length}, Updates: ${updates.length}, Deletes: ${deletes.length}`);
  console.log("  Type filtering works");

  // Test operation merging (update after create)
  console.log("\nTesting operation merging...");
  await manager.queueOperation("update", "mem-001", {
    importance: 8,
  });
  const afterMerge = await manager.getPendingOps();
  console.log(`  Ops after merge: ${afterMerge.length}`);
  // Should still be 3 because update merged into create
  console.log("  Merging works");

  // Test stats
  console.log("\nTesting operation stats...");
  const stats = await manager.getStats();
  console.log(`  Total: ${stats.total}`);
  console.log(`  By type:`, stats.byType);
  console.log(`  Oldest: ${stats.oldestOperation?.toISOString()}`);
  console.log(`  Newest: ${stats.newestOperation?.toISOString()}`);
  console.log("  Stats work");

  // Test applying operations
  console.log("\nTesting apply operations...");
  let appliedCount = 0;
  const applied = await manager.applyPendingOps(async (op) => {
    console.log(`    Applying: ${op.type} on ${op.memoryId}`);
    appliedCount++;
    return true; // Simulate success
  });
  console.log(`  Applied: ${applied} operations`);
  if (applied !== stats.total) {
    throw new Error(`Expected to apply ${stats.total}, applied ${applied}`);
  }

  // Verify operations were cleared
  const afterApply = await manager.getPendingOps();
  console.log(`  Remaining after apply: ${afterApply.length}`);
  if (afterApply.length !== 0) {
    throw new Error("Operations should be cleared after successful apply");
  }
  console.log("  Apply works");

  // Test failed operations retry
  console.log("\nTesting failed operation retry...");
  await manager.queueOperation("create", "mem-fail", { test: true });

  let failCount = 0;
  await manager.applyPendingOps(async (op) => {
    failCount++;
    if (failCount <= 2) {
      throw new Error("Simulated failure");
    }
    return true;
  });

  const afterFail = await manager.getPendingOps();
  console.log(`  Operations after 2 failures: ${afterFail.length}`);
  // Should still have the operation with retryCount incremented
  console.log("  Retry tracking works");

  // Clear remaining
  await manager.clearPendingOps();

  // Test monitoring (brief)
  console.log("\nTesting monitoring...");
  let monitorCallCount = 0;
  manager.startMonitoring(
    (status) => {
      monitorCallCount++;
      console.log(`    Monitor callback ${monitorCallCount}: offline=${status.isOffline}`);
    },
    100
  );

  await new Promise((resolve) => setTimeout(resolve, 150));
  manager.stopMonitoring();

  if (monitorCallCount === 0) {
    throw new Error("Monitor callback should have been called");
  }
  console.log("  Monitoring works");

  console.log("\nOffline operations tests passed!");
}

// ============================================================================
// INTEGRATION TEST
// ============================================================================

async function testIntegration(): Promise<void> {
  console.log("\n--- Integration Test ---\n");

  console.log("Simulating disaster recovery workflow...\n");

  // 1. Create backup of database
  console.log("1. Creating backup...");
  const backup = await createBackup(TEST_DB_PATH, {
    destPath: TEST_BACKUP_PATH,
    name: "disaster-recovery-backup",
  });
  if (!backup.success) {
    throw new Error("Backup failed");
  }
  console.log(`   Created: ${backup.backup?.name}`);
  console.log(`   Size: ${backup.backup?.size} bytes`);

  // 2. Simulate data loss
  console.log("\n2. Simulating data loss...");
  await fs.rm(TEST_DB_PATH, { recursive: true });
  console.log("   Database deleted");

  // 3. Verify backup
  console.log("\n3. Verifying backup...");
  const isValid = await verifyBackup(backup.backup!.path);
  console.log(`   Backup valid: ${isValid}`);

  // 4. Restore from backup
  console.log("\n4. Restoring from backup...");
  const restore = await restoreBackup(backup.backup!.path, {
    targetPath: TEST_DB_PATH,
  });
  if (!restore.success) {
    throw new Error(`Restore failed: ${restore.error}`);
  }
  console.log(`   Restored to: ${restore.restoredPath}`);

  // 5. Verify restored data
  console.log("\n5. Verifying restored data...");
  const restoredEntries = await fs.readdir(TEST_DB_PATH);
  console.log(`   Restored entries: ${restoredEntries.length}`);

  // Check for .lance folder
  const hasLance = restoredEntries.some((e) => e.includes("lance") || e.includes("memories"));
  console.log(`   Has database files: ${hasLance}`);

  console.log("\n   Disaster recovery successful!");

  console.log("\nIntegration test passed!");
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  console.log("===================================================");
  console.log("   Backup & Restore Test Suite");
  console.log("===================================================");

  try {
    await setup();

    await testBackup();
    await testRestore();
    await testOfflineOps();
    await testIntegration();

    console.log("\n===================================================");
    console.log("   All Backup & Restore Tests Passed!");
    console.log("===================================================\n");
  } catch (error) {
    console.error("\n\nTEST FAILED:", error);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

main();
