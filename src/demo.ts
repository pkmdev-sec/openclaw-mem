import * as readline from "readline";
import { initStorage, countMemories, getAllMemories } from "./storage.js";
import { extractAndStore } from "./extraction.js";
import { retrieveRelevantMemories, formatMemoriesAsContext } from "./retrieval.js";
import { Ollama } from "ollama";

const CHAT_MODEL = "qwen2.5:7b";
const ollama = new Ollama();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function chat(userMessage: string, context: string): Promise<string> {
  const systemPrompt = `You are a helpful AI assistant. Use the provided context from previous conversations to give informed responses.

${context}`;

  const response = await ollama.chat({
    model: CHAT_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    stream: false,
  });

  return response.message.content;
}

async function main() {
  console.log("=".repeat(60));
  console.log("   OpenClaw Memory Prototype - Interactive Demo");
  console.log("=".repeat(60));
  console.log("\nInitializing storage...");

  await initStorage();

  const memCount = await countMemories();
  console.log(`Loaded ${memCount} existing memories\n`);

  console.log("Commands:");
  console.log("  /memories - Show all stored memories");
  console.log("  /search <query> - Test retrieval for a query");
  console.log("  /clear - Start fresh (doesn't delete memories)");
  console.log("  /quit - Exit\n");

  const currentProject = await prompt("Project name (or press Enter for none): ");
  console.log(`\nProject: ${currentProject || "(none)"}\n`);

  console.log("Start chatting! Memories are extracted automatically.\n");
  console.log("-".repeat(60));

  while (true) {
    const userInput = await prompt("\nYou: ");

    if (userInput.toLowerCase() === "/quit") {
      console.log("\nGoodbye!");
      break;
    }

    if (userInput.toLowerCase() === "/memories") {
      const memories = await getAllMemories();
      console.log(`\n--- All Memories (${memories.length}) ---`);
      memories.forEach((mem, i) => {
        console.log(`${i + 1}. [${mem.category}] ${mem.content}`);
        console.log(`   Project: ${mem.project || "none"}, Importance: ${mem.importance}`);
      });
      continue;
    }

    if (userInput.toLowerCase().startsWith("/search ")) {
      const query = userInput.slice(8);
      await retrieveRelevantMemories(query, 5);
      continue;
    }

    if (userInput.toLowerCase() === "/clear") {
      console.log("\n(Memory persists, but you can start a fresh conversation)");
      continue;
    }

    // Step 1: Retrieve relevant memories
    console.log("\n[Retrieving relevant context...]");
    const { memories, analysis } = await retrieveRelevantMemories(userInput, 5);
    const context = formatMemoriesAsContext(memories);

    if (memories.length > 0) {
      console.log(`\n[Found ${memories.length} relevant memories]`);
    } else {
      console.log("\n[No relevant memories found]");
    }

    // Step 2: Generate response with context
    console.log("\n[Generating response...]");
    const response = await chat(userInput, context);
    console.log(`\nAssistant: ${response}`);

    // Step 3: Extract and store memories (background simulation)
    console.log("\n[Extracting memories in background...]");
    const extracted = await extractAndStore(
      userInput,
      response,
      currentProject || undefined
    );
    console.log(`[Stored ${extracted} new memories]`);
  }

  rl.close();
}

main().catch(console.error);
