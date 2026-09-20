/**
 * Sync Manager Module
 *
 * High-level sync management API for cross-device synchronization.
 * Orchestrates configuration, status monitoring, and conflict resolution.
 */

import {
  SyncConfig,
  getDefaultDbPath,
  initSyncConfig,
  loadSyncConfig,
  saveSyncConfig,
} from "./sync-config.js";
import {
  SyncStatus,
  getSyncStatus,
  generateSetupInstructions,
  writeStIgnore,
} from "./syncthing-helper.js";
import {
  ConflictDetector,
  ConflictFile,
  ResolutionStrategy,
} from "./conflict-detector.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for sync manager
 */
export interface SyncManagerOptions {
  /** Database path (default: platform-specific) */
  dbPath?: string;

  /** Sync configuration (loaded from file if not provided) */
  config?: SyncConfig;

  /** Conflict resolution strategy (default: last-write-wins) */
  conflictStrategy?: ResolutionStrategy;

  /** Enable auto-conflict resolution (default: true) */
  autoResolve?: boolean;

  /** Status check interval in ms (default: 30000) */
  statusInterval?: number;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Sync information for user display
 */
export interface SyncInfo {
  /** Whether sync is enabled/configured */
  enabled: boolean;

  /** Current sync status */
  status: SyncStatus;

  /** Number of pending conflicts */
  pendingConflicts: number;

  /** Last successful sync time */
  lastSync?: Date;

  /** Sync folder path */
  folderPath: string;

  /** Folder ID for Syncthing */
  folderId: string;

  /** Whether .stignore exists */
  stIgnoreExists: boolean;
}

/**
 * Event callback for status updates
 */
export type SyncStatusCallback = (info: SyncInfo) => void;

// ============================================================================
// SYNC MANAGER
// ============================================================================

/**
 * Sync Manager class
 *
 * Manages cross-device sync via Syncthing with conflict resolution.
 */
export class SyncManager {
  private config: SyncConfig | null = null;
  private conflictDetector: ConflictDetector | null = null;
  private options: Required<SyncManagerOptions>;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private initialized = false;

  constructor(options: SyncManagerOptions = {}) {
    this.options = {
      dbPath: options.dbPath ?? getDefaultDbPath(),
      config: options.config ?? (null as unknown as SyncConfig),
      conflictStrategy: options.conflictStrategy ?? "last-write-wins",
      autoResolve: options.autoResolve ?? true,
      statusInterval: options.statusInterval ?? 30000,
      debug: options.debug ?? false,
    };
  }

  /**
   * Initialize sync setup
   *
   * Creates config, .stignore, and prepares for sync.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.log("Initializing sync manager...");

    // Load or create config
    if (this.options.config) {
      this.config = this.options.config;
    } else {
      // Try to load existing config
      const existing = await loadSyncConfig(this.options.dbPath);
      if (existing) {
        this.config = existing;
        this.log("Loaded existing sync config");
      } else {
        // Create new config
        this.config = await initSyncConfig(this.options.dbPath);
        await saveSyncConfig(this.config);
        this.log("Created new sync config");
      }
    }

    // Ensure .stignore exists
    await writeStIgnore(this.config.dbPath, this.config);
    this.log("Ensured .stignore exists");

    // Create conflict detector
    this.conflictDetector = new ConflictDetector(this.config.dbPath, {
      strategy: this.options.conflictStrategy,
      autoResolve: this.options.autoResolve,
    });

    this.initialized = true;
    this.log("Sync manager initialized");
  }

  /**
   * Get current sync information
   */
  async getInfo(): Promise<SyncInfo> {
    await this.ensureInitialized();

    const status = await getSyncStatus(this.config!);
    const conflicts = await this.conflictDetector!.scan();

    // Check if .stignore exists
    let stIgnoreExists = false;
    try {
      const fs = await import("fs/promises");
      const path = await import("path");
      await fs.access(path.join(this.config!.dbPath, ".stignore"));
      stIgnoreExists = true;
    } catch {
      // File doesn't exist
    }

    return {
      enabled: true,
      status,
      pendingConflicts: conflicts.length,
      lastSync: status.lastSync,
      folderPath: this.config!.dbPath,
      folderId: this.config!.folderId,
      stIgnoreExists,
    };
  }

  /**
   * Check for and resolve conflicts
   *
   * @returns Number of conflicts resolved
   */
  async checkConflicts(): Promise<number> {
    await this.ensureInitialized();

    const conflicts = await this.conflictDetector!.scan();
    this.log(`Found ${conflicts.length} conflicts`);

    if (conflicts.length === 0) {
      return 0;
    }

    if (this.options.autoResolve) {
      const resolved = await this.conflictDetector!.resolveAll();
      this.log(`Resolved ${resolved} conflicts`);
      return resolved;
    }

    return 0;
  }

  /**
   * Get list of pending conflicts
   */
  async getPendingConflicts(): Promise<ConflictFile[]> {
    await this.ensureInitialized();
    return this.conflictDetector!.scan();
  }

  /**
   * Get conflict history log
   */
  async getConflictLog() {
    await this.ensureInitialized();
    return this.conflictDetector!.getConflictLog();
  }

  /**
   * Get conflict summary
   */
  async getConflictSummary() {
    await this.ensureInitialized();
    return this.conflictDetector!.getSummary();
  }

  /**
   * Generate setup instructions for user
   */
  getSetupInstructions(): string {
    if (!this.config) {
      // Generate with default config for preview
      const defaultConfig: SyncConfig = {
        dbPath: this.options.dbPath,
        folderId: "openclaw-memory-preview",
        folderLabel: "OpenClaw Memory",
        versioning: true,
        versionCount: 5,
        ignorePatterns: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      return generateSetupInstructions(defaultConfig);
    }
    return generateSetupInstructions(this.config);
  }

  /**
   * Get the current config
   */
  getConfig(): SyncConfig | null {
    return this.config;
  }

  /**
   * Update sync configuration
   */
  async updateConfig(updates: Partial<SyncConfig>): Promise<void> {
    await this.ensureInitialized();

    this.config = {
      ...this.config!,
      ...updates,
      updatedAt: Date.now(),
    };

    await saveSyncConfig(this.config);
    this.log("Config updated");
  }

  /**
   * Start status monitoring
   *
   * @param callback Function called with sync info on each update
   */
  startMonitoring(callback: SyncStatusCallback): void {
    if (this.monitoringInterval) {
      this.stopMonitoring();
    }

    this.log(`Starting monitoring (interval: ${this.options.statusInterval}ms)`);

    // Run immediately
    this.runMonitoringCheck(callback);

    // Then run at interval
    this.monitoringInterval = setInterval(() => {
      this.runMonitoringCheck(callback);
    }, this.options.statusInterval);
  }

  /**
   * Stop status monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      this.log("Monitoring stopped");
    }
  }

  /**
   * Force a sync check now
   */
  async forceCheck(): Promise<SyncInfo> {
    await this.ensureInitialized();

    // Resolve any conflicts
    await this.checkConflicts();

    // Return current info
    return this.getInfo();
  }

  /**
   * Clean up resources
   */
  async shutdown(): Promise<void> {
    this.stopMonitoring();
    this.initialized = false;
    this.config = null;
    this.conflictDetector = null;
    this.log("Sync manager shut down");
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private async runMonitoringCheck(callback: SyncStatusCallback): Promise<void> {
    try {
      // Check for conflicts if auto-resolve is enabled
      if (this.options.autoResolve) {
        await this.checkConflicts();
      }

      // Get current info
      const info = await this.getInfo();
      callback(info);
    } catch (error) {
      this.log(`Monitoring check failed: ${error}`);
    }
  }

  private log(message: string): void {
    if (this.options.debug) {
      console.log(`[SyncManager] ${message}`);
    }
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let defaultSyncManager: SyncManager | null = null;

/**
 * Initialize the default sync manager
 */
export function initSyncManager(options?: SyncManagerOptions): void {
  defaultSyncManager = new SyncManager(options);
}

/**
 * Get the default sync manager
 *
 * Auto-initializes if not already initialized.
 */
export function getSyncManager(): SyncManager {
  if (!defaultSyncManager) {
    defaultSyncManager = new SyncManager();
  }
  return defaultSyncManager;
}

/**
 * Create a new sync manager instance
 */
export function createSyncManager(options?: SyncManagerOptions): SyncManager {
  return new SyncManager(options);
}
