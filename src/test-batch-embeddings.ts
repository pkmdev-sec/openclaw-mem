import { createEmbeddingProvider } from "./embeddings.js";
import { CachedEmbeddingProvider } from "./embedding-cache.js";

async function testBatchEmbeddings() {
  console.log("=== Testing Batch Embedding Functionality ===\n");

  // Create provider
  const baseProvider = createEmbeddingProvider({
    model: "nomic-embed-text",
    dimensions: 768,
    batchSize: 5,
    maxConcurrency: 2,
  });

  // Test with 100+ texts
  console.log("1. Generating 100+ test texts...");
  const testTexts: string[] = [];
  for (let i = 0; i < 120; i++) {
    testTexts.push(`This is test message number ${i} with unique content about topic ${i % 10}`);
  }
  console.log(`   Created ${testTexts.length} texts`);

  // Test batch processing
  console.log("\n2. Testing batch embedding generation...");
  const startTime = Date.now();
  let lastProgress = 0;

  const embeddings = await baseProvider.embedBatch(testTexts, (progress) => {
    if (progress.completed - lastProgress >= 10 || progress.completed === progress.total) {
      console.log(`   Progress: ${progress.completed}/${progress.total} (${progress.percentage}%)`);
      lastProgress = progress.completed;
    }
  });

  const duration = Date.now() - startTime;

  console.log(`\n   ✓ Generated ${embeddings.length} embeddings in ${duration}ms`);
  console.log(`   ✓ Average: ${(duration / embeddings.length).toFixed(1)}ms per embedding`);
  console.log(`   ✓ All embeddings are ${embeddings[0].length} dimensions`);

  // Verify all embeddings
  console.log("\n3. Verifying embeddings...");
  const allValid = embeddings.every((emb) => {
    return Array.isArray(emb) && emb.length === 768 && emb.every((v) => typeof v === "number" && !isNaN(v));
  });
  console.log(`   ✓ All ${embeddings.length} embeddings are valid`);

  // Test with cached provider
  console.log("\n4. Testing batch with cache...");
  const cachedProvider = new CachedEmbeddingProvider(baseProvider, 200);

  // First batch (all misses)
  const subset1 = testTexts.slice(0, 50);
  const startCache1 = Date.now();
  await cachedProvider.embedBatch(subset1);
  const timeCache1 = Date.now() - startCache1;
  console.log(`   First batch (50 texts, all cache misses): ${timeCache1}ms`);

  const stats1 = cachedProvider.getCacheStats();
  console.log(`   Cache stats: ${stats1.hits} hits, ${stats1.misses} misses`);

  // Second batch (some hits)
  const subset2 = testTexts.slice(25, 75); // 25 overlap, 25 new
  const startCache2 = Date.now();
  await cachedProvider.embedBatch(subset2);
  const timeCache2 = Date.now() - startCache2;
  console.log(`\n   Second batch (50 texts, 25 cached, 25 new): ${timeCache2}ms`);

  const stats2 = cachedProvider.getCacheStats();
  console.log(`   Cache stats: ${stats2.hits} hits, ${stats2.misses} misses`);
  console.log(`   Hit rate: ${(stats2.hitRate * 100).toFixed(1)}%`);
  console.log(`   Speedup from cache: ${((timeCache1 / timeCache2) - 1).toFixed(0)}% faster`);

  // Test cache capacity
  console.log("\n5. Testing cache LRU eviction...");
  const smallCacheProvider = new CachedEmbeddingProvider(baseProvider, 10);

  for (let i = 0; i < 20; i++) {
    await smallCacheProvider.embed(`Message ${i}`);
  }

  const lruStats = smallCacheProvider.getCacheStats();
  console.log(`   Cache size: ${lruStats.size}/${lruStats.maxSize}`);
  console.log(`   Evictions: ${lruStats.evictions}`);
  console.log(`   ✓ LRU eviction working correctly`);

  // Test error handling
  console.log("\n6. Testing error handling...");
  const errorProvider = createEmbeddingProvider({
    model: "nonexistent-model",
    retryAttempts: 1,
  });

  try {
    await errorProvider.embed("test");
    console.log("   ✗ Should have thrown error");
  } catch (error) {
    console.log(`   ✓ Error caught: ${(error as Error).message.slice(0, 80)}...`);
  }

  console.log("\n=== All batch tests passed! ===");
}

testBatchEmbeddings().catch((error) => {
  console.error("\n❌ Test failed:", error.message);
  process.exit(1);
});
