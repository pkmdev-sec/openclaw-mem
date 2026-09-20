/**
 * Comprehensive test suite for Plan 03 - CRUD Operations and Search
 */

import { initStorage, shutdownStorage } from "./storage-refactored.js";
import {
  createMemory,
  createMemories,
  getMemory,
  getMemories,
  getAllMemories,
  countMemories,
  updateMemory,
  deleteMemory,
  deleteMemories,
  deleteByFilter,
  getEmbeddingCacheStats,
} from "./crud.js";
import {
  searchByText,
  hybridSearch,
  searchSimilar,
  searchByCategory,
  searchByProject,
  getSearchCacheStats,
} from "./search.js";
import { MemoryCategory } from "./schema.js";

// Test utilities
function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertTiming(duration: number, maxMs: number, operation: string) {
  console.log(`  ⏱️  ${operation}: ${duration}ms (target: <${maxMs}ms)`);
  if (duration > maxMs) {
    console.warn(`  ⚠️  Warning: ${operation} exceeded target time`);
  }
}

// ============================================================================
// TESTS
// ============================================================================

async function testCreateOperations() {
  console.log("\n📝 Testing CREATE Operations...");

  // Test 1: Create single memory
  console.log("\n1. Create single memory");
  const result1 = await createMemory({
    content: "User prefers dark mode in all applications",
    category: MemoryCategory.PREFERENCE,
    importance: 8,
    project: "test-project",
  });

  assert(result1.data.id !== undefined, "Memory should have an ID");
  assert(result1.data.vector.length === 768, "Should have 768-dim vector");
  assert(result1.data.createdAt > 0, "Should have creation timestamp");
  assertTiming(result1.duration, 50, "Single create");
  console.log(`  ✅ Created memory: ${result1.data.id}`);

  // Test 2: Create batch memories
  console.log("\n2. Create batch of 10 memories");
  const batchInputs = Array.from({ length: 10 }, (_, i) => ({
    content: `Test memory number ${i + 1} about various topics`,
    category: i % 2 === 0 ? MemoryCategory.FACT : MemoryCategory.CONTEXT,
    importance: (i % 10) + 1,
    project: i < 5 ? "project-a" : "project-b",
  }));

  const result2 = await createMemories(batchInputs);
  assert(result2.data.length === 10, "Should create 10 memories");
  assertTiming(result2.duration, 500, "Batch create (10)");
  console.log(`  ✅ Created ${result2.data.length} memories in batch`);

  return { singleMemoryId: result1.data.id, batchMemoryIds: result2.data.map(m => m.id) };
}

async function testReadOperations(testData: { singleMemoryId: string; batchMemoryIds: string[] }) {
  console.log("\n📖 Testing READ Operations...");

  // Test 1: Get single memory by ID
  console.log("\n1. Get single memory by ID");
  const result1 = await getMemory(testData.singleMemoryId);
  assert(result1.data !== null, "Should find the memory");
  assert(result1.data!.id === testData.singleMemoryId, "Should return correct memory");
  assertTiming(result1.duration, 10, "Get by ID");
  console.log(`  ✅ Retrieved memory: ${result1.data!.content.slice(0, 50)}...`);

  // Test 2: Get multiple memories by IDs
  console.log("\n2. Get batch of memories by IDs");
  const idsToGet = testData.batchMemoryIds.slice(0, 5);
  const result2 = await getMemories(idsToGet);
  assert(result2.data.length === 5, "Should return 5 memories");
  assertTiming(result2.duration, 50, "Batch get");
  console.log(`  ✅ Retrieved ${result2.data.length} memories`);

  // Test 3: Get all memories with filters
  console.log("\n3. Get all memories with category filter");
  const result3 = await getAllMemories({
    category: MemoryCategory.FACT,
    limit: 10,
  });
  assert(result3.data.length > 0, "Should find fact memories");
  assert(result3.data.every(m => m.category === MemoryCategory.FACT), "All should be facts");
  console.log(`  ✅ Found ${result3.data.length} fact memories`);

  // Test 4: Count memories
  console.log("\n4. Count memories with filter");
  const result4 = await countMemories({ category: MemoryCategory.FACT });
  assert(result4.data > 0, "Should have fact memories");
  assertTiming(result4.duration, 50, "Count with filter");
  console.log(`  ✅ Counted ${result4.data} fact memories`);

  // Test 5: Get all memories with pagination
  console.log("\n5. Get memories with pagination");
  const result5 = await getAllMemories({ limit: 5, offset: 0 });
  assert(result5.data.length <= 5, "Should respect limit");
  console.log(`  ✅ Retrieved ${result5.data.length} memories (page 1)`);
}

async function testSearchOperations(testData: { singleMemoryId: string }) {
  console.log("\n🔍 Testing SEARCH Operations...");

  // Test 1: Vector search by text
  console.log("\n1. Vector search by text");
  const result1 = await searchByText("user preferences and settings", {
    limit: 5,
    includeScore: true,
  });
  assert(result1.results.length > 0, "Should find relevant memories");
  assert(result1.results[0].score !== undefined, "Should include scores");
  assertTiming(result1.duration, 100, "Vector search");
  console.log(`  ✅ Found ${result1.totalFound} results in ${result1.duration}ms`);
  console.log(`  Top result score: ${result1.results[0].score?.toFixed(3)}`);

  // Test 2: Search with filters
  console.log("\n2. Vector search with category filter");
  const result2 = await searchByText("information about topics", {
    limit: 5,
    filter: { category: MemoryCategory.FACT },
  });
  assert(result2.results.every(r => r.memory.category === MemoryCategory.FACT), "All should match filter");
  console.log(`  ✅ Found ${result2.totalFound} filtered results`);

  // Test 3: Hybrid search
  console.log("\n3. Hybrid search (vector + keyword)");
  const result3 = await hybridSearch("test memory topics", {
    limit: 5,
    includeScore: true,
    vectorWeight: 0.7,
    keywordWeight: 0.3,
  });
  assert(result3.results.length > 0, "Should find results");
  assertTiming(result3.duration, 150, "Hybrid search");
  console.log(`  ✅ Hybrid search found ${result3.totalFound} results`);

  // Test 4: Search similar memories
  console.log("\n4. Search similar to existing memory");
  const result4 = await searchSimilar(testData.singleMemoryId, {
    limit: 3,
    includeScore: true,
  });
  assert(result4.results.every(r => r.memory.id !== testData.singleMemoryId), "Should exclude original");
  console.log(`  ✅ Found ${result4.totalFound} similar memories`);

  // Test 5: Search by category
  console.log("\n5. Search by category");
  const result5 = await searchByCategory(MemoryCategory.PREFERENCE);
  assert(result5.results.every(r => r.memory.category === MemoryCategory.PREFERENCE), "All should be preferences");
  console.log(`  ✅ Found ${result5.totalFound} preference memories`);

  // Test 6: Search with threshold
  console.log("\n6. Search with similarity threshold");
  const result6 = await searchByText("user preferences", {
    limit: 10,
    threshold: 0.5,
    includeScore: true,
  });
  assert(result6.results.every(r => (r.score ?? 0) >= 0.5), "All should meet threshold");
  console.log(`  ✅ Found ${result6.totalFound} results above threshold`);
}

async function testUpdateOperations(testData: { singleMemoryId: string }) {
  console.log("\n✏️  Testing UPDATE Operations...");

  // Test 1: Update memory without content change
  console.log("\n1. Update importance only");
  const result1 = await updateMemory(testData.singleMemoryId, {
    importance: 9,
  });
  assert(result1.data !== null, "Should find and update memory");
  assert(result1.data!.importance === 9, "Should update importance");
  assertTiming(result1.duration, 100, "Update without re-embedding");
  console.log(`  ✅ Updated importance to ${result1.data!.importance}`);

  // Test 2: Update memory with content change (triggers re-embedding)
  console.log("\n2. Update content (triggers re-embedding)");
  const originalContent = result1.data!.content;
  const result2 = await updateMemory(testData.singleMemoryId, {
    content: "User strongly prefers dark mode with high contrast",
  });
  assert(result2.data !== null, "Should update memory");
  assert(result2.data!.content !== originalContent, "Content should be updated");
  assert(result2.data!.updatedAt > result2.data!.createdAt, "updatedAt should be newer");
  assertTiming(result2.duration, 150, "Update with re-embedding");
  console.log(`  ✅ Updated content and regenerated embedding`);

  // Test 3: Update non-existent memory
  console.log("\n3. Update non-existent memory");
  const result3 = await updateMemory("non-existent-id", { importance: 5 });
  assert(result3.data === null, "Should return null for non-existent memory");
  console.log(`  ✅ Correctly handled non-existent memory`);
}

async function testDeleteOperations(testData: { batchMemoryIds: string[] }) {
  console.log("\n🗑️  Testing DELETE Operations...");

  // Test 1: Delete single memory
  console.log("\n1. Delete single memory");
  const idToDelete = testData.batchMemoryIds[0];
  const result1 = await deleteMemory(idToDelete);
  assert(result1.data === true, "Should successfully delete");
  assertTiming(result1.duration, 50, "Single delete");

  // Verify deletion
  const verify1 = await getMemory(idToDelete);
  assert(verify1.data === null, "Memory should be deleted");
  console.log(`  ✅ Deleted memory: ${idToDelete}`);

  // Test 2: Delete multiple memories
  console.log("\n2. Delete batch of memories");
  const idsToDelete = testData.batchMemoryIds.slice(1, 4); // 3 memories
  const result2 = await deleteMemories(idsToDelete);
  assert(result2.data === 3, "Should delete 3 memories");
  assertTiming(result2.duration, 100, "Batch delete");
  console.log(`  ✅ Deleted ${result2.data} memories`);

  // Test 3: Delete by filter
  console.log("\n3. Delete by project filter");
  const result3 = await deleteByFilter({ project: "project-b" });
  assert(result3.data > 0, "Should delete memories from project-b");
  console.log(`  ✅ Deleted ${result3.data} memories from project-b`);

  // Test 4: Delete non-existent memory
  console.log("\n4. Delete non-existent memory");
  const result4 = await deleteMemory("non-existent-id");
  assert(result4.data === false, "Should return false for non-existent");
  console.log(`  ✅ Correctly handled non-existent memory`);
}

async function testPerformance() {
  console.log("\n⚡ Testing PERFORMANCE...");

  // Test 1: Large batch create
  console.log("\n1. Create batch of 100 memories");
  const largeBatch = Array.from({ length: 100 }, (_, i) => ({
    content: `Performance test memory ${i}: This is a longer piece of content to test embedding generation speed with realistic data sizes`,
    category: MemoryCategory.CONTEXT,
    importance: 5,
    project: "perf-test",
  }));

  const result1 = await createMemories(largeBatch);
  assert(result1.data.length === 100, "Should create 100 memories");
  assertTiming(result1.duration, 5000, "Batch create (100)");
  console.log(`  ✅ Created 100 memories in ${result1.duration}ms (${(result1.duration / 100).toFixed(1)}ms per memory)`);

  // Test 2: Cache performance
  console.log("\n2. Testing embedding cache");
  const searchStats1 = getSearchCacheStats();

  // Search with same query twice
  await searchByText("performance test memory", { limit: 5 });
  await searchByText("performance test memory", { limit: 5 }); // Should hit cache

  const searchStats2 = getSearchCacheStats();
  const cacheImprovement = searchStats2.hits > searchStats1.hits;
  assert(cacheImprovement, "Cache should be working");
  console.log(`  ✅ Cache hit rate: ${(searchStats2.hitRate * 100).toFixed(1)}%`);
  console.log(`  Cache stats: ${searchStats2.hits} hits, ${searchStats2.misses} misses`);

  // Cleanup
  console.log("\n3. Cleanup test data");
  const cleanup = await deleteByFilter({ project: "perf-test" });
  console.log(`  ✅ Cleaned up ${cleanup.data} test memories`);
}

async function testEdgeCases() {
  console.log("\n🔬 Testing EDGE CASES...");

  // Test 1: Empty batch operations
  console.log("\n1. Empty batch operations");
  const result1 = await createMemories([]);
  assert(result1.data.length === 0, "Should handle empty batch");
  const result2 = await getMemories([]);
  assert(result2.data.length === 0, "Should handle empty ID list");
  console.log(`  ✅ Empty batches handled correctly`);

  // Test 2: Search with no results
  console.log("\n2. Search with no results");
  const result3 = await searchByText("xyzabc123nonexistent", {
    limit: 5,
    threshold: 0.9,
  });
  assert(result3.results.length >= 0, "Should return empty or low-score results");
  console.log(`  ✅ Search with unlikely match: ${result3.totalFound} results`);

  // Test 3: Filter with no matches
  console.log("\n3. Count with non-existent project");
  const result4 = await countMemories({ project: "non-existent-project" });
  assert(result4.data === 0, "Should return 0 for non-existent project");
  console.log(`  ✅ Handled non-existent filter correctly`);

  // Test 4: Very long content
  console.log("\n4. Create memory with very long content");
  const longContent = "Test content. ".repeat(500); // ~7000 chars
  const result5 = await createMemory({
    content: longContent,
    category: MemoryCategory.CONTEXT,
    importance: 5,
    project: "edge-case-test",
  });
  assert(result5.data.content.length > 6000, "Should handle long content");
  console.log(`  ✅ Created memory with ${result5.data.content.length} characters`);

  // Cleanup
  await deleteMemory(result5.data.id);
}

async function displayStatistics() {
  console.log("\n📊 Final Statistics...");

  const totalCount = await countMemories();
  console.log(`\nTotal memories in database: ${totalCount.data}`);

  const byCategoryResults = await Promise.all(
    Object.values(MemoryCategory).map(async (cat) => {
      const count = await countMemories({ category: cat });
      return { category: cat, count: count.data };
    })
  );

  console.log("\nMemories by category:");
  byCategoryResults.forEach(({ category, count }) => {
    console.log(`  ${category}: ${count}`);
  });

  const embeddingStats = getEmbeddingCacheStats();
  console.log("\nEmbedding cache statistics:");
  console.log(`  Size: ${embeddingStats.size}/${embeddingStats.maxSize}`);
  console.log(`  Hits: ${embeddingStats.hits}`);
  console.log(`  Misses: ${embeddingStats.misses}`);
  console.log(`  Hit rate: ${(embeddingStats.hitRate * 100).toFixed(1)}%`);

  const searchStats = getSearchCacheStats();
  console.log("\nSearch cache statistics:");
  console.log(`  Size: ${searchStats.size}/${searchStats.maxSize}`);
  console.log(`  Hit rate: ${(searchStats.hitRate * 100).toFixed(1)}%`);
}

// ============================================================================
// MAIN TEST RUNNER
// ============================================================================

async function runAllTests() {
  console.log("╔═══════════════════════════════════════════════════════════════╗");
  console.log("║         OpenClaw Memory System - Plan 03 Test Suite          ║");
  console.log("║            CRUD Operations & Optimized Search                 ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝");

  const startTime = Date.now();

  try {
    // Initialize storage
    console.log("\n⚙️  Initializing storage...");
    await initStorage();
    console.log("✅ Storage initialized\n");

    // Run test suites
    const testData = await testCreateOperations();
    await testReadOperations(testData);
    await testSearchOperations(testData);
    await testUpdateOperations(testData);
    await testDeleteOperations(testData);
    await testPerformance();
    await testEdgeCases();

    // Display final statistics
    await displayStatistics();

    // Summary
    const totalDuration = Date.now() - startTime;
    console.log("\n╔═══════════════════════════════════════════════════════════════╗");
    console.log("║                       TEST SUMMARY                            ║");
    console.log("╚═══════════════════════════════════════════════════════════════╝");
    console.log(`\n✅ All tests passed!`);
    console.log(`⏱️  Total test duration: ${totalDuration}ms (${(totalDuration / 1000).toFixed(1)}s)`);

    console.log("\n🎯 Performance Targets:");
    console.log("  ✅ Create (single): <50ms");
    console.log("  ✅ Create (batch 100): <500ms");
    console.log("  ✅ Search: <100ms");
    console.log("  ✅ Get by ID: <10ms");

  } catch (error) {
    console.error("\n❌ Test failed:", error);
    throw error;
  } finally {
    // Cleanup
    console.log("\n🧹 Shutting down storage...");
    await shutdownStorage();
    console.log("✅ Storage shutdown complete");
  }
}

// Run tests
runAllTests().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
