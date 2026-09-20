#!/usr/bin/env node
/**
 * Memory System CLI
 *
 * Command-line interface for the OpenClaw Smart Memory System.
 *
 * Usage:
 *   npx tsx src/cli.ts <command> [options]
 *
 * Commands:
 *   status              Show system status
 *   recall <query>      Search for relevant memories
 *   store <text>        Store text (triggers extraction)
 *   list [--limit N]    List recent memories
 *   get <id>            Get a specific memory
 *   delete <id>         Delete a memory
 *   backup create       Create a backup
 *   backup list         List backups
 *   backup restore <p>  Restore from backup
 *   sync status         Show sync status
 *   sync setup          Show setup instructions
 *   config show         Show current config
 *   config set <k> <v>  Update config
 *
 * Options:
 *   --json              Output in JSON format
 *   --quiet             Minimal output
 *   --help              Show help
 */

import { initMemorySystem, MemorySystem, resetMemorySystem } from "./memory-system.js";
import { loadConfig, saveConfig, updateConfigValue, getDefaultConfig } from "./memory-config.js";

// ============================================================================
// TYPES
// ============================================================================

interface CLIOptions {
  json?: boolean;
  quiet?: boolean;
  limit?: number;
  help?: boolean;
}

// ============================================================================
// COLORS (ANSI)
// ============================================================================

const isTTY = process.stdout.isTTY;

const colors = {
  reset: isTTY ? "\x1b[0m" : "",
  bold: isTTY ? "\x1b[1m" : "",
  dim: isTTY ? "\x1b[2m" : "",
  green: isTTY ? "\x1b[32m" : "",
  yellow: isTTY ? "\x1b[33m" : "",
  blue: isTTY ? "\x1b[34m" : "",
  cyan: isTTY ? "\x1b[36m" : "",
  red: isTTY ? "\x1b[31m" : "",
};

// ============================================================================
// ARGUMENT PARSING
// ============================================================================

function parseArgs(args: string[]): { command: string[]; options: CLIOptions } {
  const command: string[] = [];
  const options: CLIOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--quiet" || arg === "-q") {
      options.quiet = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--limit" || arg === "-l") {
      options.limit = parseInt(args[++i], 10) || 10;
    } else if (arg.startsWith("-")) {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    } else {
      command.push(arg);
    }
  }

  return { command, options };
}

// ============================================================================
// OUTPUT HELPERS
// ============================================================================

function output(data: unknown, options: CLIOptions): void {
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
  } else if (!options.quiet) {
    if (typeof data === "string") {
      console.log(data);
    } else {
      console.log(data);
    }
  }
}

function heading(text: string, options: CLIOptions): void {
  if (!options.json && !options.quiet) {
    console.log(`\n${colors.bold}${colors.blue}${text}${colors.reset}\n`);
  }
}

function success(text: string, options: CLIOptions): void {
  if (!options.json && !options.quiet) {
    console.log(`${colors.green}✓${colors.reset} ${text}`);
  }
}

function error(text: string): void {
  console.error(`${colors.red}✗${colors.reset} ${text}`);
}

function info(text: string, options: CLIOptions): void {
  if (!options.json && !options.quiet) {
    console.log(`${colors.dim}${text}${colors.reset}`);
  }
}

// ============================================================================
// COMMANDS
// ============================================================================

async function showHelp(): Promise<void> {
  console.log(`
${colors.bold}OpenClaw Memory System CLI${colors.reset}

${colors.cyan}Usage:${colors.reset}
  npx tsx src/cli.ts <command> [options]

${colors.cyan}Commands:${colors.reset}
  ${colors.bold}status${colors.reset}              Show system status
  ${colors.bold}recall${colors.reset} <query>      Search for relevant memories
  ${colors.bold}store${colors.reset} <text>        Store text (triggers extraction)
  ${colors.bold}list${colors.reset} [--limit N]    List recent memories
  ${colors.bold}get${colors.reset} <id>            Get a specific memory by ID
  ${colors.bold}delete${colors.reset} <id>         Delete a memory by ID
  ${colors.bold}backup create${colors.reset}       Create a backup
  ${colors.bold}backup list${colors.reset}         List available backups
  ${colors.bold}backup restore${colors.reset} <p>  Restore from backup path
  ${colors.bold}sync status${colors.reset}         Show sync status
  ${colors.bold}sync setup${colors.reset}          Show Syncthing setup instructions
  ${colors.bold}config show${colors.reset}         Show current configuration
  ${colors.bold}config set${colors.reset} <k> <v>  Set configuration value

${colors.cyan}Options:${colors.reset}
  --json, -j          Output in JSON format
  --quiet, -q         Minimal output
  --limit N, -l N     Limit results (default: 10)
  --help, -h          Show this help

${colors.cyan}Examples:${colors.reset}
  npx tsx src/cli.ts status
  npx tsx src/cli.ts recall "authentication patterns"
  npx tsx src/cli.ts list --limit 5 --json
  npx tsx src/cli.ts backup create
`);
}

async function cmdStatus(system: MemorySystem, options: CLIOptions): Promise<void> {
  heading("Memory System Status", options);

  const status = await system.getStatus();

  if (options.json) {
    output(status, options);
    return;
  }

  console.log(`${colors.bold}Database:${colors.reset} ${status.dbPath}`);
  console.log(`${colors.bold}Memories:${colors.reset} ${status.memoryCount.toLocaleString()}`);
  console.log(`${colors.bold}Uptime:${colors.reset} ${formatDuration(status.uptime)}`);
  console.log();
  console.log(`${colors.bold}Configuration:${colors.reset}`);
  console.log(`  Sync: ${status.config.syncEnabled ? "enabled" : "disabled"}`);
  console.log(`  Auto-extraction: ${status.config.autoExtractionEnabled ? "enabled" : "disabled"}`);
  console.log(`  Extraction model: ${status.config.extractionModel}`);
  console.log(`  Embedding model: ${status.config.embeddingModel}`);

  if (status.syncStatus) {
    console.log();
    console.log(`${colors.bold}Sync Status:${colors.reset}`);
    console.log(`  State: ${status.syncStatus.status.state}`);
    console.log(`  Pending conflicts: ${status.syncStatus.pendingConflicts}`);
  }

  if (status.lastBackup) {
    console.log();
    console.log(`${colors.bold}Last Backup:${colors.reset} ${formatDate(status.lastBackup)}`);
  }

  if (status.extractionQueue > 0) {
    console.log();
    console.log(`${colors.yellow}Extraction queue: ${status.extractionQueue} pending${colors.reset}`);
  }
}

async function cmdRecall(system: MemorySystem, query: string, options: CLIOptions): Promise<void> {
  if (!query) {
    error("Query is required. Usage: recall <query>");
    process.exit(1);
  }

  heading(`Searching for: "${query}"`, options);

  const result = await system.recall(query, {
    limit: options.limit || 10,
    includeMemories: true,
  });

  if (options.json) {
    output(result, options);
    return;
  }

  if (result.memoryCount === 0) {
    info("No relevant memories found.", options);
    return;
  }

  console.log(`Found ${colors.bold}${result.memoryCount}${colors.reset} relevant memories (${result.latency}ms)\n`);

  if (result.memories) {
    for (const memory of result.memories) {
      const age = formatAge(new Date(memory.createdAt));
      console.log(`${colors.bold}[${memory.category}]${colors.reset} ${memory.content.slice(0, 80)}${memory.content.length > 80 ? "..." : ""}`);
      console.log(`  ${colors.dim}ID: ${memory.id} | ${age} | Project: ${memory.project || "none"}${colors.reset}`);
      console.log();
    }
  }

  info(`Context: ${result.tokenCount} tokens, ${result.cached ? "cached" : "fresh"}`, options);
}

async function cmdStore(system: MemorySystem, text: string, options: CLIOptions): Promise<void> {
  if (!text) {
    error("Text is required. Usage: store <text>");
    process.exit(1);
  }

  const ids = await system.storeConversation(text);

  if (options.json) {
    output({ queued: true, ids }, options);
    return;
  }

  success("Conversation queued for extraction", options);
  info(`${ids.length} memories extracted`, options);
}

async function cmdList(system: MemorySystem, options: CLIOptions): Promise<void> {
  heading("Recent Memories", options);

  const limit = options.limit || 10;
  const memories = await system.memories.search("", limit);

  if (options.json) {
    output(memories, options);
    return;
  }

  if (memories.length === 0) {
    info("No memories found.", options);
    return;
  }

  for (const memory of memories) {
    const age = formatAge(new Date(memory.createdAt));
    console.log(`${colors.cyan}${memory.id}${colors.reset}`);
    console.log(`  ${colors.bold}[${memory.category}]${colors.reset} ${memory.content.slice(0, 100)}${memory.content.length > 100 ? "..." : ""}`);
    console.log(`  ${colors.dim}${age} | Project: ${memory.project || "none"} | Importance: ${memory.importance}${colors.reset}`);
    console.log();
  }
}

async function cmdGet(system: MemorySystem, id: string, options: CLIOptions): Promise<void> {
  if (!id) {
    error("Memory ID is required. Usage: get <id>");
    process.exit(1);
  }

  const memory = await system.memories.get(id);

  if (!memory) {
    error(`Memory not found: ${id}`);
    process.exit(1);
  }

  if (options.json) {
    output(memory, options);
    return;
  }

  console.log(`${colors.bold}ID:${colors.reset} ${memory.id}`);
  console.log(`${colors.bold}Category:${colors.reset} ${memory.category}`);
  console.log(`${colors.bold}Content:${colors.reset}`);
  console.log(`  ${memory.content}`);
  console.log(`${colors.bold}Project:${colors.reset} ${memory.project || "none"}`);
  console.log(`${colors.bold}Importance:${colors.reset} ${memory.importance}`);
  console.log(`${colors.bold}Created:${colors.reset} ${formatDate(new Date(memory.createdAt))}`);
  console.log(`${colors.bold}Updated:${colors.reset} ${formatDate(new Date(memory.updatedAt))}`);
}

async function cmdDelete(system: MemorySystem, id: string, options: CLIOptions): Promise<void> {
  if (!id) {
    error("Memory ID is required. Usage: delete <id>");
    process.exit(1);
  }

  const deleted = await system.memories.delete(id);

  if (options.json) {
    output({ deleted, id }, options);
    return;
  }

  if (deleted) {
    success(`Deleted memory: ${id}`, options);
  } else {
    error(`Failed to delete memory: ${id}`);
    process.exit(1);
  }
}

async function cmdBackupCreate(system: MemorySystem, options: CLIOptions): Promise<void> {
  heading("Creating Backup", options);

  const result = await system.backup.create();

  if (options.json) {
    output(result, options);
    return;
  }

  if (result.success && result.backup) {
    success("Backup created successfully", options);
    console.log(`  Path: ${result.backup.path}`);
    console.log(`  Size: ${formatBytes(result.backup.size)}`);
    console.log(`  Compression: ${result.backup.compressionRatio.toFixed(1)}x`);
  } else {
    error(`Backup failed: ${result.error}`);
    process.exit(1);
  }
}

async function cmdBackupList(system: MemorySystem, options: CLIOptions): Promise<void> {
  heading("Available Backups", options);

  const backups = await system.backup.list();

  if (options.json) {
    output(backups, options);
    return;
  }

  if (backups.length === 0) {
    info("No backups found.", options);
    return;
  }

  for (const backup of backups) {
    console.log(`${colors.cyan}${backup.name}${colors.reset}`);
    console.log(`  Path: ${backup.path}`);
    console.log(`  Size: ${formatBytes(backup.size)}`);
    console.log(`  Created: ${formatDate(backup.createdAt)}`);
    console.log();
  }
}

async function cmdBackupRestore(system: MemorySystem, path: string, options: CLIOptions): Promise<void> {
  if (!path) {
    error("Backup path is required. Usage: backup restore <path>");
    process.exit(1);
  }

  heading("Restoring from Backup", options);
  info(`Path: ${path}`, options);

  const result = await system.backup.restore(path);

  if (options.json) {
    output(result, options);
    return;
  }

  if (result.success) {
    success("Backup restored successfully", options);
    console.log(`  Restored to: ${result.restoredPath}`);
    if (result.existingBackupPath) {
      console.log(`  Previous database backed up to: ${result.existingBackupPath}`);
    }
  } else {
    error(`Restore failed: ${result.error}`);
    process.exit(1);
  }
}

async function cmdSyncStatus(system: MemorySystem, options: CLIOptions): Promise<void> {
  heading("Sync Status", options);

  const status = await system.sync.getStatus();

  if (options.json) {
    output(status, options);
    return;
  }

  if (!status) {
    info("Sync is disabled.", options);
    return;
  }

  console.log(`${colors.bold}State:${colors.reset} ${status.status.state}`);
  console.log(`${colors.bold}Folder:${colors.reset} ${status.folderPath}`);
  console.log(`${colors.bold}Folder ID:${colors.reset} ${status.folderId}`);
  console.log(`${colors.bold}.stignore:${colors.reset} ${status.stIgnoreExists ? "exists" : "missing"}`);
  console.log(`${colors.bold}Pending conflicts:${colors.reset} ${status.pendingConflicts}`);

  if (status.lastSync) {
    console.log(`${colors.bold}Last sync:${colors.reset} ${formatDate(status.lastSync)}`);
  }
}

async function cmdSyncSetup(system: MemorySystem, options: CLIOptions): Promise<void> {
  const instructions = system.sync.getSetupInstructions();

  if (options.json) {
    output({ instructions }, options);
    return;
  }

  console.log(instructions);
}

async function cmdConfigShow(options: CLIOptions): Promise<void> {
  heading("Configuration", options);

  const config = await loadConfig();

  if (options.json) {
    output(config, options);
    return;
  }

  console.log(`${colors.bold}Database:${colors.reset}`);
  console.log(`  Path: ${config.dbPath}`);
  console.log();
  console.log(`${colors.bold}Features:${colors.reset}`);
  console.log(`  Sync: ${config.enableSync}`);
  console.log(`  Auto-extraction: ${config.enableAutoExtraction}`);
  console.log();
  console.log(`${colors.bold}Models:${colors.reset}`);
  console.log(`  Extraction: ${config.extractionModel}`);
  console.log(`  Embedding: ${config.embeddingModel}`);
  console.log();
  console.log(`${colors.bold}Backup:${colors.reset}`);
  console.log(`  Auto-backup: ${config.backup?.autoBackup}`);
  console.log(`  Keep count: ${config.backup?.keepCount}`);
  console.log(`  Path: ${config.backup?.path}`);
  console.log();
  console.log(`${colors.bold}Retrieval:${colors.reset}`);
  console.log(`  Max results: ${config.retrieval?.maxResults}`);
  console.log(`  Min score: ${config.retrieval?.minScore}`);
  console.log(`  Max tokens: ${config.retrieval?.maxTokens}`);
  console.log(`  Default format: ${config.retrieval?.defaultFormat}`);
  console.log();
  console.log(`${colors.bold}Logging:${colors.reset} ${config.logLevel}`);
}

async function cmdConfigSet(key: string, value: string, options: CLIOptions): Promise<void> {
  if (!key || value === undefined) {
    error("Key and value required. Usage: config set <key> <value>");
    process.exit(1);
  }

  // Parse value
  let parsedValue: unknown = value;
  if (value === "true") parsedValue = true;
  else if (value === "false") parsedValue = false;
  else if (/^\d+$/.test(value)) parsedValue = parseInt(value, 10);
  else if (/^\d+\.\d+$/.test(value)) parsedValue = parseFloat(value);

  await updateConfigValue(key, parsedValue);

  if (options.json) {
    output({ updated: true, key, value: parsedValue }, options);
    return;
  }

  success(`Updated ${key} = ${parsedValue}`, options);
}

// ============================================================================
// FORMAT HELPERS
// ============================================================================

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

function formatAge(date: Date): string {
  const ms = Date.now() - date.getTime();
  if (ms < 60000) return "just now";
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
  if (ms < 604800000) return `${Math.floor(ms / 86400000)}d ago`;
  return formatDate(date);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { command, options } = parseArgs(args);

  // Show help if requested or no command
  if (options.help || command.length === 0) {
    await showHelp();
    process.exit(0);
  }

  const cmd = command[0];

  // Commands that don't need system initialization
  if (cmd === "config") {
    const subCmd = command[1];
    if (subCmd === "show") {
      await cmdConfigShow(options);
    } else if (subCmd === "set") {
      await cmdConfigSet(command[2], command[3], options);
    } else {
      error(`Unknown config command: ${subCmd}`);
      process.exit(1);
    }
    return;
  }

  // Initialize memory system for other commands
  let system: MemorySystem;
  try {
    system = await initMemorySystem({
      logLevel: options.quiet ? "error" : "warn",
    });
  } catch (err) {
    error(`Failed to initialize memory system: ${err}`);
    process.exit(1);
  }

  try {
    switch (cmd) {
      case "status":
        await cmdStatus(system, options);
        break;

      case "recall":
        await cmdRecall(system, command.slice(1).join(" "), options);
        break;

      case "store":
        await cmdStore(system, command.slice(1).join(" "), options);
        break;

      case "list":
        await cmdList(system, options);
        break;

      case "get":
        await cmdGet(system, command[1], options);
        break;

      case "delete":
        await cmdDelete(system, command[1], options);
        break;

      case "backup":
        const backupCmd = command[1];
        if (backupCmd === "create") {
          await cmdBackupCreate(system, options);
        } else if (backupCmd === "list") {
          await cmdBackupList(system, options);
        } else if (backupCmd === "restore") {
          await cmdBackupRestore(system, command[2], options);
        } else {
          error(`Unknown backup command: ${backupCmd}`);
          process.exit(1);
        }
        break;

      case "sync":
        const syncCmd = command[1];
        if (syncCmd === "status") {
          await cmdSyncStatus(system, options);
        } else if (syncCmd === "setup") {
          await cmdSyncSetup(system, options);
        } else {
          error(`Unknown sync command: ${syncCmd}`);
          process.exit(1);
        }
        break;

      default:
        error(`Unknown command: ${cmd}`);
        await showHelp();
        process.exit(1);
    }
  } finally {
    await resetMemorySystem();
  }
}

main().catch((err) => {
  error(`Unexpected error: ${err}`);
  process.exit(1);
});
