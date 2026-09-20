/**
 * Conflict Detection Module
 *
 * Detects and handles Syncthing sync conflicts.
 * Supports multiple resolution strategies and maintains a conflict log.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { expandPath } from "./sync-config.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Information about a conflict file
 */
export interface ConflictFile {
  /** Original file path */
  originalPath: string;

  /** Conflict file path */
  conflictPath: string;

  /** Device ID that created the conflict (from filename) */
  deviceId: string;

  /** Timestamp of conflict (from filename) */
  timestamp: Date;

  /** File size in bytes */
  size: number;

  /** File extension */
  extension: string;
}

/**
 * Resolution decision for a conflict
 */
export interface ConflictResolution {
  /** Keep the original file */
  keepOriginal: boolean;

  /** Keep the conflict file (rename to original) */
  keepConflict: boolean;

  /** Action taken */
  action: "kept-original" | "kept-conflict" | "kept-both" | "deleted-both";
}

/**
 * Resolution strategy
 */
export type ResolutionStrategy = "last-write-wins" | "keep-both" | "manual";

/**
 * Log entry for resolved conflicts
 */
export interface ConflictLogEntry {
  /** Original file path */
  originalPath: string;

  /** Conflict file path */
  conflictPath: string;

  /** Device ID */
  deviceId: string;

  /** Conflict timestamp */
  conflictTimestamp: Date;

  /** Resolution timestamp */
  resolvedAt: Date;

  /** Resolution action */
  resolution: ConflictResolution["action"];

  /** Strategy used */
  strategy: ResolutionStrategy;
}

/**
 * Options for conflict detector
 */
export interface ConflictDetectorOptions {
  /** Default resolution strategy */
  strategy?: ResolutionStrategy;

  /** Path to conflict log file */
  logPath?: string;

  /** Auto-resolve conflicts (default: true for last-write-wins) */
  autoResolve?: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Syncthing conflict file pattern
 * Format: filename.sync-conflict-20240203-123456-DEVICEID.ext
 */
const CONFLICT_PATTERN = /^(.+)\.sync-conflict-(\d{8})-(\d{6})-([A-Z0-9]+)(\.[^.]+)?$/;

/**
 * Default log file name
 */
const DEFAULT_LOG_FILE = ".conflict-log.json";

// ============================================================================
// CONFLICT DETECTOR
// ============================================================================

/**
 * Conflict Detector class
 *
 * Scans for, parses, and resolves Syncthing conflict files.
 */
export class ConflictDetector {
  private dbPath: string;
  private strategy: ResolutionStrategy;
  private logPath: string;
  private autoResolve: boolean;

  constructor(dbPath: string, options: ConflictDetectorOptions = {}) {
    this.dbPath = expandPath(dbPath);
    this.strategy = options.strategy ?? "last-write-wins";
    this.logPath =
      options.logPath ?? path.join(this.dbPath, DEFAULT_LOG_FILE);
    this.autoResolve = options.autoResolve ?? this.strategy === "last-write-wins";
  }

  /**
   * Scan for conflict files in the database folder
   */
  async scan(): Promise<ConflictFile[]> {
    const conflicts: ConflictFile[] = [];

    try {
      await this.scanDirectory(this.dbPath, conflicts);
    } catch (error) {
      console.error("Error scanning for conflicts:", error);
    }

    return conflicts;
  }

  /**
   * Recursively scan a directory for conflict files
   */
  private async scanDirectory(
    dirPath: string,
    conflicts: ConflictFile[]
  ): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // Skip .stversions folder (Syncthing versioning)
          if (entry.name !== ".stversions") {
            await this.scanDirectory(fullPath, conflicts);
          }
        } else if (entry.isFile()) {
          const parsed = this.parseConflictFilename(entry.name);
          if (parsed) {
            const stats = await fs.stat(fullPath);
            const originalPath = path.join(
              dirPath,
              parsed.originalName + (parsed.extension || "")
            );

            conflicts.push({
              originalPath,
              conflictPath: fullPath,
              deviceId: parsed.deviceId,
              timestamp: parsed.timestamp,
              size: stats.size,
              extension: parsed.extension || "",
            });
          }
        }
      }
    } catch (error) {
      // Directory might not be accessible
      console.warn(`Warning: Could not scan ${dirPath}:`, error);
    }
  }

  /**
   * Parse a conflict filename to extract metadata
   */
  private parseConflictFilename(
    filename: string
  ): {
    originalName: string;
    timestamp: Date;
    deviceId: string;
    extension: string | undefined;
  } | null {
    const match = filename.match(CONFLICT_PATTERN);
    if (!match) {
      return null;
    }

    const [, originalName, dateStr, timeStr, deviceId, extension] = match;

    // Parse timestamp: 20240203-123456
    const year = parseInt(dateStr.slice(0, 4));
    const month = parseInt(dateStr.slice(4, 6)) - 1;
    const day = parseInt(dateStr.slice(6, 8));
    const hour = parseInt(timeStr.slice(0, 2));
    const minute = parseInt(timeStr.slice(2, 4));
    const second = parseInt(timeStr.slice(4, 6));

    const timestamp = new Date(year, month, day, hour, minute, second);

    return {
      originalName,
      timestamp,
      deviceId,
      extension,
    };
  }

  /**
   * Resolve a specific conflict
   */
  async resolve(
    conflict: ConflictFile,
    resolution: ConflictResolution
  ): Promise<void> {
    try {
      if (resolution.keepOriginal && !resolution.keepConflict) {
        // Delete conflict file
        await fs.unlink(conflict.conflictPath);
      } else if (resolution.keepConflict && !resolution.keepOriginal) {
        // Replace original with conflict
        await fs.rename(conflict.conflictPath, conflict.originalPath);
      } else if (resolution.keepOriginal && resolution.keepConflict) {
        // Keep both - rename conflict to .backup
        const backupPath =
          conflict.originalPath + ".backup-" + Date.now() + conflict.extension;
        await fs.rename(conflict.conflictPath, backupPath);
      } else {
        // Delete both (unusual but supported)
        await fs.unlink(conflict.conflictPath);
        try {
          await fs.unlink(conflict.originalPath);
        } catch {
          // Original might not exist
        }
      }

      // Log the resolution
      await this.logResolution(conflict, resolution);
    } catch (error) {
      throw new Error(
        `Failed to resolve conflict: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Resolve all conflicts using the default strategy
   */
  async resolveAll(): Promise<number> {
    const conflicts = await this.scan();
    let resolved = 0;

    for (const conflict of conflicts) {
      try {
        const resolution = await this.determineResolution(conflict);
        await this.resolve(conflict, resolution);
        resolved++;
      } catch (error) {
        console.error(
          `Failed to resolve conflict ${conflict.conflictPath}:`,
          error
        );
      }
    }

    return resolved;
  }

  /**
   * Determine resolution based on strategy
   */
  private async determineResolution(
    conflict: ConflictFile
  ): Promise<ConflictResolution> {
    switch (this.strategy) {
      case "last-write-wins":
        return this.lastWriteWinsResolution(conflict);

      case "keep-both":
        return {
          keepOriginal: true,
          keepConflict: true,
          action: "kept-both",
        };

      case "manual":
      default:
        // Don't auto-resolve manual conflicts
        throw new Error("Manual resolution required");
    }
  }

  /**
   * Last-write-wins resolution
   */
  private async lastWriteWinsResolution(
    conflict: ConflictFile
  ): Promise<ConflictResolution> {
    try {
      const originalStats = await fs.stat(conflict.originalPath);
      const originalMtime = originalStats.mtime;
      const conflictMtime = conflict.timestamp;

      if (conflictMtime > originalMtime) {
        // Conflict is newer - keep conflict
        return {
          keepOriginal: false,
          keepConflict: true,
          action: "kept-conflict",
        };
      } else {
        // Original is newer or same - keep original
        return {
          keepOriginal: true,
          keepConflict: false,
          action: "kept-original",
        };
      }
    } catch {
      // Original doesn't exist - keep conflict
      return {
        keepOriginal: false,
        keepConflict: true,
        action: "kept-conflict",
      };
    }
  }

  /**
   * Log a conflict resolution
   */
  private async logResolution(
    conflict: ConflictFile,
    resolution: ConflictResolution
  ): Promise<void> {
    const entry: ConflictLogEntry = {
      originalPath: conflict.originalPath,
      conflictPath: conflict.conflictPath,
      deviceId: conflict.deviceId,
      conflictTimestamp: conflict.timestamp,
      resolvedAt: new Date(),
      resolution: resolution.action,
      strategy: this.strategy,
    };

    // Load existing log
    let log: ConflictLogEntry[] = [];
    try {
      const content = await fs.readFile(this.logPath, "utf-8");
      log = JSON.parse(content);
    } catch {
      // No existing log
    }

    // Append entry
    log.push(entry);

    // Keep only last 100 entries
    if (log.length > 100) {
      log = log.slice(-100);
    }

    // Save log
    await fs.writeFile(this.logPath, JSON.stringify(log, null, 2), "utf-8");
  }

  /**
   * Get conflict log
   */
  async getConflictLog(): Promise<ConflictLogEntry[]> {
    try {
      const content = await fs.readFile(this.logPath, "utf-8");
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  /**
   * Clear conflict log
   */
  async clearConflictLog(): Promise<void> {
    try {
      await fs.unlink(this.logPath);
    } catch {
      // File might not exist
    }
  }

  /**
   * Get summary of current conflicts
   */
  async getSummary(): Promise<{
    totalConflicts: number;
    byDevice: Record<string, number>;
    byExtension: Record<string, number>;
    oldestConflict?: Date;
    newestConflict?: Date;
  }> {
    const conflicts = await this.scan();

    const byDevice: Record<string, number> = {};
    const byExtension: Record<string, number> = {};
    let oldestConflict: Date | undefined;
    let newestConflict: Date | undefined;

    for (const conflict of conflicts) {
      // By device
      byDevice[conflict.deviceId] =
        (byDevice[conflict.deviceId] || 0) + 1;

      // By extension
      const ext = conflict.extension || "(no extension)";
      byExtension[ext] = (byExtension[ext] || 0) + 1;

      // Timestamps
      if (!oldestConflict || conflict.timestamp < oldestConflict) {
        oldestConflict = conflict.timestamp;
      }
      if (!newestConflict || conflict.timestamp > newestConflict) {
        newestConflict = conflict.timestamp;
      }
    }

    return {
      totalConflicts: conflicts.length,
      byDevice,
      byExtension,
      oldestConflict,
      newestConflict,
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a conflict detector
 */
export function createConflictDetector(
  dbPath: string,
  options?: ConflictDetectorOptions
): ConflictDetector {
  return new ConflictDetector(dbPath, options);
}
