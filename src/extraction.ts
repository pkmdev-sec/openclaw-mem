import { Ollama } from "ollama";
import { storeMemory } from "./storage.js";

const EXTRACTION_MODEL = "qwen2.5:7b"; // Fast & accurate on Apple Silicon
const ollama = new Ollama();

interface ExtractedFact {
  content: string;
  category: "decision" | "fact" | "preference" | "solution" | "context";
  project?: string;
  importance: number;
}

interface ExtractionResult {
  facts: ExtractedFact[];
}

const EXTRACTION_PROMPT = `You are a memory extraction system. Analyze the conversation and extract ONLY information worth remembering for future conversations.

Extract these types of information:
- DECISION: Choices made (e.g., "Using LanceDB for vectors")
- FACT: Technical facts learned (e.g., "API rate limit is 100/min")
- PREFERENCE: User preferences (e.g., "Prefers TypeScript")
- SOLUTION: Problems and their solutions (e.g., "Fixed by adding null check")
- CONTEXT: Important project context (e.g., "Working on memory system")

Rules:
1. Only extract meaningful, reusable information
2. Skip greetings, acknowledgments ("ok", "thanks"), and transient info
3. Be concise - each fact should be self-contained
4. Assign importance 1-5 (5 = critical decision, 1 = minor context)
5. If nothing is worth remembering, return empty facts array

Output ONLY valid JSON in this format:
{
  "facts": [
    { "content": "...", "category": "decision|fact|preference|solution|context", "importance": 1-5 }
  ]
}

Conversation to analyze:`;

export async function extractMemories(
  userMessage: string,
  assistantResponse: string,
  project?: string
): Promise<ExtractedFact[]> {
  const conversation = `User: ${userMessage}\n\nAssistant: ${assistantResponse}`;

  try {
    const response = await ollama.generate({
      model: EXTRACTION_MODEL,
      prompt: `${EXTRACTION_PROMPT}\n\n${conversation}`,
      format: "json",
      stream: false,
    });

    const result: ExtractionResult = JSON.parse(response.response);

    // Add project context if provided
    const factsWithProject = result.facts.map((fact) => ({
      ...fact,
      project,
    }));

    console.log(`Extracted ${factsWithProject.length} memories`);
    return factsWithProject;
  } catch (error) {
    console.error("Extraction failed:", error);
    return [];
  }
}

export async function extractAndStore(
  userMessage: string,
  assistantResponse: string,
  project?: string
): Promise<number> {
  const facts = await extractMemories(userMessage, assistantResponse, project);

  for (const fact of facts) {
    await storeMemory({
      content: fact.content,
      category: fact.category,
      project: fact.project,
      importance: fact.importance,
    });
  }

  return facts.length;
}
