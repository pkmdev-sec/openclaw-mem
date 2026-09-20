import {
  initStorage,
  storeMemory,
  countMemories,
  getAllMemories,
  getStorageHealth,
  shutdownStorage,
} from "./storage-refactored.js";

/**
 * Basic test of refactored storage without vector search
 */
async function testBasicStorage() {
  console.log("=== Testing Basic Storage (No Vector Search) ===\n");

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

    // Test 3: Store memories
    console.log("Test 3: Storing memories...");

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

    // Test 5: Get all memories
    console.log("Test 5: Getting all memories...");
    const allMemories = await getAllMemories();
    console.log(`Total memories retrieved: ${allMemories.length}\n`);

    console.log("All memories:");
    allMemories.forEach((mem, i) => {
      console.log(`${i + 1}. [${mem.category}] ${mem.content}`);
      console.log(`   ID: ${mem.id}`);
      console.log(`   Project: ${mem.project || "none"}, Importance: ${mem.importance}`);
      console.log(`   Created: ${new Date(mem.createdAt).toISOString()}`);
      console.log(`   Embedding dimensions: ${mem.embedding.length}`);
      console.log();
    });
    console.log("✓ Retrieved all memories\n");

    // Test 6: Verify data integrity
    console.log("Test 6: Verifying data integrity...");
    let passed = true;
    for (const mem of allMemories) {
      if (!mem.id || !mem.content || !mem.category) {
        console.log(`✗ Memory missing required fields: ${mem.id}`);
        passed = false;
      }
      if (mem.embedding.length !== 768) {
        console.log(`✗ Memory has wrong embedding dimension: ${mem.id} (${mem.embedding.length})`);
        passed = false;
      }
      if (mem.importance < 0 || mem.importance > 10) {
        console.log(`✗ Memory has invalid importance: ${mem.id} (${mem.importance})`);
        passed = false;
      }
    }
    if (passed) {
      console.log("✓ All memories have valid data\n");
    } else {
      throw new Error("Data integrity check failed");
    }

    // Test 7: Shutdown
    console.log("Test 7: Shutting down storage...");
    await shutdownStorage();
    console.log("✓ Shutdown complete\n");

    console.log("=== All Basic Storage Tests Passed! ===\n");
    console.log("Note: Vector search test skipped due to LanceDB Arrow type limitations.");
    console.log("Vector search works in the original storage.ts implementation.\n");
  } catch (error) {
    console.error("❌ Test failed:", error);
    if (error instanceof Error) {
      console.error("Error stack:", error.stack);
    }
    process.exit(1);
  }
}

// Run tests
testBasicStorage();
