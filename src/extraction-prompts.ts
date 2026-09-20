import { MemoryCategory } from "./schema.js";

/**
 * Few-shot examples for each memory category
 * These help the LLM understand what kind of information to extract
 */
const CATEGORY_EXAMPLES = {
  decision: [
    "User decided to use LanceDB for vector storage instead of Pinecone",
    "Chose TypeScript over JavaScript for better type safety",
    "Decided to implement extraction using Qwen 2.5 7B model",
  ],
  fact: [
    "The OpenAI API has a rate limit of 3,500 requests per minute",
    "LanceDB stores vectors as Apache Arrow columnar format",
    "Ollama runs models locally without requiring API keys",
  ],
  preference: [
    "User prefers concise code with minimal comments",
    "User wants error messages to be verbose and descriptive",
    "User prefers functional programming style over OOP",
  ],
  solution: [
    "Fixed 'module not found' error by adding .js extension to imports",
    "Resolved timeout issues by increasing the retry delay to 2 seconds",
    "Solved memory leak by clearing the embedding cache after batch operations",
  ],
  context: [
    "Working on Phase 2 of the OpenClaw memory system",
    "Building a smart extraction engine for conversation analysis",
    "Project uses Ollama with Qwen 2.5 7B for local LLM inference",
  ],
};

/**
 * System prompt for extraction task
 * Provides clear instructions and output format
 */
export const SYSTEM_PROMPT = `You are a memory extraction system for an AI assistant. Your job is to analyze conversations and extract ONLY information worth remembering for future conversations.

## What to Extract

Extract these 5 types of information:

1. **DECISION** - Choices, selections, or directions taken
   Examples: ${CATEGORY_EXAMPLES.decision.map((e) => `"${e}"`).join(", ")}

2. **FACT** - Technical facts, specifications, or documented information
   Examples: ${CATEGORY_EXAMPLES.fact.map((e) => `"${e}"`).join(", ")}

3. **PREFERENCE** - User preferences, styles, or tendencies
   Examples: ${CATEGORY_EXAMPLES.preference.map((e) => `"${e}"`).join(", ")}

4. **SOLUTION** - Problems and their solutions, fixes, or workarounds
   Examples: ${CATEGORY_EXAMPLES.solution.map((e) => `"${e}"`).join(", ")}

5. **CONTEXT** - Important project context, goals, or background
   Examples: ${CATEGORY_EXAMPLES.context.map((e) => `"${e}"`).join(", ")}

## Rules

1. **Be selective**: Only extract meaningful, reusable information
2. **Skip noise**: Ignore greetings, acknowledgments ("ok", "thanks", "got it"), and transient info
3. **Be concise**: Each fact should be self-contained and clear (1-2 sentences max)
4. **Assign importance**: Rate 1-10 based on long-term value
   - 9-10: Critical decisions or key technical facts
   - 7-8: Important preferences or significant solutions
   - 5-6: Useful context or minor decisions
   - 3-4: Minor facts or temporary context
   - 1-2: Low-value information (rarely use this)
5. **Extract keywords**: Include 2-5 relevant keywords for searchability
6. **Empty is OK**: If nothing is worth remembering, return empty facts array

## Output Format

Respond with ONLY valid JSON in this exact format:

\`\`\`json
{
  "facts": [
    {
      "content": "Clear, self-contained description of what to remember",
      "category": "decision|fact|preference|solution|context",
      "importance": 5,
      "keywords": ["keyword1", "keyword2", "keyword3"]
    }
  ]
}
\`\`\`

Do not include any text outside the JSON structure.`;

/**
 * Build the extraction prompt with conversation context
 */
export function buildExtractionPrompt(turns: ConversationTurn[]): string {
  const formattedTurns = turns
    .map((turn) => {
      const role = turn.role === "user" ? "User" : "Assistant";
      return `${role}: ${turn.content}`;
    })
    .join("\n\n");

  return `${SYSTEM_PROMPT}

## Conversation to Analyze

${formattedTurns}

## Your Task

Extract memorable information from this conversation in JSON format:`;
}

/**
 * Conversation turn interface
 */
export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Validate that a category is valid
 */
export function isValidCategory(category: string): category is MemoryCategory {
  return Object.values(MemoryCategory).includes(category as MemoryCategory);
}

/**
 * Normalize category string to MemoryCategory enum
 */
export function normalizeCategory(category: string): MemoryCategory {
  const lower = category.toLowerCase().trim();

  // Handle common variations
  const mapping: Record<string, MemoryCategory> = {
    decision: MemoryCategory.DECISION,
    decide: MemoryCategory.DECISION,
    choice: MemoryCategory.DECISION,

    fact: MemoryCategory.FACT,
    facts: MemoryCategory.FACT,
    information: MemoryCategory.FACT,
    info: MemoryCategory.FACT,

    preference: MemoryCategory.PREFERENCE,
    preferences: MemoryCategory.PREFERENCE,
    pref: MemoryCategory.PREFERENCE,
    style: MemoryCategory.PREFERENCE,

    solution: MemoryCategory.SOLUTION,
    solutions: MemoryCategory.SOLUTION,
    fix: MemoryCategory.SOLUTION,
    workaround: MemoryCategory.SOLUTION,

    context: MemoryCategory.CONTEXT,
    background: MemoryCategory.CONTEXT,
    project: MemoryCategory.CONTEXT,
  };

  if (mapping[lower]) {
    return mapping[lower];
  }

  // Fallback to context for unknown categories
  console.warn(`Unknown category '${category}', defaulting to CONTEXT`);
  return MemoryCategory.CONTEXT;
}

/**
 * Schema definition for LLM output
 * Used for validation
 */
export interface ExtractionOutput {
  facts: Array<{
    content: string;
    category: string;
    importance: number;
    keywords: string[];
  }>;
}

/**
 * Validate extraction output structure
 */
export function validateExtractionOutput(
  data: any
): data is ExtractionOutput {
  if (!data || typeof data !== "object") {
    return false;
  }

  if (!Array.isArray(data.facts)) {
    return false;
  }

  for (const fact of data.facts) {
    if (!fact || typeof fact !== "object") {
      return false;
    }

    if (typeof fact.content !== "string" || fact.content.trim().length === 0) {
      return false;
    }

    if (typeof fact.category !== "string" || fact.category.trim().length === 0) {
      return false;
    }

    if (typeof fact.importance !== "number" || fact.importance < 1 || fact.importance > 10) {
      return false;
    }

    if (!Array.isArray(fact.keywords)) {
      return false;
    }

    // Keywords should be strings
    if (!fact.keywords.every((k: any) => typeof k === "string")) {
      return false;
    }
  }

  return true;
}
