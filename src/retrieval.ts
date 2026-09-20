import { Ollama } from "ollama";
import { searchMemories, Memory } from "./storage.js";

const ANALYSIS_MODEL = "qwen2.5:7b";
const ollama = new Ollama();

interface QueryAnalysis {
  queries: string[];
  mainTopic: string;
  project?: string;
  intent: string;
}

const ANALYSIS_PROMPT = `You are a query analysis system. Analyze the user's message and generate search queries to find relevant memories.

Generate 3-5 diverse search queries that would help find related past conversations:
1. Direct topic query
2. Related concepts query
3. Technical terms query
4. Problem/solution query (if applicable)
5. Project context query (if applicable)

Output ONLY valid JSON:
{
  "queries": ["query1", "query2", "query3"],
  "mainTopic": "main topic of the message",
  "project": "project name if mentioned or inferred, null otherwise",
  "intent": "what the user is trying to do"
}

User message:`;

export async function analyzeQuery(message: string): Promise<QueryAnalysis> {
  try {
    const response = await ollama.generate({
      model: ANALYSIS_MODEL,
      prompt: `${ANALYSIS_PROMPT}\n\n${message}`,
      format: "json",
      stream: false,
    });

    return JSON.parse(response.response);
  } catch (error) {
    console.error("Query analysis failed:", error);
    // Fallback to simple analysis
    return {
      queries: [message],
      mainTopic: message.slice(0, 50),
      intent: "unknown",
    };
  }
}

interface RankedMemory extends Memory {
  finalScore: number;
  semanticScore: number;
  recencyScore: number;
  projectBonus: number;
}

function calculateRecencyScore(createdAt: number): number {
  const daysSince = (Date.now() - createdAt) / (1000 * 60 * 60 * 24);
  return 1 / (1 + daysSince * 0.1);
}

function rankMemories(
  memories: Memory[],
  targetProject?: string
): RankedMemory[] {
  const seen = new Set<string>();
  const unique: Memory[] = [];

  // Deduplicate by content
  for (const mem of memories) {
    if (!seen.has(mem.content)) {
      seen.add(mem.content);
      unique.push(mem);
    }
  }

  // Calculate scores
  const ranked: RankedMemory[] = unique.map((mem, index) => {
    // LanceDB returns results sorted by similarity, so we estimate score from position
    const semanticScore = 1 - index * 0.05;
    const recencyScore = calculateRecencyScore(mem.createdAt);
    const projectBonus =
      targetProject && mem.project === targetProject ? 0.3 : 0;

    const finalScore =
      semanticScore * 0.5 + recencyScore * 0.2 + projectBonus;

    return {
      ...mem,
      finalScore,
      semanticScore,
      recencyScore,
      projectBonus,
    };
  });

  // Sort by final score
  return ranked.sort((a, b) => b.finalScore - a.finalScore);
}

export async function retrieveRelevantMemories(
  message: string,
  limit = 5
): Promise<{ memories: RankedMemory[]; analysis: QueryAnalysis }> {
  console.log("\n--- Smart Retrieval ---");
  console.log(`Input: "${message}"`);

  // Step 1: Analyze the query
  console.log("\nStep 1: Analyzing intent...");
  const analysis = await analyzeQuery(message);
  console.log(`  Topic: ${analysis.mainTopic}`);
  console.log(`  Intent: ${analysis.intent}`);
  console.log(`  Project: ${analysis.project || "none"}`);
  console.log(`  Queries: ${analysis.queries.join(", ")}`);

  // Step 2: Multi-query search
  console.log("\nStep 2: Searching memories...");
  const allResults: Memory[] = [];

  for (const query of analysis.queries) {
    const results = await searchMemories(query, limit * 2);
    allResults.push(...results);
    console.log(`  "${query}" -> ${results.length} results`);
  }

  // Step 3: Rank and deduplicate
  console.log("\nStep 3: Ranking results...");
  const ranked = rankMemories(allResults, analysis.project ?? undefined);
  const topResults = ranked.slice(0, limit);

  console.log(`\nTop ${topResults.length} memories:`);
  topResults.forEach((mem, i) => {
    console.log(
      `  ${i + 1}. [${mem.category}] ${mem.content.slice(0, 60)}... (score: ${mem.finalScore.toFixed(3)})`
    );
  });

  return { memories: topResults, analysis };
}

export function formatMemoriesAsContext(memories: RankedMemory[]): string {
  if (memories.length === 0) {
    return "";
  }

  const lines = [
    "## Relevant Context from Previous Conversations\n",
    ...memories.map(
      (mem, i) =>
        `${i + 1}. [${mem.category.toUpperCase()}] ${mem.content}${mem.project ? ` (project: ${mem.project})` : ""}`
    ),
    "\n---\n",
  ];

  return lines.join("\n");
}
