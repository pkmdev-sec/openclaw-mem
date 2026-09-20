import { initStorage, countMemories } from "./storage.js";
import { retrieveRelevantMemories, formatMemoriesAsContext } from "./retrieval.js";

// Test queries to demonstrate smart retrieval
const testQueries = [
  "What vector database did we decide to use?",
  "I'm getting timeout errors again",
  "What embedding model works best locally?",
  "How do we handle large file processing?",
  "What's the architecture of the memory system?",
];

async function main() {
  console.log("=".repeat(60));
  console.log("   Smart Retrieval Test");
  console.log("=".repeat(60));

  await initStorage();
  const memCount = await countMemories();
  console.log(`\nLoaded ${memCount} memories\n`);

  if (memCount <= 1) {
    console.log("No memories found! Run the extraction test first:");
    console.log("  npm run extract\n");
    return;
  }

  for (const query of testQueries) {
    console.log("\n" + "=".repeat(60));
    const { memories, analysis } = await retrieveRelevantMemories(query, 3);

    console.log("\n--- Context that would be injected ---");
    const context = formatMemoriesAsContext(memories);
    console.log(context || "(no context)");
  }
}

main().catch(console.error);
