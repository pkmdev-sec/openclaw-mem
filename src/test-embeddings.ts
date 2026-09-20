import { createEmbeddingProvider } from "./embeddings.js";
import { CachedEmbeddingProvider } from "./embedding-cache.js";

async function testEmbeddings() {
  console.log("=== Testing Embedding System ===\n");

  // Test 1: Create provider
  console.log("1. Creating embedding provider...");
  const baseProvider = createEmbeddingProvider({
    model: "nomic-embed-text",
    dimensions: 768,
  });
  console.log(`   Provider: ${baseProvider.getProviderName()}`);
  console.log(`   Dimensions: ${baseProvider.getDimensions()}`);

  // Test 2: Test connection
  console.log("\n2. Testing connection to Ollama...");
  const ollamaProvider = baseProvider as any;
  if (ollamaProvider.testConnection) {
    const result = await ollamaProvider.testConnection();
    if (result.available) {
      console.log("   ✓ Connected successfully");
    } else {
      console.log(`   ✗ Connection failed: ${result.error}`);
      process.exit(1);
    }
  }

  // Test 3: Single embedding
  console.log("\n3. Generating single embedding...");
  const text1 = "Hello world";
  const embedding1 = await baseProvider.embed(text1);
  console.log(`   Text: "${text1}"`);
  console.log(`   Dimensions: ${embedding1.length}`);
  console.log(`   First 5 values: ${embedding1.slice(0, 5).map(v => v.toFixed(4)).join(", ")}`);
  console.log(`   Last 5 values: ${embedding1.slice(-5).map(v => v.toFixed(4)).join(", ")}`);

  // Test 4: Batch processing
  console.log("\n4. Testing batch processing...");
  const testTexts = [
    "The sky is blue",
    "Machine learning is fascinating",
    "TypeScript is a typed superset of JavaScript",
    "Vector embeddings capture semantic meaning",
    "LanceDB is a vector database",
  ];

  const startTime = Date.now();
  const embeddings = await baseProvider.embedBatch(testTexts, (progress) => {
    console.log(`   Progress: ${progress.completed}/${progress.total} (${progress.percentage}%)`);
  });
  const duration = Date.now() - startTime;

  console.log(`   Generated ${embeddings.length} embeddings in ${duration}ms`);
  console.log(`   Average: ${(duration / embeddings.length).toFixed(0)}ms per embedding`);

  // Test 5: Cached provider
  console.log("\n5. Testing cached provider...");
  const cachedProvider = new CachedEmbeddingProvider(baseProvider, 100);
  console.log(`   Provider: ${cachedProvider.getProviderName()}`);

  // First call (cache miss)
  console.log("   First call (cache miss)...");
  const start1 = Date.now();
  await cachedProvider.embed("Test message");
  const time1 = Date.now() - start1;
  console.log(`   Time: ${time1}ms`);

  // Second call (cache hit)
  console.log("   Second call (cache hit)...");
  const start2 = Date.now();
  await cachedProvider.embed("Test message");
  const time2 = Date.now() - start2;
  console.log(`   Time: ${time2}ms`);
  console.log(`   Speedup: ${(time1 / time2).toFixed(1)}x faster`);

  // Test 6: Cache statistics
  console.log("\n6. Cache statistics:");
  const stats = cachedProvider.getCacheStats();
  console.log(`   Size: ${stats.size}/${stats.maxSize}`);
  console.log(`   Hits: ${stats.hits}`);
  console.log(`   Misses: ${stats.misses}`);
  console.log(`   Hit rate: ${(stats.hitRate * 100).toFixed(2)}%`);

  // Test 7: Batch with cache
  console.log("\n7. Testing batch with cache...");
  const batchTexts = [
    "Test message", // Already cached
    "New message 1",
    "New message 2",
  ];

  const batchStart = Date.now();
  const batchResults = await cachedProvider.embedBatch(batchTexts);
  const batchDuration = Date.now() - batchStart;

  console.log(`   Generated ${batchResults.length} embeddings in ${batchDuration}ms`);
  console.log(`   Cache stats after batch:`);
  const finalStats = cachedProvider.getCacheStats();
  console.log(`   - Size: ${finalStats.size}/${finalStats.maxSize}`);
  console.log(`   - Hits: ${finalStats.hits}`);
  console.log(`   - Misses: ${finalStats.misses}`);
  console.log(`   - Hit rate: ${(finalStats.hitRate * 100).toFixed(2)}%`);

  console.log("\n=== All tests passed! ===");
}

// Run tests
testEmbeddings().catch((error) => {
  console.error("\n❌ Test failed:", error.message);
  process.exit(1);
});
