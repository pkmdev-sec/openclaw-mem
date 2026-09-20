/**
 * Offline Operations Module
 *
 * Handles offline scenarios gracefully by queuing operations
 * when sync is unavailable and applying them when back online.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { expandPath } from "./sync-config.js";
import { getSyncStatus, isSyncthingRunning } from "./syncthing-helper.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Offline status information
 */
export interface OfflineStatus {
  /** Whether currently offline (Syncthing not running) */
  isOffline: boolean;

  /** Number of pending operations */
  pendingOps: number;

  /** Last online timestamp */
  lastOnline?: Date;

  /** Whether sync is pending */
  syncPending: boolean;

  /** Additional status info */
  info: Record<string, string>;
}

/**
 * Types of operations that can be queued
 */
export type OperationType = "create" | "update" | "delete";

/**
 * A queued offline operation
 */
export interface OfflineOperation {
  /** Unique operation ID */
  id: string;

  /** Operation type */
  type: OperationType;

  /** Memory ID this operation affects */
  memoryId: string;

  /** Timestamp when operation was queued */
  timestamp: Date;

  /** Operation data (for create/update) */
  data?: Record<string, unknown>;

  /** Number of retry attempts */
  retryCount: number;

  /** Last error if any */
  lastError?: string;
}

/**
 * Offline operations file structure
 */
interface OfflineOpsFile {
  /** File version */
  version: string;

  /** Last update timestamp */
  updatedAt: string;

  /** Last time we were online */
  lastOnline?: string;

  /** Pending operations */
  operations: OfflineOperation[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

const OFFLINE_OPS_FILE = ".offline-ops.json";
const FILE_VERSION = "1.0";
const MAX_RETRY_COUNT = 3;

// ============================================================================
// OFFLINE MANAGER
// ============================================================================

/**
 * Offline Manager class
 *
 * Manages offline operation queuing and replay.
 */
export class OfflineManager {
  private dbPath: string;
  private opsFilePath: string;
  private lastOnline?: Date;
  private statusCheckInterval?: NodeJS.Timeout;

  constructor(dbPath: string) {
    this.dbPath = expandPath(dbPath);
    this.opsFilePath = path.join(this.dbPath, OFFLINE_OPS_FILE);
  }

  /**
   * Get current offline status
   */
  async getStatus(): Promise<OfflineStatus> {
    const isRunning = await isSyncthingRunning();
    const isOffline = !isRunning;

    // Update last online time if we're online
    if (!isOffline && !this.lastOnline) {
      this.lastOnline = new Date();
      await this.updateLastOnline();
    }

    const ops = await this.loadOpsFile();
    const pendingOps = ops.operations.length;

    const info: Record<string, string> = {
      syncthingRunning: isRunning ? "yes" : "no",
      opsFilePath: this.opsFilePath,
    };

    return {
      isOffline,
      pendingOps,
      lastOnline: ops.lastOnline ? new Date(ops.lastOnline) : this.lastOnline,
      syncPending: pendingOps > 0,
      info,
    };
  }

  /**
   * Queue an operation for later sync
   */
  async queueOperation(
    type: OperationType,
    memoryId: string,
    data?: Record<string, unknown>
  ): Promise<OfflineOperation> {
    const operation: OfflineOperation = {
      id: this.generateOperationId(),
      type,
      memoryId,
      timestamp: new Date(),
      data,
      retryCount: 0,
    };

    const ops = await this.loadOpsFile();

    // Check for duplicate or conflicting operations
    const existingIdx = ops.operations.findIndex(
      (op) => op.memoryId === memoryId
    );

    if (existingIdx >= 0) {
      const existing = ops.operations[existingIdx];

      // Merge logic based on operation types
      if (type === "delete") {
        // Delete supersedes all other operations
        ops.operations[existingIdx] = operation;
      } else if (type === "update" && existing.type === "create") {
        // Update after create - merge data into create
        ops.operations[existingIdx] = {
          ...existing,
          data: { ...existing.data, ...data },
          timestamp: new Date(),
        };
        return ops.operations[existingIdx];
      } else if (type === "update" && existing.type === "update") {
        // Update after update - merge data
        ops.operations[existingIdx] = {
          ...existing,
          data: { ...existing.data, ...data },
          timestamp: new Date(),
        };
        return ops.operations[existingIdx];
      } else {
        // Other cases - add as new operation
        ops.operations.push(operation);
      }
    } else {
      ops.operations.push(operation);
    }

    await this.saveOpsFile(ops);
    return operation;
  }

  /**
   * Get all pending operations
   */
  async getPendingOps(): Promise<OfflineOperation[]> {
    const ops = await this.loadOpsFile();
    return ops.operations;
  }

  /**
   * Get pending operations by type
   */
  async getPendingOpsByType(type: OperationType): Promise<OfflineOperation[]> {
    const ops = await this.loadOpsFile();
    return ops.operations.filter((op) => op.type === type);
  }

  /**
   * Get pending operations for a specific memory
   */
  async getPendingOpsForMemory(memoryId: string): Promise<OfflineOperation[]> {
    const ops = await this.loadOpsFile();
    return ops.operations.filter((op) => op.memoryId === memoryId);
  }

  /**
   * Apply pending operations (when back online)
   *
   * @param applyFn Function that applies a single operation
   * @returns Number of successfully applied operations
   */
  async applyPendingOps(
    applyFn: (op: OfflineOperation) => Promise<boolean>
  ): Promise<number> {
    const ops = await this.loadOpsFile();

    if (ops.operations.length === 0) {
      return 0;
    }

    let applied = 0;
    const remaining: OfflineOperation[] = [];

    // Sort by timestamp to maintain order
    const sorted = [...ops.operations].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    for (const op of sorted) {
      try {
        const success = await applyFn(op);

        if (success) {
          applied++;
        } else {
          // Operation failed but didn't throw - keep for retry
          op.retryCount++;
          if (op.retryCount < MAX_RETRY_COUNT) {
            remaining.push(op);
          }
        }
      } catch (error) {
        // Operation threw an error
        op.retryCount++;
        op.lastError = error instanceof Error ? error.message : String(error);

        if (op.retryCount < MAX_RETRY_COUNT) {
          remaining.push(op);
        }
      }
    }

    // Save remaining operations
    ops.operations = remaining;
    ops.lastOnline = new Date().toISOString();
    await this.saveOpsFile(ops);

    return applied;
  }

  /**
   * Mark an operation as completed (remove from queue)
   */
  async completeOperation(operationId: string): Promise<boolean> {
    const ops = await this.loadOpsFile();
    const initialLength = ops.operations.length;

    ops.operations = ops.operations.filter((op) => op.id !== operationId);

    if (ops.operations.length !== initialLength) {
      await this.saveOpsFile(ops);
      return true;
    }

    return false;
  }

  /**
   * Clear all pending operations
   */
  async clearPendingOps(): Promise<void> {
    const ops = await this.loadOpsFile();
    ops.operations = [];
    ops.updatedAt = new Date().toISOString();
    await this.saveOpsFile(ops);
  }

  /**
   * Start monitoring online status
   *
   * @param onStatusChange Callback when status changes
   * @param interval Check interval in ms (default: 30000)
   */
  startMonitoring(
    onStatusChange: (status: OfflineStatus) => void,
    interval: number = 30000
  ): void {
    this.stopMonitoring();

    let lastOfflineState: boolean | null = null;

    const check = async () => {
      const status = await this.getStatus();

      // Only notify on state change
      if (lastOfflineState !== status.isOffline) {
        lastOfflineState = status.isOffline;
        onStatusChange(status);
      }
    };

    // Run immediately
    check();

    // Then run at interval
    this.statusCheckInterval = setInterval(check, interval);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.statusCheckInterval) {
      clearInterval(this.statusCheckInterval);
      this.statusCheckInterval = undefined;
    }
  }

  /**
   * Get operation statistics
   */
  async getStats(): Promise<{
    total: number;
    byType: Record<OperationType, number>;
    oldestOperation?: Date;
    newestOperation?: Date;
    failedCount: number;
  }> {
    const ops = await this.loadOpsFile();

    const byType: Record<OperationType, number> = {
      create: 0,
      update: 0,
      delete: 0,
    };

    let oldestOperation: Date | undefined;
    let newestOperation: Date | undefined;
    let failedCount = 0;

    for (const op of ops.operations) {
      byType[op.type]++;

      const timestamp = new Date(op.timestamp);
      if (!oldestOperation || timestamp < oldestOperation) {
        oldestOperation = timestamp;
      }
      if (!newestOperation || timestamp > newestOperation) {
        newestOperation = timestamp;
      }

      if (op.retryCount > 0) {
        failedCount++;
      }
    }

    return {
      total: ops.operations.length,
      byType,
      oldestOperation,
      newestOperation,
      failedCount,
    };
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private async loadOpsFile(): Promise<OfflineOpsFile> {
    try {
      const content = await fs.readFile(this.opsFilePath, "utf-8");
      return JSON.parse(content);
    } catch {
      // File doesn't exist or is invalid
      return {
        version: FILE_VERSION,
        updatedAt: new Date().toISOString(),
        operations: [],
      };
    }
  }

  private async saveOpsFile(ops: OfflineOpsFile): Promise<void> {
    ops.updatedAt = new Date().toISOString();

    // Ensure directory exists
    await fs.mkdir(path.dirname(this.opsFilePath), { recursive: true });

    await fs.writeFile(
      this.opsFilePath,
      JSON.stringify(ops, null, 2),
      "utf-8"
    );
  }

  private async updateLastOnline(): Promise<void> {
    const ops = await this.loadOpsFile();
    ops.lastOnline = new Date().toISOString();
    await this.saveOpsFile(ops);
  }

  private generateOperationId(): string {
    return `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create an offline manager
 */
export function createOfflineManager(dbPath: string): OfflineManager {
  return new OfflineManager(dbPath);
}
