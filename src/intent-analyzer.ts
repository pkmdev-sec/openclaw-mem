/**
 * Intent Analyzer Module
 *
 * Analyzes user messages to extract intent, entities, and generate
 * diverse search queries for better memory retrieval.
 *
 * Uses the LLM provider from Phase 2 for consistent retry logic and health checks.
 */

import { LLMProvider, GenerateResponse } from "./llm-provider.js";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Types of user intent detected from messages
 */
export type IntentType =
  | "question"
  | "discussion"
  | "decision"
  | "problem"
  | "reference"
  | "other";

/**
 * Analyzed intent from a user message
 */
export interface Intent {
  /** Main topic of the message */
  mainTopic: string;

  /** Type of intent */
  type: IntentType;

  /** Named entities (projects, tools, concepts, people) */
  entities: string[];

  /** Detected project name if mentioned */
  project?: string;

  /** Temporal context hint */
  temporalContext?: "recent" | "historical" | "all";

  /** Keywords for hybrid search */
  keywords: string[];

  /** Raw analysis confidence (0-1) */
  confidence: number;
}

/**
 * Types of generated queries
 */
export type QueryType =
  | "direct"
  | "related"
  | "technical"
  | "solution"
  | "project";

/**
 * A generated search query with metadata
 */
export interface GeneratedQuery {
  /** The query text */
  text: string;

  /** Type of query */
  type: QueryType;

  /** Importance weight (0-1) for ranking */
  weight: number;
}

/**
 * Search strategy recommendation
 */
export type SearchStrategy = "semantic" | "hybrid" | "keyword";

/**
 * Complete query plan from analysis
 */
export interface QueryPlan {
  /** Analyzed intent */
  intent: Intent;

  /** Generated queries */
  queries: GeneratedQuery[];

  /** Recommended search strategy */
  searchStrategy: SearchStrategy;

  /** Analysis duration in ms */
  analysisDuration: number;
}

/**
 * Options for intent analysis
 */
export interface IntentAnalyzerOptions {
  /** Maximum queries to generate (default: 5) */
  maxQueries?: number;

  /** Minimum query weight to include (default: 0.3) */
  minQueryWeight?: number;

  /** Enable fallback mode if LLM unavailable (default: true) */
  enableFallback?: boolean;

  /** Timeout for LLM call in ms (default: 10000) */
  timeout?: number;
}

// ============================================================================
// PROMPTS
// ============================================================================

const INTENT_ANALYSIS_SYSTEM_PROMPT = `You are a query analysis system for a memory retrieval service. Your job is to analyze user messages and generate diverse search queries to find relevant memories from past conversations.

Analyze the message to extract:
1. Main topic - What is the user asking about?
2. Intent type - Is this a question, discussion, decision, problem, or reference?
3. Entities - Named things like projects, tools, people, concepts
4. Project - If a specific project is mentioned or implied
5. Temporal context - Is this about recent or historical memories?
6. Keywords - Important words for keyword search

Then generate 3-5 diverse search queries:
1. Direct query - Exactly what the user is asking
2. Related concepts query - Related topics that might be relevant
3. Technical terms query - Technical/domain-specific terms
4. Solution query - If it's a problem, how might solutions be phrased
5. Project context query - If there's a project context

Respond ONLY with valid JSON in this exact format:
{
  "mainTopic": "string describing main topic",
  "intentType": "question|discussion|decision|problem|reference|other",
  "entities": ["entity1", "entity2"],
  "project": "project name or null",
  "temporalContext": "recent|historical|all",
  "keywords": ["keyword1", "keyword2"],
  "confidence": 0.0 to 1.0,
  "queries": [
    {"text": "query text", "type": "direct|related|technical|solution|project", "weight": 0.0 to 1.0}
  ]
}`;

// ============================================================================
// INTENT ANALYZER
// ============================================================================

/**
 * Intent Analyzer class
 *
 * Uses LLM to analyze user messages and generate diverse search queries.
 * Includes fallback logic for when LLM is unavailable.
 */
export class IntentAnalyzer {
  private provider: LLMProvider;
  private options: Required<IntentAnalyzerOptions>;

  constructor(provider: LLMProvider, options: IntentAnalyzerOptions = {}) {
    this.provider = provider;
    this.options = {
      maxQueries: options.maxQueries ?? 5,
      minQueryWeight: options.minQueryWeight ?? 0.3,
      enableFallback: options.enableFallback ?? true,
      timeout: options.timeout ?? 10000,
    };
  }

  /**
   * Analyze a user message to extract intent
   */
  async analyze(message: string): Promise<Intent> {
    const plan = await this.generateQueryPlan(message);
    return plan.intent;
  }

  /**
   * Generate a complete query plan for a message
   */
  async generateQueryPlan(message: string): Promise<QueryPlan> {
    const startTime = Date.now();

    // Check if message is too short for analysis
    if (message.length < 10) {
      return this.createFallbackPlan(message, startTime, "Message too short");
    }

    // Try LLM analysis
    try {
      const isAvailable = await this.provider.isAvailable();
      if (!isAvailable) {
        if (this.options.enableFallback) {
          return this.createFallbackPlan(message, startTime, "LLM unavailable");
        }
        throw new Error("LLM provider is not available");
      }

      const response = await this.provider.generate({
        systemPrompt: INTENT_ANALYSIS_SYSTEM_PROMPT,
        prompt: `Analyze this message:\n\n${message}`,
        format: "json",
        maxTokens: 1000,
      });

      const parsed = this.parseAnalysisResponse(response);
      const plan = this.buildQueryPlan(parsed, startTime);

      return this.validateAndFilterPlan(plan);
    } catch (error) {
      // Fallback on any error
      if (this.options.enableFallback) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        return this.createFallbackPlan(message, startTime, errorMsg);
      }
      throw error;
    }
  }

  /**
   * Parse the LLM response into structured data
   */
  private parseAnalysisResponse(response: GenerateResponse): RawAnalysis {
    try {
      const parsed = JSON.parse(response.text);

      return {
        mainTopic: String(parsed.mainTopic || ""),
        intentType: this.validateIntentType(parsed.intentType),
        entities: Array.isArray(parsed.entities)
          ? parsed.entities.map(String)
          : [],
        project: parsed.project ? String(parsed.project) : undefined,
        temporalContext: this.validateTemporalContext(parsed.temporalContext),
        keywords: Array.isArray(parsed.keywords)
          ? parsed.keywords.map(String)
          : [],
        confidence: this.clamp(Number(parsed.confidence) || 0.5, 0, 1),
        queries: this.parseQueries(parsed.queries),
      };
    } catch (error) {
      throw new Error(
        `Failed to parse LLM response: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Parse query array from response
   */
  private parseQueries(
    queries: unknown
  ): Array<{ text: string; type: QueryType; weight: number }> {
    if (!Array.isArray(queries)) {
      return [];
    }

    return queries
      .filter((q) => q && typeof q.text === "string")
      .map((q) => ({
        text: String(q.text),
        type: this.validateQueryType(q.type),
        weight: this.clamp(Number(q.weight) || 0.5, 0, 1),
      }));
  }

  /**
   * Validate intent type
   */
  private validateIntentType(type: unknown): IntentType {
    const validTypes: IntentType[] = [
      "question",
      "discussion",
      "decision",
      "problem",
      "reference",
      "other",
    ];
    return validTypes.includes(type as IntentType)
      ? (type as IntentType)
      : "other";
  }

  /**
   * Validate query type
   */
  private validateQueryType(type: unknown): QueryType {
    const validTypes: QueryType[] = [
      "direct",
      "related",
      "technical",
      "solution",
      "project",
    ];
    return validTypes.includes(type as QueryType)
      ? (type as QueryType)
      : "direct";
  }

  /**
   * Validate temporal context
   */
  private validateTemporalContext(
    context: unknown
  ): "recent" | "historical" | "all" {
    const validContexts = ["recent", "historical", "all"];
    return validContexts.includes(context as string)
      ? (context as "recent" | "historical" | "all")
      : "all";
  }

  /**
   * Build query plan from parsed analysis
   */
  private buildQueryPlan(analysis: RawAnalysis, startTime: number): QueryPlan {
    const intent: Intent = {
      mainTopic: analysis.mainTopic,
      type: analysis.intentType,
      entities: analysis.entities,
      project: analysis.project,
      temporalContext: analysis.temporalContext,
      keywords: analysis.keywords,
      confidence: analysis.confidence,
    };

    const queries: GeneratedQuery[] = analysis.queries.map((q) => ({
      text: q.text,
      type: q.type,
      weight: q.weight,
    }));

    // Determine search strategy
    const searchStrategy = this.determineSearchStrategy(intent, queries);

    return {
      intent,
      queries,
      searchStrategy,
      analysisDuration: Date.now() - startTime,
    };
  }

  /**
   * Determine the best search strategy based on intent
   */
  private determineSearchStrategy(
    intent: Intent,
    queries: GeneratedQuery[]
  ): SearchStrategy {
    // If we have good keywords, use hybrid
    if (intent.keywords.length >= 2) {
      return "hybrid";
    }

    // If it's a technical question, prefer semantic
    if (
      intent.type === "question" ||
      intent.type === "problem" ||
      intent.type === "reference"
    ) {
      return "semantic";
    }

    // Default to hybrid for best coverage
    return "hybrid";
  }

  /**
   * Validate and filter the query plan
   */
  private validateAndFilterPlan(plan: QueryPlan): QueryPlan {
    // Filter queries by minimum weight
    const filteredQueries = plan.queries
      .filter((q) => q.weight >= this.options.minQueryWeight)
      .slice(0, this.options.maxQueries);

    // Ensure we have at least one query
    if (filteredQueries.length === 0 && plan.queries.length > 0) {
      filteredQueries.push(plan.queries[0]);
    }

    // If still no queries, create one from main topic
    if (filteredQueries.length === 0) {
      filteredQueries.push({
        text: plan.intent.mainTopic,
        type: "direct",
        weight: 1.0,
      });
    }

    return {
      ...plan,
      queries: filteredQueries,
    };
  }

  /**
   * Create a fallback plan when LLM is unavailable
   */
  private createFallbackPlan(
    message: string,
    startTime: number,
    reason: string
  ): QueryPlan {
    // Simple heuristic-based analysis
    const words = message.toLowerCase().split(/\s+/);
    const isQuestion =
      message.includes("?") ||
      ["what", "how", "why", "when", "where", "who", "which"].some((w) =>
        message.toLowerCase().startsWith(w)
      );

    // Extract potential project names (capitalized words)
    const projectMatch = message.match(/\b([A-Z][a-zA-Z0-9]+(?:[A-Z][a-zA-Z0-9]+)*)\b/);
    const project = projectMatch ? projectMatch[1] : undefined;

    // Extract keywords (longer words, excluding common stop words)
    const stopWords = new Set([
      "the",
      "a",
      "an",
      "is",
      "are",
      "was",
      "were",
      "be",
      "been",
      "being",
      "have",
      "has",
      "had",
      "do",
      "does",
      "did",
      "will",
      "would",
      "could",
      "should",
      "may",
      "might",
      "must",
      "shall",
      "can",
      "need",
      "dare",
      "ought",
      "used",
      "to",
      "of",
      "in",
      "for",
      "on",
      "with",
      "at",
      "by",
      "from",
      "as",
      "into",
      "through",
      "during",
      "before",
      "after",
      "above",
      "below",
      "between",
      "under",
      "again",
      "further",
      "then",
      "once",
      "here",
      "there",
      "when",
      "where",
      "why",
      "how",
      "all",
      "each",
      "few",
      "more",
      "most",
      "other",
      "some",
      "such",
      "no",
      "nor",
      "not",
      "only",
      "own",
      "same",
      "so",
      "than",
      "too",
      "very",
      "just",
      "and",
      "but",
      "if",
      "or",
      "because",
      "until",
      "while",
      "although",
      "though",
      "this",
      "that",
      "these",
      "those",
      "what",
      "which",
      "who",
      "whom",
    ]);

    const keywords = words
      .filter((w) => w.length > 3 && !stopWords.has(w))
      .slice(0, 5);

    const intent: Intent = {
      mainTopic: message.slice(0, 100),
      type: isQuestion ? "question" : "discussion",
      entities: [],
      project,
      temporalContext: "all",
      keywords,
      confidence: 0.3, // Low confidence for fallback
    };

    // Generate simple queries
    const queries: GeneratedQuery[] = [
      { text: message, type: "direct", weight: 1.0 },
    ];

    // Add keyword-based query if we have keywords
    if (keywords.length >= 2) {
      queries.push({
        text: keywords.join(" "),
        type: "related",
        weight: 0.7,
      });
    }

    // Add project query if detected
    if (project) {
      queries.push({
        text: `${project} ${keywords[0] || ""}`.trim(),
        type: "project",
        weight: 0.6,
      });
    }

    return {
      intent,
      queries,
      searchStrategy: keywords.length >= 2 ? "hybrid" : "semantic",
      analysisDuration: Date.now() - startTime,
    };
  }

  /**
   * Clamp a number between min and max
   */
  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}

// ============================================================================
// INTERNAL TYPES
// ============================================================================

interface RawAnalysis {
  mainTopic: string;
  intentType: IntentType;
  entities: string[];
  project?: string;
  temporalContext: "recent" | "historical" | "all";
  keywords: string[];
  confidence: number;
  queries: Array<{ text: string; type: QueryType; weight: number }>;
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create an intent analyzer with default options
 */
export function createIntentAnalyzer(
  provider: LLMProvider,
  options?: IntentAnalyzerOptions
): IntentAnalyzer {
  return new IntentAnalyzer(provider, options);
}
