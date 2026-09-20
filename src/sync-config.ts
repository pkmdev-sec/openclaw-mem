/**
 * Sync Configuration Module
 *
 * Configuration and utilities for Syncthing-based synchronization.
 * Handles platform-specific paths, folder ID generation, and config management.
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Sync configuration
 */
export interface SyncConfig {
  /** Path to the memory database */
  dbPath: string;

  /** Syncthing folder ID (auto-generated or custom) */
  folderId: string;

  /** Label for the sync folder */
  folderLabel: string;

  /** Enable versioning in Syncthing (recommended) */
  versioning: boolean;

  /** Number of versions to keep */
  versionCount: number;

  /** Ignore patterns for sync */
  ignorePatterns: string[];

  /** Creation timestamp */
  createdAt: number;

  /** Last modified timestamp */
  updatedAt: number;
}

/**
 * Platform type
 */
export type Platform = "darwin" | "linux" | "win32";

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Default database paths by platform
 */
const DEFAULT_DB_PATHS: Record<Platform, string> = {
  darwin: "~/Library/Application Support/openclaw-memory",
  linux: "~/.local/share/openclaw-memory",
  win32: "%APPDATA%/openclaw-memory",
};

/**
 * Default backup paths by platform
 */
const DEFAULT_BACKUP_PATHS: Record<Platform, string> = {
  darwin: "~/Library/Application Support/openclaw-memory-backups",
  linux: "~/.local/share/openclaw-memory-backups",
  win32: "%APPDATA%/openclaw-memory-backups",
};

/**
 * Config file name
 */
const CONFIG_FILE_NAME = "sync-config.json";

/**
 * Default ignore patterns for Syncthing
 */
const DEFAULT_IGNORE_PATTERNS = [
  // Lock files
  "*.lock",
  "*.tmp",
  ".~lock.*",

  // SQLite WAL files (if any)
  "*-wal",
  "*-shm",

  // Syncthing conflict files (handled separately)
  "*.sync-conflict-*",

  // System files
  ".DS_Store",
  "Thumbs.db",

  // Temporary files
  "*.swp",
  "*~",
];

// ============================================================================
// PATH UTILITIES
// ============================================================================

/**
 * Get the current platform
 */
export function getPlatform(): Platform {
  const platform = os.platform();
  if (platform === "darwin" || platform === "linux" || platform === "win32") {
    return platform;
  }
  // Default to linux for unknown platforms
  return "linux";
}

/**
 * Expand home directory and environment variables in path
 */
export function expandPath(inputPath: string): string {
  let expanded = inputPath;

  // Expand ~
  if (expanded.startsWith("~")) {
    expanded = path.join(os.homedir(), expanded.slice(1));
  }

  // Expand environment variables (Windows style)
  expanded = expanded.replace(/%([^%]+)%/g, (_, envVar) => {
    return process.env[envVar] || "";
  });

  // Expand environment variables (Unix style)
  expanded = expanded.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, envVar) => {
    return process.env[envVar] || "";
  });

  return path.normalize(expanded);
}

/**
 * Get default database path for current platform
 */
export function getDefaultDbPath(): string {
  const platform = getPlatform();
  return expandPath(DEFAULT_DB_PATHS[platform]);
}

/**
 * Get default backup path for current platform
 */
export function getDefaultBackupPath(): string {
  const platform = getPlatform();
  return expandPath(DEFAULT_BACKUP_PATHS[platform]);
}

/**
 * Get config file path
 */
export function getConfigFilePath(dbPath?: string): string {
  const basePath = dbPath || getDefaultDbPath();
  return path.join(expandPath(basePath), CONFIG_FILE_NAME);
}

// ============================================================================
// FOLDER ID GENERATION
// ============================================================================

/**
 * Generate a Syncthing-compatible folder ID
 *
 * Format: openclaw-memory-[8 random chars]
 * Syncthing folder IDs must be alphanumeric with hyphens
 */
export function generateFolderId(): string {
  const randomPart = crypto.randomBytes(4).toString("hex");
  return `openclaw-memory-${randomPart}`;
}

/**
 * Validate a folder ID
 */
export function isValidFolderId(folderId: string): boolean {
  // Syncthing folder IDs: alphanumeric, hyphens, underscores
  // Max 64 characters
  const pattern = /^[a-zA-Z0-9_-]{1,64}$/;
  return pattern.test(folderId);
}

// ============================================================================
// CONFIG MANAGEMENT
// ============================================================================

/**
 * Get default sync configuration
 */
export function getDefaultSyncConfig(dbPath?: string): SyncConfig {
  const resolvedPath = dbPath || getDefaultDbPath();
  const now = Date.now();

  return {
    dbPath: resolvedPath,
    folderId: generateFolderId(),
    folderLabel: "OpenClaw Memory",
    versioning: true,
    versionCount: 5,
    ignorePatterns: [...DEFAULT_IGNORE_PATTERNS],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Save sync configuration to file
 *
 * The config file is saved inside the config's dbPath directory.
 */
export async function saveSyncConfig(config: SyncConfig): Promise<void> {
  const filePath = getConfigFilePath(config.dbPath);

  // Ensure directory exists
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  // Update timestamp
  const updatedConfig = {
    ...config,
    updatedAt: Date.now(),
  };

  // Write config
  await fs.writeFile(filePath, JSON.stringify(updatedConfig, null, 2), "utf-8");
}

/**
 * Load sync configuration from file
 *
 * @param dbPath Database path (config file is inside this directory)
 */
export async function loadSyncConfig(
  dbPath?: string
): Promise<SyncConfig | null> {
  const filePath = getConfigFilePath(dbPath);

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const config = JSON.parse(content) as SyncConfig;

    // Validate loaded config
    if (!config.dbPath || !config.folderId) {
      console.warn("Invalid sync config loaded, missing required fields");
      return null;
    }

    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // File doesn't exist - not an error
      return null;
    }
    throw error;
  }
}

/**
 * Check if sync config exists
 *
 * @param dbPath Database path (config file is inside this directory)
 */
export async function syncConfigExists(dbPath?: string): Promise<boolean> {
  const filePath = getConfigFilePath(dbPath);

  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Initialize sync config (load existing or create new)
 *
 * @param dbPath Database path
 */
export async function initSyncConfig(dbPath?: string): Promise<SyncConfig> {
  // Try to load existing
  const existing = await loadSyncConfig(dbPath);
  if (existing) {
    return existing;
  }

  // Create new config
  const config = getDefaultSyncConfig(dbPath);
  await saveSyncConfig(config);

  return config;
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate sync configuration
 */
export function validateSyncConfig(config: SyncConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!config.dbPath) {
    errors.push("dbPath is required");
  }

  if (!config.folderId) {
    errors.push("folderId is required");
  } else if (!isValidFolderId(config.folderId)) {
    errors.push("folderId contains invalid characters");
  }

  if (!config.folderLabel) {
    errors.push("folderLabel is required");
  }

  if (config.versionCount < 0) {
    errors.push("versionCount must be non-negative");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
