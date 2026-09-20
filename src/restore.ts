/**
 * Restore Module
 *
 * Restores database from backups with safety checks.
 * Supports dry-run mode and handles existing databases.
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as tar from "tar";
import {
  BackupInfo,
  BackupManifest,
  getBackupInfo,
  verifyBackup,
} from "./backup.js";
import { getDefaultDbPath, expandPath } from "./sync-config.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Restore options
 */
export interface RestoreOptions {
  /** Target path for restored database */
  targetPath?: string;

  /** What to do with existing database */
  existingAction?: "backup" | "replace" | "abort";

  /** Verify backup before restore (default: true) */
  verify?: boolean;

  /** Dry run - don't actually restore (default: false) */
  dryRun?: boolean;
}

/**
 * Result of restore operation
 */
export interface RestoreResult {
  /** Whether restore succeeded */
  success: boolean;

  /** Restored database path */
  restoredPath?: string;

  /** Backup path of existing database (if backed up) */
  existingBackupPath?: string;

  /** Number of memories restored */
  memoryCount?: number;

  /** Error message if failed */
  error?: string;

  /** Duration in milliseconds */
  duration: number;

  /** Dry run - what would happen */
  dryRunInfo?: DryRunInfo;
}

/**
 * Dry run information
 */
export interface DryRunInfo {
  /** Backup file info */
  backup: BackupInfo;

  /** Target path */
  targetPath: string;

  /** Whether target exists */
  targetExists: boolean;

  /** What would happen to existing */
  existingAction: "backup" | "replace" | "abort";

  /** Steps that would be taken */
  steps: string[];
}

// ============================================================================
// RESTORE FUNCTIONS
// ============================================================================

/**
 * Restore database from backup
 */
export async function restoreBackup(
  backupPath: string,
  options: RestoreOptions = {}
): Promise<RestoreResult> {
  const startTime = Date.now();

  try {
    const resolvedBackupPath = expandPath(backupPath);
    const targetPath = options.targetPath || getDefaultDbPath();
    const resolvedTargetPath = expandPath(targetPath);
    const existingAction = options.existingAction ?? "backup";

    // Verify backup first
    if (options.verify !== false) {
      const isValid = await verifyBackup(resolvedBackupPath);
      if (!isValid) {
        return {
          success: false,
          error: "Backup verification failed - archive may be corrupted",
          duration: Date.now() - startTime,
        };
      }
    }

    // Get backup info
    const backupInfo = await getBackupInfo(resolvedBackupPath);
    if (!backupInfo) {
      return {
        success: false,
        error: "Could not read backup information",
        duration: Date.now() - startTime,
      };
    }

    // Check if target exists
    let targetExists = false;
    try {
      await fs.access(resolvedTargetPath);
      targetExists = true;
    } catch {
      targetExists = false;
    }

    // Dry run - just report what would happen
    if (options.dryRun) {
      const steps: string[] = [];
      steps.push(`1. Verify backup: ${resolvedBackupPath}`);

      if (targetExists) {
        switch (existingAction) {
          case "backup":
            steps.push(`2. Backup existing database to: ${resolvedTargetPath}.backup-${Date.now()}`);
            steps.push(`3. Remove existing database`);
            break;
          case "replace":
            steps.push(`2. Remove existing database at: ${resolvedTargetPath}`);
            break;
          case "abort":
            steps.push(`2. ABORT - database already exists at: ${resolvedTargetPath}`);
            break;
        }
      } else {
        steps.push(`2. Create target directory: ${resolvedTargetPath}`);
      }

      steps.push(`${targetExists ? (existingAction === "abort" ? "SKIPPED" : "4") : "3"}. Extract backup to: ${resolvedTargetPath}`);
      steps.push(`${targetExists ? (existingAction === "abort" ? "SKIPPED" : "5") : "4"}. Verify extracted database`);

      return {
        success: true,
        duration: Date.now() - startTime,
        dryRunInfo: {
          backup: backupInfo,
          targetPath: resolvedTargetPath,
          targetExists,
          existingAction,
          steps,
        },
      };
    }

    // Handle existing database
    let existingBackupPath: string | undefined;

    if (targetExists) {
      switch (existingAction) {
        case "abort":
          return {
            success: false,
            error: `Database already exists at: ${resolvedTargetPath}`,
            duration: Date.now() - startTime,
          };

        case "backup":
          // Backup existing database
          existingBackupPath = `${resolvedTargetPath}.backup-${Date.now()}`;
          await fs.rename(resolvedTargetPath, existingBackupPath);
          break;

        case "replace":
          // Remove existing database
          await fs.rm(resolvedTargetPath, { recursive: true });
          break;
      }
    }

    // Create target directory
    await fs.mkdir(resolvedTargetPath, { recursive: true });

    // Extract backup
    try {
      await tar.extract({
        file: resolvedBackupPath,
        cwd: path.dirname(resolvedTargetPath),
        // Filter out manifest files - we just want the database
        filter: (p) => !p.includes("backup-manifest") && !p.includes("checksum"),
      });

      // The extracted folder might have a different name
      // Try to find and rename it to the target name
      const extractedEntries = await fs.readdir(path.dirname(resolvedTargetPath));
      for (const entry of extractedEntries) {
        const entryPath = path.join(path.dirname(resolvedTargetPath), entry);
        // If there's a memories or .lance folder that's not our target
        if (
          (entry.includes("memories") || entry.includes(".lance") || entry === "openclaw-memory") &&
          entryPath !== resolvedTargetPath
        ) {
          // Check if target doesn't exist yet
          try {
            await fs.access(resolvedTargetPath);
          } catch {
            // Target doesn't exist, rename
            await fs.rename(entryPath, resolvedTargetPath);
          }
        }
      }
    } catch (extractError) {
      // Restore backup if we backed up the original
      if (existingBackupPath) {
        try {
          await fs.rm(resolvedTargetPath, { recursive: true });
          await fs.rename(existingBackupPath, resolvedTargetPath);
        } catch {
          // Best effort restore
        }
      }

      throw extractError;
    }

    // Verify extraction
    const extractedStats = await fs.stat(resolvedTargetPath);
    if (!extractedStats.isDirectory()) {
      throw new Error("Extraction failed - target is not a directory");
    }

    // Clean up old backup if everything succeeded
    if (existingBackupPath) {
      // Keep the backup for safety - user can delete it manually
      // await fs.rm(existingBackupPath, { recursive: true });
    }

    return {
      success: true,
      restoredPath: resolvedTargetPath,
      existingBackupPath,
      memoryCount: backupInfo.memoryCount,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Preview restore without executing
 *
 * Shows what would happen if restore is executed.
 */
export async function previewRestore(
  backupPath: string,
  options?: RestoreOptions
): Promise<RestoreResult> {
  return restoreBackup(backupPath, { ...options, dryRun: true });
}

/**
 * Quick restore from latest backup
 */
export async function restoreLatest(
  backupDir: string,
  options?: RestoreOptions
): Promise<RestoreResult> {
  const startTime = Date.now();

  try {
    const { listBackups } = await import("./backup.js");
    const backups = await listBackups(backupDir);

    if (backups.length === 0) {
      return {
        success: false,
        error: "No backups found",
        duration: Date.now() - startTime,
      };
    }

    // Get the latest backup
    const latest = backups[0];
    return restoreBackup(latest.path, options);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Validate a backup can be restored to a location
 */
export async function validateRestore(
  backupPath: string,
  targetPath?: string
): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const resolvedBackupPath = expandPath(backupPath);
  const resolvedTargetPath = expandPath(targetPath || getDefaultDbPath());

  // Check backup exists
  try {
    await fs.access(resolvedBackupPath);
  } catch {
    errors.push(`Backup file not found: ${resolvedBackupPath}`);
    return { valid: false, errors, warnings };
  }

  // Verify backup
  const isValid = await verifyBackup(resolvedBackupPath);
  if (!isValid) {
    errors.push("Backup verification failed - archive may be corrupted");
    return { valid: false, errors, warnings };
  }

  // Check target
  try {
    await fs.access(resolvedTargetPath);
    warnings.push(`Target directory exists: ${resolvedTargetPath}`);
    warnings.push("Existing database will need to be backed up or removed");
  } catch {
    // Target doesn't exist - good
  }

  // Check parent directory is writable
  const parentDir = path.dirname(resolvedTargetPath);
  try {
    await fs.access(parentDir, fs.constants.W_OK);
  } catch {
    errors.push(`Cannot write to parent directory: ${parentDir}`);
  }

  // Get backup info for additional checks
  const backupInfo = await getBackupInfo(resolvedBackupPath);
  if (backupInfo?.manifest) {
    const manifest = backupInfo.manifest;

    // Check platform compatibility
    if (manifest.platform !== process.platform) {
      warnings.push(
        `Backup was created on ${manifest.platform}, current platform is ${process.platform}`
      );
    }

    // Check age
    const backupDate = new Date(manifest.createdAt);
    const ageInDays = (Date.now() - backupDate.getTime()) / (1000 * 60 * 60 * 24);
    if (ageInDays > 30) {
      warnings.push(`Backup is ${Math.floor(ageInDays)} days old`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
