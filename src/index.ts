/**
 * OpenClaw Smart Memory System
 *
 * Main entry point - exports all public APIs.
 */

// ============================================================================
// CORE - Memory System
// ============================================================================

export {
  initMemorySystem,
  getMemorySystem,
  resetMemorySystem,
  type MemorySystem,
  type MemorySystemStatus,
  type RecallOptions,
  type RecallResult,
} from "./memory-system.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

export {
  loadConfig,
  saveConfig,
  mergeConfig,
  getDefaultConfig,
  validateConfig,
  type MemorySystemConfig,
  type BackupConfig,
  type RetrievalConfig,
} from "./memory-config.js";

// ============================================================================
// EVENTS
// ============================================================================

export {
  getMemoryEventEmitter,
  createTimer,
  type MemoryEventEmitter,
  type MemoryEventType,
  type MemoryEvent,
} from "./memory-events.js";

// ============================================================================
// HOOKS
// ============================================================================

export {
  createContextHook,
  getContextHook,
  initContextHook,
  createExtractionHook,
  getExtractionHook,
  initExtractionHook,
  type ContextHook,
  type ContextHookOptions,
  type ContextHookResult,
  type ContextHookMetrics,
  type ExtractionHook,
  type ExtractionHookOptions,
  type ExtractionHookResult,
  type ConversationInput,
  type QueueStatus,
  type ExtractionHookMetrics,
} from "./hooks/index.js";

// ============================================================================
// TYPES - Memory Schema
// ============================================================================

export {
  type Memory,
  type CreateMemoryInput,
  type UpdateMemoryInput,
  type MemoryCategory,
  validateMemory,
  validateCreateInput,
  isValidCategory,
} from "./schema.js";

// ============================================================================
// BACKUP & RESTORE
// ============================================================================

export {
  createBackup,
  listBackups,
  pruneBackups,
  verifyBackup,
  getBackupInfo,
  type BackupOptions,
  type BackupResult,
  type BackupInfo,
} from "./backup.js";

export {
  restoreBackup,
  type RestoreOptions,
  type RestoreResult,
} from "./restore.js";

// ============================================================================
// SYNC
// ============================================================================

export {
  createSyncManager,
  getSyncManager,
  type SyncManager,
  type SyncManagerOptions,
  type SyncInfo,
} from "./sync-manager.js";

// ============================================================================
// SEARCH
// ============================================================================

export {
  searchByText,
  searchByVector,
  hybridSearch,
  type SearchResult,
  type SearchOptions,
  type SearchOperationResult,
} from "./search.js";
