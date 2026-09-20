/**
 * Context Formatter Module
 *
 * Formats retrieved memories into injectable context strings
 * for use in LLM prompts.
 *
 * Features:
 * - Multiple format options (markdown, XML, plain, compact)
 * - Memory grouping (by category, project)
 * - Token-aware truncation
 * - Configurable templates
 */

import { RankedMemory } from "./memory-ranker.js";
import { MemoryCategory } from "./schema.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Available context formats
 */
export type ContextFormat = "markdown" | "xml" | "plain" | "compact";

/**
 * Grouping options for memories
 */
export type GroupBy = "category" | "project" | "none";

/**
 * Options for context formatting
 */
export interface FormatterOptions {
  /** Output format (default: 'markdown') */
  format?: ContextFormat;

  /** Maximum memories to include */
  maxMemories?: number;

  /** Token budget (will truncate to fit) */
  maxTokens?: number;

  /** Show relevance scores */
  includeScores?: boolean;

  /** Show project names */
  includeProject?: boolean;

  /** Show memory category */
  includeCategory?: boolean;

  /** Show when memory was created */
  includeTimestamp?: boolean;

  /** How to group memories */
  groupBy?: GroupBy;

  /** Custom header text */
  header?: string;

  /** Custom footer text */
  footer?: string;
}

/**
 * Result of formatting operation
 */
export interface FormattedContext {
  /** The formatted context string */
  text: string;

  /** Estimated token count */
  estimatedTokens: number;

  /** Number of memories included */
  memoriesIncluded: number;

  /** Whether content was truncated to fit token budget */
  truncated: boolean;
}

/**
 * Default formatter options
 */
export const DEFAULT_FORMATTER_OPTIONS: Required<Omit<FormatterOptions, "maxMemories" | "maxTokens" | "header" | "footer">> & {
  maxMemories: number | undefined;
  maxTokens: number | undefined;
  header: string | undefined;
  footer: string | undefined;
} = {
  format: "markdown",
  maxMemories: undefined,
  maxTokens: undefined,
  includeScores: false,
  includeProject: true,
  includeCategory: true,
  includeTimestamp: false,
  groupBy: "none",
  header: undefined,
  footer: undefined,
};

// ============================================================================
// CONTEXT FORMATTER
// ============================================================================

/**
 * Context Formatter class
 *
 * Formats ranked memories into injectable context strings.
 */
export class ContextFormatter {
  private defaults: Required<Omit<FormatterOptions, "maxMemories" | "maxTokens" | "header" | "footer">> & {
    maxMemories: number | undefined;
    maxTokens: number | undefined;
    header: string | undefined;
    footer: string | undefined;
  };

  constructor(options: FormatterOptions = {}) {
    this.defaults = {
      ...DEFAULT_FORMATTER_OPTIONS,
      ...options,
    };
  }

  /**
   * Format memories into context string
   *
   * @param memories Ranked memories to format
   * @param options Runtime options (override defaults)
   * @returns Formatted context with metadata
   */
  format(
    memories: RankedMemory[],
    options?: FormatterOptions
  ): FormattedContext {
    if (memories.length === 0) {
      return {
        text: "",
        estimatedTokens: 0,
        memoriesIncluded: 0,
        truncated: false,
      };
    }

    const opts = { ...this.defaults, ...options };

    // Apply maxMemories limit first
    let workingMemories = opts.maxMemories
      ? memories.slice(0, opts.maxMemories)
      : memories;

    // Format based on selected format type
    let text: string;
    switch (opts.format) {
      case "xml":
        text = this.formatXml(workingMemories, opts);
        break;
      case "plain":
        text = this.formatPlain(workingMemories, opts);
        break;
      case "compact":
        text = this.formatCompact(workingMemories, opts);
        break;
      case "markdown":
      default:
        text = this.formatMarkdown(workingMemories, opts);
        break;
    }

    // Estimate tokens
    let estimatedTokens = this.estimateTokens(text);

    // Truncate if needed
    let truncated = false;
    if (opts.maxTokens && estimatedTokens > opts.maxTokens) {
      const result = this.truncateToFit(
        workingMemories,
        opts.maxTokens,
        opts
      );
      text = result.text;
      estimatedTokens = result.estimatedTokens;
      workingMemories = result.memories;
      truncated = true;
    }

    return {
      text,
      estimatedTokens,
      memoriesIncluded: workingMemories.length,
      truncated,
    };
  }

  /**
   * Format a single memory
   */
  formatSingle(
    memory: RankedMemory,
    options?: FormatterOptions
  ): string {
    const opts = { ...this.defaults, ...options };

    switch (opts.format) {
      case "xml":
        return this.formatSingleXml(memory, opts);
      case "plain":
        return this.formatSinglePlain(memory, opts);
      case "compact":
        return this.formatSingleCompact(memory, opts);
      case "markdown":
      default:
        return this.formatSingleMarkdown(memory, opts);
    }
  }

  // ============================================================================
  // MARKDOWN FORMAT
  // ============================================================================

  private formatMarkdown(
    memories: RankedMemory[],
    opts: typeof this.defaults
  ): string {
    const lines: string[] = [];

    // Header
    const header = opts.header ?? "## Relevant Context from Previous Conversations";
    lines.push(header);
    lines.push("");

    // Group if requested
    if (opts.groupBy !== "none") {
      const grouped = this.groupMemories(memories, opts.groupBy);
      for (const [group, groupMemories] of Object.entries(grouped)) {
        lines.push(`### ${group}`);
        lines.push("");
        groupMemories.forEach((mem, i) => {
          lines.push(this.formatSingleMarkdown(mem, opts, i + 1));
        });
        lines.push("");
      }
    } else {
      memories.forEach((mem, i) => {
        lines.push(this.formatSingleMarkdown(mem, opts, i + 1));
      });
    }

    // Footer
    if (opts.footer) {
      lines.push("");
      lines.push(opts.footer);
    } else {
      lines.push("");
      lines.push("---");
    }

    return lines.join("\n");
  }

  private formatSingleMarkdown(
    memory: RankedMemory,
    opts: typeof this.defaults,
    index?: number
  ): string {
    const parts: string[] = [];

    // Number
    if (index !== undefined) {
      parts.push(`${index}.`);
    }

    // Category
    if (opts.includeCategory) {
      parts.push(`**[${memory.category.toUpperCase()}]**`);
    }

    // Content
    parts.push(memory.content);

    // Metadata
    const meta: string[] = [];
    if (opts.includeProject && memory.project) {
      meta.push(`project: ${memory.project}`);
    }
    if (opts.includeScores) {
      meta.push(`score: ${memory.finalScore.toFixed(2)}`);
    }
    if (opts.includeTimestamp) {
      const date = new Date(memory.createdAt).toLocaleDateString();
      meta.push(`date: ${date}`);
    }

    if (meta.length > 0) {
      parts.push(`*(${meta.join(", ")})*`);
    }

    return parts.join(" ");
  }

  // ============================================================================
  // XML FORMAT
  // ============================================================================

  private formatXml(
    memories: RankedMemory[],
    opts: typeof this.defaults
  ): string {
    const lines: string[] = [];

    lines.push("<context>");

    // Group if requested
    if (opts.groupBy !== "none") {
      const grouped = this.groupMemories(memories, opts.groupBy);
      for (const [group, groupMemories] of Object.entries(grouped)) {
        lines.push(`  <group name="${this.escapeXml(group)}">`);
        groupMemories.forEach((mem) => {
          lines.push("    " + this.formatSingleXml(mem, opts));
        });
        lines.push("  </group>");
      }
    } else {
      memories.forEach((mem) => {
        lines.push("  " + this.formatSingleXml(mem, opts));
      });
    }

    lines.push("</context>");

    return lines.join("\n");
  }

  private formatSingleXml(
    memory: RankedMemory,
    opts: typeof this.defaults
  ): string {
    const attrs: string[] = [];

    if (opts.includeCategory) {
      attrs.push(`category="${memory.category}"`);
    }
    if (opts.includeProject && memory.project) {
      attrs.push(`project="${this.escapeXml(memory.project)}"`);
    }
    if (opts.includeScores) {
      attrs.push(`score="${memory.finalScore.toFixed(2)}"`);
    }
    if (opts.includeTimestamp) {
      const date = new Date(memory.createdAt).toISOString();
      attrs.push(`date="${date}"`);
    }

    const attrString = attrs.length > 0 ? " " + attrs.join(" ") : "";
    return `<memory${attrString}>${this.escapeXml(memory.content)}</memory>`;
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  // ============================================================================
  // PLAIN FORMAT
  // ============================================================================

  private formatPlain(
    memories: RankedMemory[],
    opts: typeof this.defaults
  ): string {
    const lines: string[] = [];

    // Header
    const header = opts.header ?? "Relevant Context:";
    lines.push(header);
    lines.push("");

    memories.forEach((mem, i) => {
      lines.push(this.formatSinglePlain(mem, opts, i + 1));
    });

    // Footer
    if (opts.footer) {
      lines.push("");
      lines.push(opts.footer);
    }

    return lines.join("\n");
  }

  private formatSinglePlain(
    memory: RankedMemory,
    opts: typeof this.defaults,
    index?: number
  ): string {
    const parts: string[] = [];

    if (index !== undefined) {
      parts.push(`${index}.`);
    }

    if (opts.includeCategory) {
      parts.push(`[${memory.category}]`);
    }

    parts.push(memory.content);

    const meta: string[] = [];
    if (opts.includeProject && memory.project) {
      meta.push(`(${memory.project})`);
    }
    if (opts.includeScores) {
      meta.push(`(score: ${memory.finalScore.toFixed(2)})`);
    }

    parts.push(...meta);

    return parts.join(" ");
  }

  // ============================================================================
  // COMPACT FORMAT
  // ============================================================================

  private formatCompact(
    memories: RankedMemory[],
    opts: typeof this.defaults
  ): string {
    const header = opts.header ?? "Context:";
    const items = memories.map((mem) => this.formatSingleCompact(mem, opts));
    return `${header} ${items.join(" | ")}`;
  }

  private formatSingleCompact(
    memory: RankedMemory,
    opts: typeof this.defaults
  ): string {
    const parts: string[] = [];

    if (opts.includeCategory) {
      parts.push(`[${memory.category}]`);
    }

    // Truncate content for compact format
    const maxContentLength = 80;
    const content =
      memory.content.length > maxContentLength
        ? memory.content.slice(0, maxContentLength - 3) + "..."
        : memory.content;
    parts.push(content);

    return parts.join(" ");
  }

  // ============================================================================
  // GROUPING
  // ============================================================================

  private groupMemories(
    memories: RankedMemory[],
    groupBy: GroupBy
  ): Record<string, RankedMemory[]> {
    const groups: Record<string, RankedMemory[]> = {};

    for (const memory of memories) {
      let key: string;
      switch (groupBy) {
        case "category":
          key = memory.category.charAt(0).toUpperCase() + memory.category.slice(1);
          break;
        case "project":
          key = memory.project || "No Project";
          break;
        default:
          key = "All";
      }

      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(memory);
    }

    return groups;
  }

  // ============================================================================
  // TOKEN ESTIMATION
  // ============================================================================

  /**
   * Estimate token count for text
   * Uses character-based approximation (roughly 4 chars per token)
   */
  estimateTokens(text: string): number {
    // Average across different tokenizers:
    // GPT-4: ~4 chars/token
    // Claude: ~3.5 chars/token
    // We use 3.8 as a conservative estimate
    const CHARS_PER_TOKEN = 3.8;
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  /**
   * Truncate memories to fit within token budget
   */
  private truncateToFit(
    memories: RankedMemory[],
    maxTokens: number,
    opts: typeof this.defaults
  ): { text: string; estimatedTokens: number; memories: RankedMemory[] } {
    // Binary search for optimal number of memories
    let low = 1;
    let high = memories.length;
    let bestResult = {
      text: "",
      estimatedTokens: 0,
      memories: [] as RankedMemory[],
    };

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const subset = memories.slice(0, mid);
      const text = this.formatByType(subset, opts);
      const tokens = this.estimateTokens(text);

      if (tokens <= maxTokens) {
        bestResult = { text, estimatedTokens: tokens, memories: subset };
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return bestResult;
  }

  private formatByType(
    memories: RankedMemory[],
    opts: typeof this.defaults
  ): string {
    switch (opts.format) {
      case "xml":
        return this.formatXml(memories, opts);
      case "plain":
        return this.formatPlain(memories, opts);
      case "compact":
        return this.formatCompact(memories, opts);
      case "markdown":
      default:
        return this.formatMarkdown(memories, opts);
    }
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a context formatter with default options
 */
export function createContextFormatter(
  options?: FormatterOptions
): ContextFormatter {
  return new ContextFormatter(options);
}
