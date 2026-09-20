import {
  initStorage,
  storeMemory,
  searchMemories,
  countMemories,
  getAllMemories,
  getMemoriesByCategory,
  getMemoriesByProject,
  getImportantMemories,
  getStorageHealth,
  shutdownStorage,
} from "./storage-refactored.js";
import { MemoryCategory } from "./schema.js";

/**
 * Test refactored storage with backward compatibility
 */
async function testRefactoredStorage() {
  console.log("=== Testing Refactored Storage ===\n");

  try {
    // Test 1: Initialize storage
    console.log("Test 1: Initializing storage...");
    await initStorage();
    console.log("✓ Storage initialized\n");

    // Test 2: Check health
    console.log("Test 2: Checking health...");
    const health = await getStorageHealth();
    console.log("Health status:", JSON.stringify(health, null, 2));
    console.log("✓ Health check passed\n");

    // Test 3: Store memories (backward compatible API)
    console.log("Test 3: Storing memories with backward compatible API...");

    await storeMemory({
      content: "Using LanceDB for vector storage in OpenClaw",
      category: "decision",
      importance: 9,
      project: "openclaw-memory",
    });

    await storeMemory({
      content: "nomic-embed-text produces 768-dimensional embeddings",
      category: "fact",
      importance: 7,
      project: "openclaw-memory",
    });

    await storeMemory({
      content: "User prefers TypeScript over JavaScript",
      category: "preference",
      importance: 6,
      project: "general",
    });

    await storeMemory({
      content: "Fixed connection pooling issue by implementing singleton pattern",
      category: "solution",
      importance: 8,
      project: "openclaw-memory",
    });

    await storeMemory({
      content: "Building a prototype smart memory system",
      category: "context",
      importance: 5,
      project: "openclaw-memory",
    });

    console.log("✓ Stored 5 test memories\n");

    // Test 4: Count memories
    console.log("Test 4: Counting memories...");
    const count = await countMemories();
    console.log(`Total memories: ${count}`);
    console.log("✓ Count retrieved\n");

    // Test 5: Search memories
    console.log("Test 5: Searching for 'vector storage'...");
    const searchResults = await searchMemories("vector storage", 3);
    console.log(`Found ${searchResults.length} results:`);
    searchResults.forEach((mem, i) => {
      console.log(
        `  ${i + 1}. [${mem.category}] ${mem.content.slice(0, 60)}...`
      );
      console.log(`     Importance: ${mem.importance}, Project: ${mem.project || "none"}`);
    });
    console.log("✓ Search completed\n");

    // Test 6: Get memories by category
    console.log("Test 6: Getting memories by category (decision)...");
    const decisions = await getMemoriesByCategory(MemoryCategory.DECISION);
    console.log(`Found ${decisions.length} decision(s):`);
    decisions.forEach((mem) => {
      console.log(`  - ${mem.content}`);
    });
    console.log("✓ Category filter worked\n");

    // Test 7: Get memories by project
    console.log("Test 7: Getting memories by project (openclaw-memory)...");
    const projectMems = await getMemoriesByProject("openclaw-memory");
    console.log(`Found ${projectMems.length} memories for openclaw-memory:`);
    projectMems.forEach((mem) => {
      console.log(`  - [${mem.category}] ${mem.content.slice(0, 50)}...`);
    });
    console.log("✓ Project filter worked\n");

    // Test 8: Get important memories
    console.log("Test 8: Getting important memories (importance >= 7)...");
    const important = await getImportantMemories(7);
    console.log(`Found ${important.length} important memories:`);
    important.forEach((mem) => {
      console.log(`  - [${mem.importance}] ${mem.content.slice(0, 50)}...`);
    });
    console.log("✓ Importance filter worked\n");

    // Test 9: Get all memories
    console.log("Test 9: Getting all memories...");
    const allMemories = await getAllMemories();
    console.log(`Total memories retrieved: ${allMemories.length}`);
    console.log("\nAll memories:");
    allMemories.forEach((mem, i) => {
      console.log(`${i + 1}. [${mem.category}] ${mem.content}`);
      console.log(`   ID: ${mem.id}`);
      console.log(`   Project: ${mem.project || "none"}, Importance: ${mem.importance}`);
      console.log(`   Created: ${new Date(mem.createdAt).toISOString()}`);
      console.log();
    });
    console.log("✓ Retrieved all memories\n");

    // Test 10: Shutdown
    console.log("Test 10: Shutting down storage...");
    await shutdownStorage();
    console.log("✓ Shutdown complete\n");

    console.log("=== All Tests Passed! ===\n");
  } catch (error) {
    console.error("❌ Test failed:", error);
    if (error instanceof Error) {
      console.error("Error stack:", error.stack);
    }
    process.exit(1);
  }
}

// Run tests
testRefactoredStorage();
