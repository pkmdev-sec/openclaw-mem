/**
 * Syncthing Helper Module
 *
 * Utilities for Syncthing setup and status monitoring.
 * Handles .stignore generation, config snippets, and status checks.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { SyncConfig, expandPath } from "./sync-config.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Sync status information
 */
export interface SyncStatus {
  /** Whether Syncthing appears to be running */
  running: boolean;

  /** Whether the memory folder is configured (has .stignore) */
  folderConfigured: boolean;

  /** Current sync state */
  state: "idle" | "syncing" | "error" | "unknown";

  /** Number of connected devices (if available) */
  connectedDevices: number;

  /** Last sync time (if available) */
  lastSync?: Date;

  /** Any sync errors */
  errors: string[];

  /** Additional info */
  info: Record<string, string>;
}

/**
 * Syncthing API response types (subset)
 */
interface SyncthingSystemStatus {
  alloc: number;
  connectionServiceStatus: Record<string, unknown>;
  cpuPercent: number;
  discoveryEnabled: boolean;
  discoveryErrors: Record<string, string>;
  discoveryMethods: number;
  goroutines: number;
  guiAddressOverridden: boolean;
  guiAddressUsed: string;
  lastDialStatus: Record<string, unknown>;
  myID: string;
  pathSeparator: string;
  startTime: string;
  sys: number;
  tilde: string;
  uptime: number;
  urVersionMax: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Default Syncthing API URL
 */
const SYNCTHING_API_URL = "http://127.0.0.1:8384";

/**
 * .stignore file name
 */
const STIGNORE_FILE = ".stignore";

// ============================================================================
// STATUS CHECKING
// ============================================================================

/**
 * Check if Syncthing is running
 *
 * Attempts to connect to the local Syncthing API.
 * Note: May require API key for full access.
 */
export async function isSyncthingRunning(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(`${SYNCTHING_API_URL}/rest/system/ping`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get Syncthing system status (if available)
 */
export async function getSyncthingStatus(): Promise<SyncthingSystemStatus | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(`${SYNCTHING_API_URL}/rest/system/status`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as SyncthingSystemStatus;
  } catch {
    return null;
  }
}

/**
 * Get comprehensive sync status
 */
export async function getSyncStatus(config: SyncConfig): Promise<SyncStatus> {
  const errors: string[] = [];
  const info: Record<string, string> = {};

  // Check if Syncthing is running
  const running = await isSyncthingRunning();
  info["syncthingRunning"] = running ? "yes" : "no";

  // Check if folder is configured (has .stignore)
  const stignorePath = path.join(expandPath(config.dbPath), STIGNORE_FILE);
  let folderConfigured = false;
  try {
    await fs.access(stignorePath);
    folderConfigured = true;
  } catch {
    folderConfigured = false;
  }
  info["stignoreExists"] = folderConfigured ? "yes" : "no";

  // Check for conflict files
  const conflictCount = await countConflictFiles(config.dbPath);
  if (conflictCount > 0) {
    errors.push(`${conflictCount} sync conflict(s) detected`);
    info["conflictFiles"] = String(conflictCount);
  }

  // Determine state
  let state: SyncStatus["state"] = "unknown";
  if (!running) {
    state = "unknown";
  } else if (errors.length > 0) {
    state = "error";
  } else if (folderConfigured) {
    state = "idle"; // Assume idle if no errors and configured
  }

  // Try to get more detailed status from Syncthing API
  let connectedDevices = 0;
  let lastSync: Date | undefined;

  if (running) {
    const systemStatus = await getSyncthingStatus();
    if (systemStatus) {
      info["syncthingUptime"] = `${Math.floor(systemStatus.uptime / 60)} minutes`;
      info["syncthingDeviceId"] = systemStatus.myID?.slice(0, 7) + "...";
    }
  }

  return {
    running,
    folderConfigured,
    state,
    connectedDevices,
    lastSync,
    errors,
    info,
  };
}

/**
 * Count conflict files in a directory
 */
async function countConflictFiles(dbPath: string): Promise<number> {
  try {
    const resolvedPath = expandPath(dbPath);
    const entries = await fs.readdir(resolvedPath, { recursive: true });

    return entries.filter(
      (entry) =>
        typeof entry === "string" && entry.includes(".sync-conflict-")
    ).length;
  } catch {
    return 0;
  }
}

// ============================================================================
// .STIGNORE GENERATION
// ============================================================================

/**
 * Generate .stignore file content
 */
export function generateStIgnore(config: SyncConfig): string {
  const lines: string[] = [
    "// OpenClaw Memory - Syncthing ignore patterns",
    "// Generated automatically - do not edit manually",
    "//",
    `// Folder ID: ${config.folderId}`,
    `// Generated: ${new Date().toISOString()}`,
    "",
  ];

  // Add ignore patterns
  for (const pattern of config.ignorePatterns) {
    lines.push(pattern);
  }

  // Add explanation comments
  lines.push("");
  lines.push("// Lock files - prevent sync issues");
  lines.push("// Conflict files - handled by conflict detector");
  lines.push("// Temporary files - no need to sync");

  return lines.join("\n") + "\n";
}

/**
 * Write .stignore file to sync folder
 */
export async function writeStIgnore(
  dbPath: string,
  config: SyncConfig
): Promise<void> {
  const stignorePath = path.join(expandPath(dbPath), STIGNORE_FILE);
  const content = generateStIgnore(config);

  await fs.writeFile(stignorePath, content, "utf-8");
}

/**
 * Check if .stignore exists and is valid
 */
export async function checkStIgnore(
  dbPath: string
): Promise<{ exists: boolean; valid: boolean; content?: string }> {
  const stignorePath = path.join(expandPath(dbPath), STIGNORE_FILE);

  try {
    const content = await fs.readFile(stignorePath, "utf-8");

    // Check if it has our header
    const valid = content.includes("OpenClaw Memory");

    return { exists: true, valid, content };
  } catch {
    return { exists: false, valid: false };
  }
}

// ============================================================================
// CONFIG SNIPPET GENERATION
// ============================================================================

/**
 * Generate Syncthing configuration snippet for manual setup
 *
 * This generates a YAML-like snippet that users can reference
 * when adding the folder in Syncthing's web UI.
 */
export function generateSyncthingConfig(config: SyncConfig): string {
  return `# Syncthing Folder Configuration for OpenClaw Memory
# Add this folder in Syncthing's web UI (http://127.0.0.1:8384)

Folder Settings:
  Folder ID:    ${config.folderId}
  Folder Label: ${config.folderLabel}
  Folder Path:  ${expandPath(config.dbPath)}

Advanced Settings:
  File Versioning: ${config.versioning ? "Simple File Versioning" : "No File Versioning"}
  ${config.versioning ? `Keep Versions: ${config.versionCount}` : ""}

  Ignore Permissions: Yes (recommended)
  Watch for Changes:  Yes

  Full Rescan Interval: 3600 (1 hour)

File Sync Options:
  Sync Ownership:     No
  Send Ownership:     No
  Sync Extended Attrs: No
  Send Extended Attrs: No

# Note: Share this folder with your other devices after setup
`;
}

/**
 * Generate setup instructions for users
 */
export function generateSetupInstructions(config: SyncConfig): string {
  const resolvedPath = expandPath(config.dbPath);

  return `
# Syncthing Setup for OpenClaw Memory

## Prerequisites
1. Install Syncthing: https://syncthing.net/downloads/
2. Start Syncthing (it will open a web UI at http://127.0.0.1:8384)

## Step 1: Add the Memory Folder

1. Open Syncthing Web UI (http://127.0.0.1:8384)
2. Click "Add Folder"
3. Enter the following settings:

   **General Tab:**
   - Folder Label: ${config.folderLabel}
   - Folder ID: ${config.folderId}
   - Folder Path: ${resolvedPath}

   **File Versioning Tab:**
   - Type: Simple File Versioning
   - Keep Versions: ${config.versionCount}

   **Advanced Tab:**
   - Ignore Permissions: ✓ (checked)

4. Click "Save"

## Step 2: Share with Other Devices

1. On your other device, install and start Syncthing
2. In the Syncthing Web UI, click "Add Remote Device"
3. Enter the Device ID from your other device
4. Accept the device pairing on both devices
5. Share the "${config.folderLabel}" folder with the new device

## Step 3: Verify Setup

The .stignore file has been created to prevent syncing temporary files.
Location: ${path.join(resolvedPath, STIGNORE_FILE)}

## Troubleshooting

- If you see "Out of Sync" status, wait a few minutes for initial sync
- If conflicts occur, they will be detected automatically
- Check Syncthing logs for any error messages

## Important Notes

- Keep Syncthing running for automatic sync
- Don't manually edit files in the .lance folder
- Backups are recommended before major changes
`;
}

// ============================================================================
// FOLDER UTILITIES
// ============================================================================

/**
 * Ensure sync folder exists with proper structure
 */
export async function ensureSyncFolder(config: SyncConfig): Promise<void> {
  const resolvedPath = expandPath(config.dbPath);

  // Create folder if it doesn't exist
  await fs.mkdir(resolvedPath, { recursive: true });

  // Check and create .stignore if needed
  const stignoreCheck = await checkStIgnore(config.dbPath);
  if (!stignoreCheck.exists || !stignoreCheck.valid) {
    await writeStIgnore(config.dbPath, config);
  }
}

/**
 * Get folder statistics
 */
export async function getFolderStats(
  dbPath: string
): Promise<{ fileCount: number; totalSize: number }> {
  const resolvedPath = expandPath(dbPath);

  let fileCount = 0;
  let totalSize = 0;

  try {
    const entries = await fs.readdir(resolvedPath, {
      withFileTypes: true,
      recursive: true,
    });

    for (const entry of entries) {
      if (entry.isFile()) {
        fileCount++;
        try {
          const filePath = path.join(entry.parentPath || entry.path, entry.name);
          const stats = await fs.stat(filePath);
          totalSize += stats.size;
        } catch {
          // Skip files we can't stat
        }
      }
    }
  } catch {
    // Folder might not exist yet
  }

  return { fileCount, totalSize };
}
