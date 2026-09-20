/**
 * Memory Configuration Manager
 *
 * Handles loading, saving, and validating memory system configuration.
 * Configuration is persisted to a JSON file for cross-session settings.
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Memory system configuration
 */
export interface MemorySystemConfig {
  /** Database path */
  dbPath?: string;

  /** Enable sync (default: true) */
  enableSync?: boolean;

  /** Enable auto-extraction (default: true) */
  enableAutoExtraction?: boolean;

  /** Extraction model (default: qwen2.5:7b) */
  extractionModel?: string;

  /** Embedding model (default: nomic-embed-text) */
  embeddingModel?: string;

  /** Backup settings */
  backup?: BackupConfig;

  /** Retrieval settings */
  retrieval?: RetrievalConfig;

  /** Logging level */
  logLevel?: "debug" | "info" | "warn" | "error";
}

/**
 * Backup configuration
 */
export interface BackupConfig {
  /** Enable auto-backup (default: false) */
  autoBackup?: boolean;

  /** Auto-backup interval in hours (default: 24) */
  autoBackupInterval?: number;

  /** Number of backups to keep (default: 5) */
  keepCount?: number;

  /** Backup directory path */
  path?: string;
}

/**
 * Retrieval configuration
 */
export interface RetrievalConfig {
  /** Max memories to return (default: 10) */
  maxResults?: number;

  /** Minimum score threshold (default: 0.5) */
  minScore?: number;

  /** Max tokens for context (default: 2000) */
  maxTokens?: number;

  /** Default context format */
  defaultFormat?: "markdown" | "xml" | "plain" | "compact";
}

/**
 * Persisted config with metadata
 */
export interface PersistedConfig extends MemorySystemConfig {
  /** Config version for migrations */
  version: string;

  /** Last modified timestamp */
  updatedAt: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const CONFIG_VERSION = "1.0";
const CONFIG_DIR_NAME = ".openclaw-memory";
const CONFIG_FILE_NAME = "config.json";

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

/**
 * Get default configuration
 */
export function getDefaultConfig(): MemorySystemConfig {
  return {
    dbPath: getDefaultDbPath(),
    enableSync: true,
    enableAutoExtraction: true,
    extractionModel: "qwen2.5:7b",
    embeddingModel: "nomic-embed-text",
    backup: {
      autoBackup: false,
      autoBackupInterval: 24,
      keepCount: 5,
      path: getDefaultBackupPath(),
    },
    retrieval: {
      maxResults: 10,
      minScore: 0.5,
      maxTokens: 2000,
      defaultFormat: "markdown",
    },
    logLevel: "info",
  };
}

/**
 * Get default database path
 */
function getDefaultDbPath(): string {
  const platform = os.platform();
  const homeDir = os.homedir();

  switch (platform) {
    case "darwin":
      return path.join(homeDir, "Library", "Application Support", "openclaw-memory");
    case "win32":
      return path.join(process.env.APPDATA || homeDir, "openclaw-memory");
    default:
      return path.join(homeDir, ".local", "share", "openclaw-memory");
  }
}

/**
 * Get default backup path
 */
function getDefaultBackupPath(): string {
  const platform = os.platform();
  const homeDir = os.homedir();

  switch (platform) {
    case "darwin":
      return path.join(homeDir, "Library", "Application Support", "openclaw-memory-backups");
    case "win32":
      return path.join(process.env.APPDATA || homeDir, "openclaw-memory-backups");
    default:
      return path.join(homeDir, ".local", "share", "openclaw-memory-backups");
  }
}

// ============================================================================
// PATH UTILITIES
// ============================================================================

/**
 * Get config directory path
 */
export function getConfigDir(): string {
  return path.join(os.homedir(), CONFIG_DIR_NAME);
}

/**
 * Get config file path
 */
export function getConfigPath(): string {
  return path.join(getConfigDir(), CONFIG_FILE_NAME);
}

// ============================================================================
// CONFIG OPERATIONS
// ============================================================================

/**
 * Load configuration from file
 *
 * Returns merged config with defaults for any missing values.
 */
export async function loadConfig(): Promise<MemorySystemConfig> {
  const configPath = getConfigPath();

  try {
    const content = await fs.readFile(configPath, "utf-8");
    const persisted = JSON.parse(content) as PersistedConfig;

    // Merge with defaults to fill in any missing values
    return mergeConfig(persisted);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // Config doesn't exist - return defaults
      return getDefaultConfig();
    }
    // Other error - log and return defaults
    console.warn("Failed to load config:", error);
    return getDefaultConfig();
  }
}

/**
 * Save configuration to file
 */
export async function saveConfig(config: MemorySystemConfig): Promise<void> {
  const configPath = getConfigPath();
  const configDir = getConfigDir();

  // Ensure directory exists
  await fs.mkdir(configDir, { recursive: true });

  // Create persisted config with metadata
  const persisted: PersistedConfig = {
    ...config,
    version: CONFIG_VERSION,
    updatedAt: new Date().toISOString(),
  };

  await fs.writeFile(configPath, JSON.stringify(persisted, null, 2), "utf-8");
}

/**
 * Check if config file exists
 */
export async function configExists(): Promise<boolean> {
  try {
    await fs.access(getConfigPath());
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete config file
 */
export async function deleteConfig(): Promise<void> {
  try {
    await fs.unlink(getConfigPath());
  } catch {
    // Ignore if doesn't exist
  }
}

// ============================================================================
// MERGE & VALIDATION
// ============================================================================

/**
 * Merge user config with defaults
 *
 * Deep merges nested objects (backup, retrieval).
 */
export function mergeConfig(userConfig: Partial<MemorySystemConfig>): MemorySystemConfig {
  const defaults = getDefaultConfig();

  return {
    ...defaults,
    ...userConfig,
    backup: {
      ...defaults.backup,
      ...userConfig.backup,
    },
    retrieval: {
      ...defaults.retrieval,
      ...userConfig.retrieval,
    },
  };
}

/**
 * Validate configuration
 */
export function validateConfig(config: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (typeof config !== "object" || config === null) {
    return { valid: false, errors: ["Config must be an object"] };
  }

  const c = config as Record<string, unknown>;

  // Validate logLevel
  if (c.logLevel !== undefined) {
    const validLevels = ["debug", "info", "warn", "error"];
    if (!validLevels.includes(c.logLevel as string)) {
      errors.push(`logLevel must be one of: ${validLevels.join(", ")}`);
    }
  }

  // Validate backup
  if (c.backup !== undefined && typeof c.backup === "object") {
    const backup = c.backup as Record<string, unknown>;

    if (backup.keepCount !== undefined && (typeof backup.keepCount !== "number" || backup.keepCount < 1)) {
      errors.push("backup.keepCount must be a positive number");
    }

    if (backup.autoBackupInterval !== undefined && (typeof backup.autoBackupInterval !== "number" || backup.autoBackupInterval < 1)) {
      errors.push("backup.autoBackupInterval must be a positive number");
    }
  }

  // Validate retrieval
  if (c.retrieval !== undefined && typeof c.retrieval === "object") {
    const retrieval = c.retrieval as Record<string, unknown>;

    if (retrieval.maxResults !== undefined && (typeof retrieval.maxResults !== "number" || retrieval.maxResults < 1)) {
      errors.push("retrieval.maxResults must be a positive number");
    }

    if (retrieval.minScore !== undefined && (typeof retrieval.minScore !== "number" || retrieval.minScore < 0 || retrieval.minScore > 1)) {
      errors.push("retrieval.minScore must be a number between 0 and 1");
    }

    if (retrieval.maxTokens !== undefined && (typeof retrieval.maxTokens !== "number" || retrieval.maxTokens < 100)) {
      errors.push("retrieval.maxTokens must be at least 100");
    }

    const validFormats = ["markdown", "xml", "plain", "compact"];
    if (retrieval.defaultFormat !== undefined && !validFormats.includes(retrieval.defaultFormat as string)) {
      errors.push(`retrieval.defaultFormat must be one of: ${validFormats.join(", ")}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Update a specific config value
 */
export async function updateConfigValue(key: string, value: unknown): Promise<void> {
  const config = await loadConfig();

  // Handle nested keys like "backup.keepCount"
  const keys = key.split(".");
  let target: Record<string, unknown> = config as unknown as Record<string, unknown>;

  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (typeof target[k] !== "object" || target[k] === null) {
      target[k] = {};
    }
    target = target[k] as Record<string, unknown>;
  }

  target[keys[keys.length - 1]] = value;

  // Validate before saving
  const validation = validateConfig(config);
  if (!validation.valid) {
    throw new Error(`Invalid config: ${validation.errors.join(", ")}`);
  }

  await saveConfig(config);
}
