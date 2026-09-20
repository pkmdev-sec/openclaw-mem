import { initStorage, countMemories, getAllMemories } from "./storage.js";
import { extractAndStore } from "./extraction.js";

// Sample conversations to test extraction
const testConversations = [
  {
    user: "I'm working on the OpenClaw memory system. Should we use LanceDB or Qdrant for vector storage?",
    assistant:
      "Based on your requirements (self-hosted, edge-first, MacBook Pro), I recommend LanceDB. It's embedded, file-based which syncs well with Syncthing, and handles millions of vectors efficiently. Qdrant would require running a separate server.",
    project: "openclaw-memory",
  },
  {
    user: "What embedding model should I use for the memory system?",
    assistant:
      "For local inference on Apple Silicon, I recommend using nomic-embed-text via Ollama. It produces 768-dimensional embeddings, runs efficiently on M-series chips, and has good performance on semantic similarity tasks.",
    project: "openclaw-memory",
  },
  {
    user: "The API keeps timing out when I try to process large files",
    assistant:
      "The timeout issue is likely due to the default 30-second limit. You can fix this by setting TIMEOUT_MS=120000 in your environment variables, or by chunking large files into smaller pieces before processing.",
    project: "openclaw-memory",
  },
  {
    user: "I prefer TypeScript over JavaScript for this project",
    assistant:
      "Got it! I'll use TypeScript for all code examples and implementations. TypeScript's type safety will help catch errors early, especially useful for a complex system like memory management.",
    project: "openclaw-memory",
  },
  {
    user: "Thanks, that's helpful",
    assistant: "You're welcome! Let me know if you have any other questions.",
    project: "openclaw-memory",
  },
];

async function main() {
  console.log("=".repeat(60));
  console.log("   Memory Extraction Test");
  console.log("=".repeat(60));

  await initStorage();
  const beforeCount = await countMemories();
  console.log(`\nMemories before: ${beforeCount}\n`);

  for (const conv of testConversations) {
    console.log("-".repeat(60));
    console.log(`User: ${conv.user.slice(0, 60)}...`);
    console.log(`Assistant: ${conv.assistant.slice(0, 60)}...`);

    const extracted = await extractAndStore(
      conv.user,
      conv.assistant,
      conv.project
    );
    console.log(`-> Extracted ${extracted} memories\n`);
  }

  const afterCount = await countMemories();
  console.log("=".repeat(60));
  console.log(`Total memories: ${beforeCount} -> ${afterCount}`);
  console.log(`New memories added: ${afterCount - beforeCount}`);

  console.log("\n--- All Stored Memories ---");
  const all = await getAllMemories();
  all
    .filter((m) => m.id !== "init")
    .forEach((mem, i) => {
      console.log(`\n${i + 1}. [${mem.category.toUpperCase()}] ${mem.content}`);
      console.log(`   Project: ${mem.project || "none"}, Importance: ${mem.importance}/5`);
    });
}

main().catch(console.error);
