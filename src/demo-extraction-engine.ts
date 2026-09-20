/**
 * Demo script for the OpenClaw Memory Extraction Engine
 * Shows how to extract memories from conversations
 */

import { createExtractionEngine } from "./extraction-engine.js";
import { createOllamaProvider } from "./llm-provider.js";
import { ConversationTurn } from "./extraction-prompts.js";

async function main() {
  console.log("=== OpenClaw Memory Extraction Engine Demo ===\n");

  // Create LLM provider
  console.log("Creating Ollama provider with Qwen 2.5 7B...");
  const provider = createOllamaProvider("qwen2.5:7b");

  // Check if available
  const isAvailable = await provider.isAvailable();
  if (!isAvailable) {
    console.error("Error: Ollama or the model 'qwen2.5:7b' is not available.");
    console.log("Please run: ollama pull qwen2.5:7b");
    process.exit(1);
  }
  console.log("✓ Ollama is ready\n");

  // Create extraction engine
  const engine = createExtractionEngine(provider);

  // Demo 1: Technical Decision
  console.log("Demo 1: Extracting from technical decision conversation");
  console.log("─".repeat(60));
  const demo1: ConversationTurn[] = [
    {
      role: "user",
      content:
        "We need to choose a vector database for our memory system. What do you recommend?",
    },
    {
      role: "assistant",
      content:
        "I recommend LanceDB. It's fast, supports Apache Arrow for efficient storage, and works well with local embeddings. Plus, it doesn't require a separate server process.",
    },
  ];

  console.log("User:", demo1[0].content);
  console.log("Assistant:", demo1[1].content);
  console.log("\nExtracting memories...");
  const result1 = await engine.extract(demo1);
  console.log(`Extracted ${result1.facts.length} memories in ${result1.duration}ms:`);
  result1.facts.forEach((fact, i) => {
    console.log(
      `  ${i + 1}. [${fact.category}] ${fact.content} (importance: ${fact.importance}/10)`
    );
    console.log(`     Keywords: ${fact.keywords.join(", ")}`);
  });

  // Demo 2: User Preference
  console.log("\n\nDemo 2: Extracting user preferences");
  console.log("─".repeat(60));
  const demo2: ConversationTurn[] = [
    {
      role: "user",
      content:
        "I prefer code with detailed inline comments explaining the why, not just the what.",
    },
    {
      role: "assistant",
      content:
        "Understood! I'll make sure to add explanatory comments that explain the reasoning and context behind code decisions.",
    },
  ];

  console.log("User:", demo2[0].content);
  console.log("Assistant:", demo2[1].content);
  console.log("\nExtracting memories...");
  const result2 = await engine.extract(demo2);
  console.log(`Extracted ${result2.facts.length} memories in ${result2.duration}ms:`);
  result2.facts.forEach((fact, i) => {
    console.log(
      `  ${i + 1}. [${fact.category}] ${fact.content} (importance: ${fact.importance}/10)`
    );
    console.log(`     Keywords: ${fact.keywords.join(", ")}`);
  });

  // Demo 3: Problem and Solution
  console.log("\n\nDemo 3: Extracting problem-solution pair");
  console.log("─".repeat(60));
  const demo3: ConversationTurn[] = [
    {
      role: "user",
      content:
        "I keep getting 'module not found' errors when running TypeScript with ES modules.",
    },
    {
      role: "assistant",
      content:
        "You need to add .js extensions to your import statements even in TypeScript files. This is required for ES modules. For example, use `import { foo } from './bar.js'` instead of `import { foo } from './bar'`.",
    },
  ];

  console.log("User:", demo3[0].content);
  console.log("Assistant:", demo3[1].content);
  console.log("\nExtracting memories...");
  const result3 = await engine.extract(demo3);
  console.log(`Extracted ${result3.facts.length} memories in ${result3.duration}ms:`);
  result3.facts.forEach((fact, i) => {
    console.log(
      `  ${i + 1}. [${fact.category}] ${fact.content} (importance: ${fact.importance}/10)`
    );
    console.log(`     Keywords: ${fact.keywords.join(", ")}`);
  });

  // Demo 4: Pre-filtering (should skip)
  console.log("\n\nDemo 4: Pre-filtering test (should skip extraction)");
  console.log("─".repeat(60));
  const demo4: ConversationTurn[] = [
    { role: "user", content: "ok" },
    { role: "assistant", content: "thanks" },
  ];

  console.log("User:", demo4[0].content);
  console.log("Assistant:", demo4[1].content);
  console.log("\nExtracting memories...");
  const result4 = await engine.extract(demo4);
  if (result4.skipped) {
    console.log("✓ Correctly skipped (no meaningful content)");
  } else {
    console.log(`Extracted ${result4.facts.length} memories`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("Demo complete!");
}

main().catch((error) => {
  console.error("Demo failed:", error);
  process.exit(1);
});
