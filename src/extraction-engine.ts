import { LLMProvider, NullProvider } from "./llm-provider.js";
import {
  ConversationTurn,
  buildExtractionPrompt,
  validateExtractionOutput,
  normalizeCategory,
  ExtractionOutput,
} from "./extraction-prompts.js";
import { MemoryCategory } from "./schema.js";
import { createMemories } from "./crud.js";

/**
 * Result from extracting facts from a conversation
 */
export interface ExtractionResult {
  facts: Array<{
    content: string;
    category: MemoryCategory;
    importance: number;
    keywords: string[];
  }>;
  skipped: boolean;
  duration: number;
}

/**
 * Configuration for extraction engine
 */
export interface ExtractionEngineConfig {
  provider: LLMProvider;
  minMessageLength?: number; // Skip messages shorter than this
  skipPatterns?: RegExp[]; // Skip messages matching these patterns
  maxRetries?: number;
}

/**
 * Default patterns for filtering out non-extractable messages
 */
const DEFAULT_SKIP_PATTERNS = [
  /^(ok|okay|sure|yes|no|thanks|thank you|got it|noted)$/i,
  /^(hi|hello|hey|goodbye|bye)$/i,
  /^\s*$/,
];

/**
 * ExtractionEngine - Core engine for extracting memories from conversations
 *
 * Features:
 * - Pre-filtering to skip obvious non-content
 * - LLM-based extraction with structured output
 * - Post-processing and validation
 * - Graceful fallback when LLM unavailable
 */
export class ExtractionEngine {
  private config: Required<ExtractionEngineConfig>;

  constructor(config: ExtractionEngineConfig) {
    this.config = {
      provider: config.provider,
      minMessageLength: config.minMessageLength ?? 10,
      skipPatterns: config.skipPatterns ?? DEFAULT_SKIP_PATTERNS,
      maxRetries: config.maxRetries ?? 3,
    };
  }

  /**
   * Pre-filter: Check if conversation is worth processing
   */
  private shouldSkip(turns: ConversationTurn[]): boolean {
    // No turns to process
    if (turns.length === 0) {
      return true;
    }

    // Check if all turns are too short or match skip patterns
    const substantiveTurns = turns.filter((turn) => {
      // Too short
      if (turn.content.length < this.config.minMessageLength) {
        return false;
      }

      // Matches skip pattern
      const trimmed = turn.content.trim();
      if (this.config.skipPatterns.some((pattern) => pattern.test(trimmed))) {
        return false;
      }

      return true;
    });

    // No substantive content found
    return substantiveTurns.length === 0;
  }

  /**
   * Post-process: Validate and normalize extracted facts
   */
  private postProcess(rawOutput: any): ExtractionOutput {
    // Validate structure
    if (!validateExtractionOutput(rawOutput)) {
      console.warn("Invalid extraction output, returning empty result");
      return { facts: [] };
    }

    // Normalize categories and filter invalid facts
    const normalizedFacts = rawOutput.facts
      .map((fact: any) => ({
        content: fact.content.trim(),
        category: normalizeCategory(fact.category),
        importance: Math.max(1, Math.min(10, Math.round(fact.importance))),
        keywords: fact.keywords
          .map((k: string) => k.trim().toLowerCase())
          .filter((k: string) => k.length > 0)
          .slice(0, 10), // Max 10 keywords
      }))
      .filter((fact: any) => fact.content.length > 0); // Remove empty content

    return { facts: normalizedFacts };
  }

  /**
   * Extract memories from conversation turns
   * Returns structured facts ready for storage
   */
  async extract(turns: ConversationTurn[]): Promise<ExtractionResult> {
    const startTime = Date.now();

    try {
      // Pre-filter: Skip if no meaningful content
      if (this.shouldSkip(turns)) {
        return {
          facts: [],
          skipped: true,
          duration: Date.now() - startTime,
        };
      }

      // Check if provider is available
      const isAvailable = await this.config.provider.isAvailable();
      if (!isAvailable) {
        console.warn("LLM provider unavailable, skipping extraction");
        return {
          facts: [],
          skipped: true,
          duration: Date.now() - startTime,
        };
      }

      // Build prompt
      const prompt = buildExtractionPrompt(turns);

      // Call LLM
      const response = await this.config.provider.generate({
        prompt,
        format: "json",
      });

      // Parse JSON response
      let parsed: any;
      try {
        parsed = JSON.parse(response.text);
      } catch (error) {
        console.error("Failed to parse LLM response as JSON:", response.text);
        return {
          facts: [],
          skipped: false,
          duration: Date.now() - startTime,
        };
      }

      // Post-process
      const processed = this.postProcess(parsed);

      return {
        facts: processed.facts.map((fact) => ({
          content: fact.content,
          category: fact.category as MemoryCategory,
          importance: fact.importance,
          keywords: fact.keywords,
        })),
        skipped: false,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      console.error("Extraction failed:", error);
      return {
        facts: [],
        skipped: false,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Extract and store memories in one operation
   * Convenience method that combines extraction + database insertion
   *
   * @param turns - Conversation turns to extract from
   * @param project - Optional project name to tag memories with
   * @returns Number of memories stored
   */
  async extractAndStore(
    turns: ConversationTurn[],
    project?: string
  ): Promise<{ stored: number; duration: number }> {
    const startTime = Date.now();

    try {
      // Extract facts
      const result = await this.extract(turns);

      if (result.skipped || result.facts.length === 0) {
        return { stored: 0, duration: Date.now() - startTime };
      }

      // Prepare memories for storage
      const memoriesToStore = result.facts.map((fact) => ({
        content: fact.content,
        category: fact.category,
        importance: fact.importance,
        project,
      }));

      // Store in batch
      const { data: memories } = await createMemories(memoriesToStore);

      return {
        stored: memories.length,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      console.error("Extract and store failed:", error);
      return { stored: 0, duration: Date.now() - startTime };
    }
  }

  /**
   * Get the underlying LLM provider
   */
  getProvider(): LLMProvider {
    return this.config.provider;
  }

  /**
   * Update the LLM provider (useful for switching models)
   */
  setProvider(provider: LLMProvider): void {
    this.config.provider = provider;
  }
}

/**
 * Factory function to create extraction engine with default settings
 */
export function createExtractionEngine(
  provider: LLMProvider,
  overrides?: Partial<ExtractionEngineConfig>
): ExtractionEngine {
  return new ExtractionEngine({
    provider,
    minMessageLength: 10,
    skipPatterns: DEFAULT_SKIP_PATTERNS,
    maxRetries: 3,
    ...overrides,
  });
}

/**
 * Create extraction engine with null provider (for testing)
 */
export function createNullExtractionEngine(): ExtractionEngine {
  return createExtractionEngine(new NullProvider());
}

/**
 * Convenience function for quick extraction from user/assistant pair
 */
export async function extractFromPair(
  provider: LLMProvider,
  userMessage: string,
  assistantResponse: string,
  project?: string
): Promise<ExtractionResult> {
  const engine = createExtractionEngine(provider);

  const turns: ConversationTurn[] = [
    { role: "user", content: userMessage },
    { role: "assistant", content: assistantResponse },
  ];

  return engine.extract(turns);
}

/**
 * Convenience function for quick extraction and storage
 */
export async function extractAndStoreFromPair(
  provider: LLMProvider,
  userMessage: string,
  assistantResponse: string,
  project?: string
): Promise<number> {
  const engine = createExtractionEngine(provider);

  const turns: ConversationTurn[] = [
    { role: "user", content: userMessage },
    { role: "assistant", content: assistantResponse },
  ];

  const result = await engine.extractAndStore(turns, project);
  return result.stored;
}
