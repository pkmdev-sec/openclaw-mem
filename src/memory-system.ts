/**
 * Memory System
 *
 * Unified API for the OpenClaw Smart Memory System.
 * Orchestrates all components: storage, extraction, retrieval, sync, and backup.
 */

import { Memory, CreateMemoryInput, UpdateMemoryInput } from "./schema.js";
import { getConnectionManager } from "./connection.js";
import { createMemory, getMemory, updateMemory, deleteMemory, countMemories } from "./crud.js";
import { searchByText, SearchResult } from "./search.js";
import { initAutoExtraction, getAutoExtraction, AutoExtractionService } from "./auto-extraction.js";
import { createOllamaProvider } from "./llm-provider.js";
import { getContext, getContextForMessage, ContextResult, ContextOptions } from "./memory-context.js";
import { SyncManager, createSyncManager, SyncInfo } from "./sync-manager.js";
import { createBackup, listBackups, pruneBackups, BackupInfo, BackupResult } from "./backup.js";
import { restoreBackup, RestoreResult } from "./restore.js";
import { MemorySystemConfig, loadConfig, saveConfig, mergeConfig, getDefaultConfig } from "./memory-config.js";
import { getMemoryEventEmitter, createTimer, MemoryEventType } from "./memory-events.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * System status information
 */
export interface MemorySystemStatus {
  /** Whether system is initialized */
  initialized: boolean;

  /** Database path */
  dbPath: string;

  /** Total memory count */
  memoryCount: number;

  /** Sync status (null if sync disabled) */
  syncStatus: SyncInfo | null;

  /** Pending extraction queue size */
  extractionQueue: number;

  /** Last backup time (null if no backups) */
  lastBackup: Date | null;

  /** System uptime in ms */
  uptime: number;

  /** Configuration summary */
  config: {
    syncEnabled: boolean;
    autoExtractionEnabled: boolean;
    extractionModel: string;
    embeddingModel: string;
  };
}

/**
 * Recall options
 */
export interface RecallOptions {
  /** Maximum memories to return */
  limit?: number;

  /** Project context for ranking */
  project?: string;

  /** Minimum relevance score */
  minScore?: number;

  /** Maximum tokens for formatted context */
  maxTokens?: number;

  /** Output format */
  format?: "markdown" | "xml" | "plain" | "compact";

  /** Include raw memories in result */
  includeMemories?: boolean;
}

/**
 * Recall result
 */
export interface RecallResult {
  /** Formatted context string */
  context: string;

  /** Number of memories found */
  memoryCount: number;

  /** Estimated token count */
  tokenCount: number;

  /** Query latency in ms */
  latency: number;

  /** Whether result was cached */
  cached: boolean;

  /** Raw memories (if includeMemories=true) */
  memories?: Memory[];
}

// ============================================================================
// MEMORY SYSTEM CLASS
// ============================================================================

/**
 * Memory System
 *
 * Main entry point for all memory operations.
 */
export class MemorySystem {
  private config: MemorySystemConfig;
  private initialized = false;
  private startTime: Date | null = null;
  private syncManager: SyncManager | null = null;
  private extractionService: AutoExtractionService | null = null;
  private emitter = getMemoryEventEmitter();

  constructor(config?: MemorySystemConfig) {
    this.config = config ? mergeConfig(config) : getDefaultConfig();
  }

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  /**
   * Initialize all components
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const timer = createTimer();
    this.log("info", "Initializing memory system...");

    try {
      // Initialize database connection
      const connManager = getConnectionManager();
      await connManager.connect({ dbPath: this.config.dbPath! });

      // Initialize table with a dummy embedding to establish schema
      const dummyEmbedding = new Array(768).fill(0);
      await connManager.initializeTable("memories", dummyEmbedding);

      // Initialize sync manager (if enabled)
      if (this.config.enableSync) {
        this.syncManager = createSyncManager({
          dbPath: this.config.dbPath,
          autoResolve: true,
        });
        await this.syncManager.initialize();
        this.log("debug", "Sync manager initialized");
      }

      // Initialize extraction service (if enabled)
      if (this.config.enableAutoExtraction) {
        try {
          // Try to get existing service first
          this.extractionService = getAutoExtraction();
        } catch {
          // Service not initialized yet, create it with default provider
          const provider = createOllamaProvider({
            model: this.config.extractionModel || "qwen2.5:7b",
          });
          this.extractionService = initAutoExtraction({
            provider,
            autoStart: true,
          });
        }
        this.log("debug", "Extraction service initialized");
      }

      this.initialized = true;
      this.startTime = new Date();

      this.emitter.emitEvent("system:initialized", {
        dbPath: this.config.dbPath,
        syncEnabled: this.config.enableSync,
        autoExtractionEnabled: this.config.enableAutoExtraction,
      }, { duration: timer() });

      this.log("info", `Memory system initialized in ${timer()}ms`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.emitter.emitEvent("system:error", { phase: "initialization" }, { error: errorMsg });
      throw error;
    }
  }

  /**
   * Shutdown all components
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    const timer = createTimer();
    this.log("info", "Shutting down memory system...");

    try {
      // Shutdown sync manager
      if (this.syncManager) {
        await this.syncManager.shutdown();
        this.syncManager = null;
      }

      // Shutdown database connection
      const connManager = getConnectionManager();
      await connManager.shutdown();

      this.initialized = false;
      this.startTime = null;

      this.emitter.emitEvent("system:shutdown", {}, { duration: timer() });
      this.log("info", `Memory system shut down in ${timer()}ms`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.emitter.emitEvent("system:error", { phase: "shutdown" }, { error: errorMsg });
      throw error;
    }
  }

  /**
   * Get system status
   */
  async getStatus(): Promise<MemorySystemStatus> {
    await this.ensureInitialized();

    const memoryCountResult = await countMemories();
    const memoryCount = memoryCountResult.data;
    const syncStatus = this.syncManager ? await this.syncManager.getInfo() : null;
    const backups = await listBackups(this.config.backup?.path);
    const lastBackup = backups.length > 0 ? backups[0].createdAt : null;

    // Get extraction queue size (if available)
    let extractionQueue = 0;
    if (this.extractionService) {
      const queueStatus = this.extractionService.getQueueStatus();
      extractionQueue = queueStatus.pending + queueStatus.processing;
    }

    return {
      initialized: this.initialized,
      dbPath: this.config.dbPath!,
      memoryCount,
      syncStatus,
      extractionQueue,
      lastBackup,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      config: {
        syncEnabled: this.config.enableSync ?? true,
        autoExtractionEnabled: this.config.enableAutoExtraction ?? true,
        extractionModel: this.config.extractionModel ?? "qwen2.5:7b",
        embeddingModel: this.config.embeddingModel ?? "nomic-embed-text",
      },
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): MemorySystemConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  async updateConfig(updates: Partial<MemorySystemConfig>): Promise<void> {
    this.config = mergeConfig({ ...this.config, ...updates });
    await saveConfig(this.config);
  }

  // ==========================================================================
  // HIGH-LEVEL OPERATIONS
  // ==========================================================================

  /**
   * Store a conversation (triggers extraction)
   *
   * @param conversation The conversation text to extract memories from
   * @param project Optional project context
   * @returns Array of extracted memory IDs
   */
  async storeConversation(conversation: string, project?: string): Promise<string[]> {
    await this.ensureInitialized();

    if (!this.config.enableAutoExtraction || !this.extractionService) {
      this.log("warn", "Auto-extraction is disabled, skipping storeConversation");
      return [];
    }

    const timer = createTimer();
    this.emitter.emitEvent("extraction:queued", { project, length: conversation.length });

    try {
      // Queue for extraction
      const queueId = await this.extractionService.queueConversation(conversation, project);
      this.log("debug", `Queued conversation for extraction: ${queueId}`);

      // For now, return empty array - extraction happens in background
      // The extraction service will emit events when complete
      return [];
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.emitter.emitEvent("extraction:failed", { project }, { duration: timer(), error: errorMsg });
      throw error;
    }
  }

  /**
   * Recall relevant memories for a query
   *
   * @param query The query to search for
   * @param options Recall options
   * @returns Recall result with formatted context
   */
  async recall(query: string, options: RecallOptions = {}): Promise<RecallResult> {
    await this.ensureInitialized();

    const timer = createTimer();
    this.emitter.emitEvent("recall:started", { query: query.slice(0, 100) });

    try {
      const contextOptions: ContextOptions = {
        maxTokens: options.maxTokens ?? this.config.retrieval?.maxTokens ?? 2000,
        format: options.format ?? this.config.retrieval?.defaultFormat ?? "markdown",
        minScore: options.minScore ?? this.config.retrieval?.minScore ?? 0.5,
        limit: options.limit ?? this.config.retrieval?.maxResults ?? 10,
        project: options.project,
      };

      const result = await getContextForMessage(query, contextOptions);

      const recallResult: RecallResult = {
        context: result.context,
        memoryCount: result.memories?.length ?? 0,
        tokenCount: result.tokensUsed ?? 0,
        latency: timer(),
        cached: result.cached,
      };

      if (options.includeMemories && result.memories) {
        recallResult.memories = result.memories;
      }

      const eventType: MemoryEventType = result.cached ? "recall:cached" : "recall:completed";
      this.emitter.emitEvent(eventType, {
        memoryCount: recallResult.memoryCount,
        tokenCount: recallResult.tokenCount,
        cached: result.cached,
      }, { duration: timer() });

      return recallResult;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.emitter.emitEvent("system:error", { operation: "recall" }, { duration: timer(), error: errorMsg });

      // Return empty result on error (graceful degradation)
      return {
        context: "",
        memoryCount: 0,
        tokenCount: 0,
        latency: timer(),
        cached: false,
      };
    }
  }

  // ==========================================================================
  // MEMORY OPERATIONS
  // ==========================================================================

  /**
   * Direct memory operations
   */
  memories = {
    /**
     * Create a new memory
     */
    create: async (input: CreateMemoryInput): Promise<Memory> => {
      await this.ensureInitialized();
      const timer = createTimer();

      const result = await createMemory(input);
      const memory = result.data;
      this.emitter.emitEvent("memory:created", { id: memory.id, category: memory.category }, { duration: timer() });

      return memory;
    },

    /**
     * Get a memory by ID
     */
    get: async (id: string): Promise<Memory | null> => {
      await this.ensureInitialized();
      const result = await getMemory(id);
      return result.data;
    },

    /**
     * Search memories
     */
    search: async (query: string, limit: number = 10): Promise<Memory[]> => {
      await this.ensureInitialized();
      const timer = createTimer();

      const results = await searchByText(query, { limit });
      this.emitter.emitEvent("memory:searched", { query: query.slice(0, 100), resultCount: results.results.length }, { duration: timer() });

      return results.results.map((r) => r.memory);
    },

    /**
     * Update a memory
     */
    update: async (id: string, updates: Partial<UpdateMemoryInput>): Promise<Memory> => {
      await this.ensureInitialized();
      const timer = createTimer();

      const result = await updateMemory(id, updates);
      const memory = result.data;
      this.emitter.emitEvent("memory:updated", { id }, { duration: timer() });

      return memory;
    },

    /**
     * Delete a memory
     */
    delete: async (id: string): Promise<boolean> => {
      await this.ensureInitialized();
      const timer = createTimer();

      const result = await deleteMemory(id);
      if (result.data) {
        this.emitter.emitEvent("memory:deleted", { id }, { duration: timer() });
      }

      return result.data;
    },

    /**
     * Count total memories
     */
    count: async (): Promise<number> => {
      await this.ensureInitialized();
      const result = await countMemories();
      return result.data;
    },
  };

  // ==========================================================================
  // SYNC OPERATIONS
  // ==========================================================================

  /**
   * Sync operations
   */
  sync = {
    /**
     * Get sync status
     */
    getStatus: async (): Promise<SyncInfo | null> => {
      if (!this.syncManager) {
        return null;
      }
      return this.syncManager.getInfo();
    },

    /**
     * Check and resolve conflicts
     */
    checkConflicts: async (): Promise<number> => {
      if (!this.syncManager) {
        return 0;
      }
      const timer = createTimer();
      const resolved = await this.syncManager.checkConflicts();

      if (resolved > 0) {
        this.emitter.emitEvent("sync:conflict", { resolved }, { duration: timer() });
      }

      return resolved;
    },

    /**
     * Get setup instructions
     */
    getSetupInstructions: (): string => {
      if (!this.syncManager) {
        return "Sync is disabled. Enable it in configuration.";
      }
      return this.syncManager.getSetupInstructions();
    },
  };

  // ==========================================================================
  // BACKUP OPERATIONS
  // ==========================================================================

  /**
   * Backup operations
   */
  backup = {
    /**
     * Create a backup
     */
    create: async (name?: string): Promise<BackupResult> => {
      await this.ensureInitialized();
      const timer = createTimer();

      const result = await createBackup(this.config.dbPath!, {
        destPath: this.config.backup?.path,
        name,
      });

      if (result.success) {
        this.emitter.emitEvent("backup:created", {
          path: result.backup?.path,
          size: result.backup?.size,
        }, { duration: timer() });
      } else {
        this.emitter.emitEvent("backup:failed", {}, { duration: timer(), error: result.error });
      }

      return result;
    },

    /**
     * Restore from backup
     */
    restore: async (path: string): Promise<RestoreResult> => {
      const timer = createTimer();

      const result = await restoreBackup(path, {
        targetPath: this.config.dbPath,
        existingAction: "backup",
      });

      if (result.success) {
        this.emitter.emitEvent("backup:restored", {
          path,
          restoredPath: result.restoredPath,
        }, { duration: timer() });

        // Re-initialize after restore
        this.initialized = false;
        await this.initialize();
      }

      return result;
    },

    /**
     * List available backups
     */
    list: async (): Promise<BackupInfo[]> => {
      return listBackups(this.config.backup?.path);
    },

    /**
     * Prune old backups
     */
    prune: async (keepCount?: number): Promise<number> => {
      const count = keepCount ?? this.config.backup?.keepCount ?? 5;
      return pruneBackups(count, this.config.backup?.path);
    },
  };

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private log(level: "debug" | "info" | "warn" | "error", message: string): void {
    const configLevel = this.config.logLevel ?? "info";
    const levels = ["debug", "info", "warn", "error"];
    const configLevelIndex = levels.indexOf(configLevel);
    const messageLevelIndex = levels.indexOf(level);

    if (messageLevelIndex >= configLevelIndex) {
      const prefix = `[MemorySystem]`;
      switch (level) {
        case "debug":
          console.debug(prefix, message);
          break;
        case "info":
          console.log(prefix, message);
          break;
        case "warn":
          console.warn(prefix, message);
          break;
        case "error":
          console.error(prefix, message);
          break;
      }
    }
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let systemInstance: MemorySystem | null = null;

/**
 * Initialize the memory system singleton
 */
export async function initMemorySystem(config?: MemorySystemConfig): Promise<MemorySystem> {
  if (systemInstance) {
    return systemInstance;
  }

  // Load config from file if not provided
  const finalConfig = config ?? await loadConfig();
  systemInstance = new MemorySystem(finalConfig);
  await systemInstance.initialize();

  return systemInstance;
}

/**
 * Get the memory system singleton
 *
 * Note: Prefer using initMemorySystem() to ensure initialization.
 */
export function getMemorySystem(): MemorySystem {
  if (!systemInstance) {
    systemInstance = new MemorySystem();
  }
  return systemInstance;
}

/**
 * Reset the memory system (for testing)
 */
export async function resetMemorySystem(): Promise<void> {
  if (systemInstance) {
    await systemInstance.shutdown();
    systemInstance = null;
  }
}
