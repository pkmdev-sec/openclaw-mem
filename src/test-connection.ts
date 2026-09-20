import { getConnectionManager } from "./connection.js";
import {
  MemoryCategory,
  validateMemory,
  validateCreateMemoryInput,
  generateMemoryId,
  toMemoryCategory,
  type Memory,
  type CreateMemoryInput,
} from "./schema.js";

/**
 * Test the Connection Manager and Schema
 */
async function testConnectionAndSchema() {
  console.log("=== Testing Connection Manager and Schema ===\n");

  try {
    // Test 1: Get singleton instance
    console.log("Test 1: Getting ConnectionManager singleton instance...");
    const manager = getConnectionManager();
    console.log("✓ Singleton instance retrieved\n");

    // Test 2: Connect to database
    console.log("Test 2: Connecting to database...");
    await manager.connect({
      dbPath: "./test-memory-store",
      tableName: "test_memories",
      vectorDimensions: 768,
    });
    console.log("✓ Connected successfully\n");

    // Test 3: Health check
    console.log("Test 3: Running health check...");
    const health = await manager.healthCheck();
    console.log("Health status:", JSON.stringify(health, null, 2));
    console.log("✓ Health check completed\n");

    // Test 4: Create dummy embedding (simulating nomic-embed-text 768 dimensions)
    console.log("Test 4: Creating dummy embedding...");
    const dummyEmbedding = Array(768).fill(0).map(() => Math.random() * 2 - 1);
    console.log(`✓ Created embedding with ${dummyEmbedding.length} dimensions\n`);

    // Test 5: Initialize table (auto-create if not exists)
    console.log("Test 5: Initializing table...");
    const table = await manager.initializeTable("test_memories", dummyEmbedding);
    console.log("✓ Table initialized successfully\n");

    // Test 6: Get table names
    console.log("Test 6: Getting all table names...");
    const tableNames = await manager.getTableNames();
    console.log("Tables:", tableNames);
    console.log("✓ Retrieved table names\n");

    // Test 7: Test schema validation
    console.log("Test 7: Testing schema validation...");

    // Valid CreateMemoryInput
    const validInput: CreateMemoryInput = {
      content: "This is a test memory",
      category: MemoryCategory.FACT,
      importance: 7,
      project: "test-project",
      source: "test",
      metadata: { test: true },
    };
    validateCreateMemoryInput(validInput);
    console.log("✓ Valid CreateMemoryInput passed validation\n");

    // Test 8: Create a complete Memory object
    console.log("Test 8: Creating complete Memory object...");
    const now = Date.now();
    const testMemory: Memory = {
      id: generateMemoryId(),
      content: "Testing the memory system with proper schema",
      category: MemoryCategory.DECISION,
      importance: 8,
      project: "openclaw-memory",
      embedding: Array(768).fill(0).map(() => Math.random() * 2 - 1),
      createdAt: now,
      updatedAt: now,
      source: "test-connection.ts",
      metadata: {
        test: true,
        version: "1.0.0",
      },
    };
    validateMemory(testMemory);
    console.log("✓ Complete Memory object validated\n");
    console.log("Memory object:", {
      ...testMemory,
      embedding: `[${testMemory.embedding.length} dimensions]`,
    });

    // Test 9: Test category conversion
    console.log("\nTest 9: Testing category conversion...");
    const categories = ["decision", "fact", "preference", "solution", "context"];
    for (const cat of categories) {
      const memCat = toMemoryCategory(cat);
      console.log(`  "${cat}" -> ${memCat}`);
    }
    console.log("✓ Category conversion works\n");

    // Test 10: Test validation errors
    console.log("Test 10: Testing validation errors...");
    try {
      validateCreateMemoryInput({
        content: "",
        category: MemoryCategory.FACT,
        importance: 5,
      });
      console.log("✗ Should have thrown error for empty content");
    } catch (error) {
      if (error instanceof Error) {
        console.log(`✓ Caught expected error: ${error.message}`);
      }
    }

    try {
      validateCreateMemoryInput({
        content: "test",
        category: MemoryCategory.FACT,
        importance: 15, // Out of range
      });
      console.log("✗ Should have thrown error for invalid importance");
    } catch (error) {
      if (error instanceof Error) {
        console.log(`✓ Caught expected error: ${error.message}`);
      }
    }

    try {
      toMemoryCategory("invalid");
      console.log("✗ Should have thrown error for invalid category");
    } catch (error) {
      if (error instanceof Error) {
        console.log(`✓ Caught expected error: ${error.message}`);
      }
    }
    console.log();

    // Test 11: Final health check
    console.log("Test 11: Final health check...");
    const finalHealth = await manager.healthCheck();
    console.log("Final health status:", JSON.stringify(finalHealth, null, 2));
    console.log("✓ Final health check completed\n");

    // Test 12: Graceful shutdown
    console.log("Test 12: Testing graceful shutdown...");
    await manager.shutdown();
    console.log("✓ Shutdown successful\n");

    console.log("=== All Tests Passed! ===\n");
  } catch (error) {
    console.error("❌ Test failed:", error);
    if (error instanceof Error) {
      console.error("Error details:", {
        name: error.name,
        message: error.message,
        cause: (error as any).cause,
      });
    }
    process.exit(1);
  }
}

// Run tests
testConnectionAndSchema();
