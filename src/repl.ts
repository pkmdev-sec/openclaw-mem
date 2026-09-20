#!/usr/bin/env node
/**
 * Memory System REPL
 *
 * Interactive Read-Eval-Print Loop for memory exploration.
 *
 * Usage:
 *   npx tsx src/repl.ts
 *
 * Commands:
 *   .recall <query>   Search memories (or just type naturally)
 *   .store <text>     Store text for extraction
 *   .list             List recent memories
 *   .status           Show system status
 *   .help             Show available commands
 *   .quit             Exit REPL
 *
 * Natural language mode:
 *   Just type a question and it will recall relevant memories.
 *   Prefix with "remember:" to store instead of recall.
 */

import * as readline from "readline";
import { initMemorySystem, MemorySystem, resetMemorySystem } from "./memory-system.js";

// ============================================================================
// COLORS
// ============================================================================

const isTTY = process.stdout.isTTY;

const c = {
  reset: isTTY ? "\x1b[0m" : "",
  bold: isTTY ? "\x1b[1m" : "",
  dim: isTTY ? "\x1b[2m" : "",
  green: isTTY ? "\x1b[32m" : "",
  yellow: isTTY ? "\x1b[33m" : "",
  blue: isTTY ? "\x1b[34m" : "",
  cyan: isTTY ? "\x1b[36m" : "",
  red: isTTY ? "\x1b[31m" : "",
  magenta: isTTY ? "\x1b[35m" : "",
};

// ============================================================================
// HELPERS
// ============================================================================

function formatAge(date: Date): string {
  const ms = Date.now() - date.getTime();
  if (ms < 60000) return "just now";
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
  if (ms < 604800000) return `${Math.floor(ms / 86400000)}d ago`;
  return date.toLocaleDateString();
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

// ============================================================================
// REPL CLASS
// ============================================================================

class MemoryREPL {
  private system: MemorySystem | null = null;
  private rl: readline.Interface | null = null;
  private running = false;

  async start(): Promise<void> {
    // Print banner
    console.log(`
${c.bold}${c.blue}🧠 OpenClaw Memory REPL${c.reset}
${c.dim}Type a question to recall, or use .commands${c.reset}
${c.dim}Type .help for available commands${c.reset}
`);

    // Initialize system
    try {
      console.log(`${c.dim}Initializing memory system...${c.reset}`);
      this.system = await initMemorySystem({
        logLevel: "error", // Quiet initialization
      });
      console.log(`${c.green}✓${c.reset} Ready\n`);
    } catch (err) {
      console.error(`${c.red}✗${c.reset} Failed to initialize: ${err}`);
      process.exit(1);
    }

    // Create readline interface
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: `${c.cyan}>${c.reset} `,
      historySize: 100,
    });

    this.running = true;

    // Handle input
    this.rl.on("line", async (line) => {
      const input = line.trim();

      if (!input) {
        this.rl?.prompt();
        return;
      }

      try {
        await this.handleInput(input);
      } catch (err) {
        console.error(`${c.red}Error:${c.reset} ${err}`);
      }

      if (this.running) {
        console.log();
        this.rl?.prompt();
      }
    });

    // Handle close
    this.rl.on("close", () => {
      this.quit();
    });

    // Handle SIGINT
    this.rl.on("SIGINT", () => {
      this.quit();
    });

    // Start prompting
    this.rl.prompt();
  }

  private async handleInput(input: string): Promise<void> {
    // Check for commands
    if (input.startsWith(".")) {
      await this.handleCommand(input);
      return;
    }

    // Check for "remember:" prefix
    if (input.toLowerCase().startsWith("remember:")) {
      const text = input.slice(9).trim();
      await this.store(text);
      return;
    }

    // Default: recall
    await this.recall(input);
  }

  private async handleCommand(input: string): Promise<void> {
    const parts = input.slice(1).split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(" ");

    switch (cmd) {
      case "help":
      case "h":
        this.showHelp();
        break;

      case "recall":
      case "r":
        await this.recall(args);
        break;

      case "store":
      case "s":
        await this.store(args);
        break;

      case "list":
      case "l":
        await this.list(parseInt(args) || 5);
        break;

      case "get":
      case "g":
        await this.get(args);
        break;

      case "delete":
      case "d":
        await this.delete(args);
        break;

      case "status":
        await this.status();
        break;

      case "quit":
      case "q":
      case "exit":
        this.quit();
        break;

      default:
        console.log(`${c.red}Unknown command:${c.reset} .${cmd}`);
        console.log(`${c.dim}Type .help for available commands${c.reset}`);
    }
  }

  private showHelp(): void {
    console.log(`
${c.bold}Commands:${c.reset}
  ${c.cyan}.recall <query>${c.reset}  Search for relevant memories
  ${c.cyan}.store <text>${c.reset}    Store text for extraction
  ${c.cyan}.list [N]${c.reset}        List recent memories (default: 5)
  ${c.cyan}.get <id>${c.reset}        Get a specific memory
  ${c.cyan}.delete <id>${c.reset}     Delete a memory
  ${c.cyan}.status${c.reset}          Show system status
  ${c.cyan}.help${c.reset}            Show this help
  ${c.cyan}.quit${c.reset}            Exit REPL

${c.bold}Natural Language:${c.reset}
  Just type a question to search memories.
  Prefix with ${c.yellow}remember:${c.reset} to store instead.

${c.bold}Shortcuts:${c.reset}
  .r = .recall, .s = .store, .l = .list
  .g = .get, .d = .delete, .q = .quit
`);
  }

  private async recall(query: string): Promise<void> {
    if (!query) {
      console.log(`${c.yellow}Please provide a query.${c.reset}`);
      return;
    }

    console.log(`${c.dim}Searching...${c.reset}`);

    const result = await this.system!.recall(query, {
      limit: 5,
      includeMemories: true,
    });

    if (result.memoryCount === 0) {
      console.log(`${c.dim}No relevant memories found.${c.reset}`);
      return;
    }

    console.log(`${c.green}📚 Found ${result.memoryCount} relevant memories:${c.reset}\n`);

    if (result.memories) {
      for (let i = 0; i < result.memories.length; i++) {
        const memory = result.memories[i];
        const age = formatAge(new Date(memory.createdAt));
        const project = memory.project ? `project: ${memory.project}` : "no project";

        console.log(`${c.bold}${i + 1}. [${memory.category}]${c.reset} ${truncate(memory.content, 70)}`);
        console.log(`   ${c.dim}${age} | ${project}${c.reset}`);
        console.log();
      }
    }

    console.log(`${c.dim}Latency: ${result.latency}ms | ${result.cached ? "cached" : "fresh"}${c.reset}`);
  }

  private async store(text: string): Promise<void> {
    if (!text) {
      console.log(`${c.yellow}Please provide text to store.${c.reset}`);
      return;
    }

    const config = this.system!.getConfig();
    if (!config.enableAutoExtraction) {
      console.log(`${c.yellow}Auto-extraction is disabled.${c.reset}`);
      console.log(`${c.dim}Enable it with: .config enableAutoExtraction true${c.reset}`);
      return;
    }

    console.log(`${c.dim}Queuing for extraction...${c.reset}`);
    await this.system!.storeConversation(text);
    console.log(`${c.green}✓${c.reset} Queued for extraction`);
  }

  private async list(limit: number = 5): Promise<void> {
    const memories = await this.system!.memories.search("", limit);

    if (memories.length === 0) {
      console.log(`${c.dim}No memories found.${c.reset}`);
      return;
    }

    console.log(`${c.bold}Recent Memories:${c.reset}\n`);

    for (const memory of memories) {
      const age = formatAge(new Date(memory.createdAt));
      console.log(`${c.cyan}${memory.id}${c.reset}`);
      console.log(`  ${c.bold}[${memory.category}]${c.reset} ${truncate(memory.content, 60)}`);
      console.log(`  ${c.dim}${age} | ${memory.project || "no project"} | importance: ${memory.importance}${c.reset}`);
      console.log();
    }
  }

  private async get(id: string): Promise<void> {
    if (!id) {
      console.log(`${c.yellow}Please provide a memory ID.${c.reset}`);
      return;
    }

    const memory = await this.system!.memories.get(id);

    if (!memory) {
      console.log(`${c.red}Memory not found:${c.reset} ${id}`);
      return;
    }

    console.log(`
${c.bold}ID:${c.reset} ${memory.id}
${c.bold}Category:${c.reset} ${memory.category}
${c.bold}Content:${c.reset}
  ${memory.content}
${c.bold}Project:${c.reset} ${memory.project || "none"}
${c.bold}Importance:${c.reset} ${memory.importance}
${c.bold}Created:${c.reset} ${new Date(memory.createdAt).toLocaleString()}
`);
  }

  private async delete(id: string): Promise<void> {
    if (!id) {
      console.log(`${c.yellow}Please provide a memory ID.${c.reset}`);
      return;
    }

    const deleted = await this.system!.memories.delete(id);

    if (deleted) {
      console.log(`${c.green}✓${c.reset} Deleted: ${id}`);
    } else {
      console.log(`${c.red}✗${c.reset} Failed to delete: ${id}`);
    }
  }

  private async status(): Promise<void> {
    const status = await this.system!.getStatus();

    console.log(`
${c.bold}📊 Memory System Status${c.reset}
   Memories: ${status.memoryCount.toLocaleString()}
   Sync: ${status.config.syncEnabled ? (status.syncStatus?.status.state || "enabled") : "disabled"}
   Extraction: ${status.config.autoExtractionEnabled ? "enabled" : "disabled"}
   Queue: ${status.extractionQueue} pending
   Last backup: ${status.lastBackup ? formatAge(status.lastBackup) : "never"}
`);
  }

  private async quit(): Promise<void> {
    this.running = false;
    console.log(`\n${c.dim}👋 Goodbye!${c.reset}\n`);

    if (this.system) {
      await resetMemorySystem();
    }

    this.rl?.close();
    process.exit(0);
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const repl = new MemoryREPL();
  await repl.start();
}

main().catch((err) => {
  console.error(`Fatal error: ${err}`);
  process.exit(1);
});
