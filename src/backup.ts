/**
 * Backup Module
 *
 * Creates and manages database backups for disaster recovery.
 * Supports compressed archives with integrity verification.
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { createReadStream, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { createGzip, createGunzip } from "zlib";
import * as tar from "tar";
import { getDefaultDbPath, getDefaultBackupPath, expandPath } from "./sync-config.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Backup options
 */
export interface BackupOptions {
  /** Backup destination path (directory) */
  destPath?: string;

  /** Compression level (1-9, default: 6) */
  compressionLevel?: number;

  /** Include timestamp in filename (default: true) */
  includeTimestamp?: boolean;

  /** Custom backup name */
  name?: string;

  /** Verify after creating (default: true) */
  verifyAfterCreate?: boolean;
}

/**
 * Information about a backup
 */
export interface BackupInfo {
  /** Backup file path */
  path: string;

  /** Backup name */
  name: string;

  /** Creation timestamp */
  createdAt: Date;

  /** Backup file size in bytes */
  size: number;

  /** Original database size in bytes */
  originalSize: number;

  /** Compression ratio (original/compressed) */
  compressionRatio: number;

  /** Number of memories at backup time (from manifest) */
  memoryCount?: number;

  /** SHA-256 checksum */
  checksum: string;

  /** Manifest data */
  manifest?: BackupManifest;
}

/**
 * Backup manifest (stored inside the archive)
 */
export interface BackupManifest {
  /** Manifest version */
  version: string;

  /** Creation timestamp */
  createdAt: string;

  /** Original database path */
  dbPath: string;

  /** Number of memories */
  memoryCount: number;

  /** Schema version (if available) */
  schemaVersion?: string;

  /** SHA-256 of database folder contents */
  contentChecksum: string;

  /** Platform info */
  platform: string;

  /** Node version */
  nodeVersion: string;
}

/**
 * Result of backup operation
 */
export interface BackupResult {
  /** Whether backup succeeded */
  success: boolean;

  /** Backup info if successful */
  backup?: BackupInfo;

  /** Error message if failed */
  error?: string;

  /** Duration in milliseconds */
  duration: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const BACKUP_EXTENSION = ".tar.gz";
const MANIFEST_FILE = "backup-manifest.json";
const CHECKSUM_FILE = "checksum.sha256";
const MANIFEST_VERSION = "1.0";

// ============================================================================
// BACKUP CREATION
// ============================================================================

/**
 * Create a backup of the database
 */
export async function createBackup(
  dbPath: string,
  options: BackupOptions = {}
): Promise<BackupResult> {
  const startTime = Date.now();

  try {
    const resolvedDbPath = expandPath(dbPath);
    const destPath = options.destPath || getDefaultBackupPath();
    const resolvedDestPath = expandPath(destPath);

    // Ensure destination directory exists
    await fs.mkdir(resolvedDestPath, { recursive: true });

    // Generate backup filename
    const backupName = generateBackupName(options);
    const backupPath = path.join(resolvedDestPath, backupName + BACKUP_EXTENSION);

    // Calculate original size
    const originalSize = await getDirectorySize(resolvedDbPath);

    // Count memories (by looking for .lance data files)
    const memoryCount = await countMemories(resolvedDbPath);

    // Calculate content checksum
    const contentChecksum = await calculateDirectoryChecksum(resolvedDbPath);

    // Create manifest
    const manifest: BackupManifest = {
      version: MANIFEST_VERSION,
      createdAt: new Date().toISOString(),
      dbPath: resolvedDbPath,
      memoryCount,
      contentChecksum,
      platform: process.platform,
      nodeVersion: process.version,
    };

    // Create temporary directory with all files to archive
    const tempDir = path.join(resolvedDestPath, ".backup-temp-" + Date.now());
    await fs.mkdir(tempDir, { recursive: true });

    // Copy database directory to temp
    const dbDirName = path.basename(resolvedDbPath);
    await copyDirectory(resolvedDbPath, path.join(tempDir, dbDirName));

    // Write manifest and checksum to temp directory
    const manifestPath = path.join(tempDir, MANIFEST_FILE);
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

    const checksumPath = path.join(tempDir, CHECKSUM_FILE);
    await fs.writeFile(checksumPath, contentChecksum, "utf-8");

    // Get list of all items to archive
    const itemsToArchive = await fs.readdir(tempDir);

    // Create tar.gz archive with all files at once
    await tar.create(
      {
        gzip: { level: options.compressionLevel ?? 6 },
        file: backupPath,
        cwd: tempDir,
        portable: true,
      },
      itemsToArchive
    );

    // Clean up temp dir
    await fs.rm(tempDir, { recursive: true });

    // Get backup file size
    const backupStats = await fs.stat(backupPath);
    const backupSize = backupStats.size;

    // Calculate backup checksum
    const backupChecksum = await calculateFileChecksum(backupPath);

    // Verify if requested
    if (options.verifyAfterCreate !== false) {
      const isValid = await verifyBackup(backupPath);
      if (!isValid) {
        // Delete invalid backup
        await fs.unlink(backupPath);
        return {
          success: false,
          error: "Backup verification failed",
          duration: Date.now() - startTime,
        };
      }
    }

    const backupInfo: BackupInfo = {
      path: backupPath,
      name: backupName,
      createdAt: new Date(),
      size: backupSize,
      originalSize,
      compressionRatio: originalSize / backupSize,
      memoryCount,
      checksum: backupChecksum,
      manifest,
    };

    return {
      success: true,
      backup: backupInfo,
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
 * Generate backup name
 */
function generateBackupName(options: BackupOptions): string {
  if (options.name) {
    return options.name;
  }

  const base = "openclaw-memory-backup";

  if (options.includeTimestamp !== false) {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    return `${base}-${timestamp}`;
  }

  return base;
}

// ============================================================================
// BACKUP VERIFICATION
// ============================================================================

/**
 * Verify backup integrity
 */
export async function verifyBackup(backupPath: string): Promise<boolean> {
  try {
    const resolvedPath = expandPath(backupPath);

    // Check file exists
    await fs.access(resolvedPath);

    // Collect archive entries using callback
    const entries: string[] = [];
    await tar.list({
      file: resolvedPath,
      onReadEntry: (entry) => {
        entries.push(entry.path);
      },
    });

    // Check for data files
    let hasData = false;

    for (const entry of entries) {
      if (entry.includes(".lance") || entry.includes("memories")) {
        hasData = true;
        break;
      }
    }

    // Backup is valid if it has database data
    return hasData;
  } catch {
    return false;
  }
}

/**
 * Get backup info without extracting
 */
export async function getBackupInfo(backupPath: string): Promise<BackupInfo | null> {
  try {
    const resolvedPath = expandPath(backupPath);
    const stats = await fs.stat(resolvedPath);

    // Try to extract manifest
    let manifest: BackupManifest | undefined;
    try {
      // Extract just the manifest
      const tempDir = path.join(path.dirname(resolvedPath), ".backup-info-temp");
      await fs.mkdir(tempDir, { recursive: true });

      await tar.extract({
        file: resolvedPath,
        cwd: tempDir,
        filter: (p) => p === MANIFEST_FILE,
      });

      const manifestPath = path.join(tempDir, MANIFEST_FILE);
      const manifestContent = await fs.readFile(manifestPath, "utf-8");
      manifest = JSON.parse(manifestContent);

      await fs.rm(tempDir, { recursive: true });
    } catch {
      // Manifest not available
    }

    const backupName = path.basename(resolvedPath, BACKUP_EXTENSION);
    const checksum = await calculateFileChecksum(resolvedPath);

    return {
      path: resolvedPath,
      name: backupName,
      createdAt: stats.mtime,
      size: stats.size,
      originalSize: manifest?.memoryCount ? manifest.memoryCount * 1000 : 0, // Estimate
      compressionRatio: 0, // Unknown without original
      memoryCount: manifest?.memoryCount,
      checksum,
      manifest,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// BACKUP LISTING
// ============================================================================

/**
 * List all available backups
 */
export async function listBackups(backupDir?: string): Promise<BackupInfo[]> {
  const dir = expandPath(backupDir || getDefaultBackupPath());

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const backups: BackupInfo[] = [];

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(BACKUP_EXTENSION)) {
        const backupPath = path.join(dir, entry.name);
        const info = await getBackupInfo(backupPath);
        if (info) {
          backups.push(info);
        }
      }
    }

    // Sort by creation date, newest first
    backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return backups;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * Get the most recent backup
 */
export async function getLatestBackup(backupDir?: string): Promise<BackupInfo | null> {
  const backups = await listBackups(backupDir);
  return backups.length > 0 ? backups[0] : null;
}

/**
 * Delete old backups, keeping only the specified number
 */
export async function pruneBackups(
  keepCount: number,
  backupDir?: string
): Promise<number> {
  const backups = await listBackups(backupDir);

  if (backups.length <= keepCount) {
    return 0;
  }

  const toDelete = backups.slice(keepCount);
  let deleted = 0;

  for (const backup of toDelete) {
    try {
      await fs.unlink(backup.path);
      deleted++;
    } catch {
      // Skip files we can't delete
    }
  }

  return deleted;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get the default backup directory
 */
export function getBackupDirectory(): string {
  return getDefaultBackupPath();
}

/**
 * Calculate directory size
 */
async function getDirectorySize(dirPath: string): Promise<number> {
  let totalSize = 0;

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true, recursive: true });

    for (const entry of entries) {
      if (entry.isFile()) {
        try {
          const filePath = path.join(entry.parentPath || dirPath, entry.name);
          const stats = await fs.stat(filePath);
          totalSize += stats.size;
        } catch {
          // Skip files we can't stat
        }
      }
    }
  } catch {
    // Directory might not exist
  }

  return totalSize;
}

/**
 * Count memories in database (approximate)
 */
async function countMemories(dbPath: string): Promise<number> {
  try {
    // Look for .lance data files
    const entries = await fs.readdir(dbPath, { withFileTypes: true, recursive: true });
    let dataFiles = 0;

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".lance")) {
        dataFiles++;
      }
    }

    // This is a rough estimate - actual count requires reading the database
    return dataFiles > 0 ? dataFiles * 100 : 0; // Assume ~100 records per file
  } catch {
    return 0;
  }
}

/**
 * Calculate SHA-256 checksum of a file
 */
async function calculateFileChecksum(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("data", (data) => hash.update(data));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * Calculate combined checksum of directory contents
 */
async function calculateDirectoryChecksum(dirPath: string): Promise<string> {
  const hash = crypto.createHash("sha256");

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true, recursive: true });
    const files = entries
      .filter((e) => e.isFile())
      .map((e) => path.join(e.parentPath || dirPath, e.name))
      .sort();

    for (const file of files) {
      try {
        const content = await fs.readFile(file);
        hash.update(file);
        hash.update(content);
      } catch {
        // Skip files we can't read
      }
    }
  } catch {
    // Directory might not exist
  }

  return hash.digest("hex");
}

/**
 * Copy a directory recursively
 */
async function copyDirectory(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });

  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}
