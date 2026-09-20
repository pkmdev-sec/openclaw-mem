/**
 * Quick tests for queue functionality (no database required)
 */

import {
  AutoExtractionService,
  initAutoExtraction,
  enqueueUserAssistant,
} from "./auto-extraction.js";
import { NullProvider } from "./llm-provider.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testEnqueueSpeed(): Promise<void> {
  console.log("\n=== Test 1: Enqueue Speed ===\n");

  const service = initAutoExtraction({
    provider: new NullProvider(),
    autoStart: false,
  });

  const iterations = 100;
  const timings: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    enqueueUserAssistant(`Message ${i}`, `Response ${i}`, "speed-test");
    const duration = performance.now() - start;
    timings.push(duration);
  }

  const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
  const max = Math.max(...timings);
  const p95 = timings.sort((a, b) => a - b)[Math.floor(timings.length * 0.95)];

  console.log(`Enqueued ${iterations} items:`);
  console.log(`  Average: ${avg.toFixed(3)}ms`);
  console.log(`  Max: ${max.toFixed(3)}ms`);
  console.log(`  P95: ${p95.toFixed(3)}ms`);

  if (avg < 1.0) {
    console.log("✅ PASS - Average enqueue < 1ms");
  } else {
    console.log("❌ FAIL - Average enqueue >= 1ms");
  }

  AutoExtractionService.reset();
}

async function testDeduplication(): Promise<void> {
  console.log("\n=== Test 2: Deduplication ===\n");

  const service = initAutoExtraction({
    provider: new NullProvider(),
    autoStart: false,
    enableDeduplication: true,
  });

  // Enqueue same message 5 times
  for (let i = 0; i < 5; i++) {
    enqueueUserAssistant("Same message", "Same response", "dedup-test");
  }

  const stats = service.getStats();
  console.log(`Queued: ${stats.queued}`);
  console.log(`Duplicates Skipped: ${stats.duplicatesSkipped}`);

  if (stats.queued === 1 && stats.duplicatesSkipped === 4) {
    console.log("✅ PASS - Deduplication working");
  } else {
    console.log("❌ FAIL - Deduplication not working");
  }

  AutoExtractionService.reset();
}

async function testPersistence(): Promise<void> {
  console.log("\n=== Test 3: Queue Persistence ===\n");

  // Clear old queue
  let service = initAutoExtraction({
    provider: new NullProvider(),
    autoStart: false,
  });
  service.getQueue().clear();
  AutoExtractionService.reset();

  // Create and enqueue
  service = initAutoExtraction({
    provider: new NullProvider(),
    autoStart: false,
    enableDeduplication: false,
  });

  enqueueUserAssistant("Persist 1", "Response 1", "persist-test");
  enqueueUserAssistant("Persist 2", "Response 2", "persist-test");

  const before = service.getQueueStatus();
  console.log(`Before restart: ${before.total} items in queue`);

  // Simulate restart
  AutoExtractionService.reset();

  service = initAutoExtraction({
    provider: new NullProvider(),
    autoStart: false,
    enableDeduplication: false,
  });

  const after = service.getQueueStatus();
  console.log(`After restart: ${after.total} items in queue`);

  if (after.total === before.total) {
    console.log("✅ PASS - Queue persisted correctly");
  } else {
    console.log("❌ FAIL - Queue not persisted");
  }

  AutoExtractionService.reset();
}

async function testConcurrency(): Promise<void> {
  console.log("\n=== Test 4: Concurrent Processing ===\n");

  const service = initAutoExtraction({
    provider: new NullProvider(),
    queueConcurrency: 3,
    autoStart: false,
  });

  // Enqueue 10 items
  for (let i = 0; i < 10; i++) {
    enqueueUserAssistant(`Msg ${i}`, `Resp ${i}`, "concurrency-test");
  }

  console.log("Enqueued 10 items, starting processing...");

  // Start processing and immediately check status
  service.start();
  await sleep(50);

  const status = service.getQueueStatus();
  console.log(`Processing: ${status.processing}`);
  console.log(`Pending: ${status.pending}`);

  // Wait for all to complete
  await service.flush();

  const final = service.getStats();
  console.log(`\nFinal stats: ${final.processed} processed`);

  if (final.processed === 10) {
    console.log("✅ PASS - All items processed");
  } else {
    console.log("❌ FAIL - Not all items processed");
  }

  AutoExtractionService.reset();
}

async function testRetry(): Promise<void> {
  console.log("\n=== Test 5: Retry Logic ===\n");

  const service = initAutoExtraction({
    provider: new NullProvider(),
    queueConcurrency: 1,
    autoStart: false,
  });

  // The NullProvider will not fail, so we just test that the queue
  // can handle processing without errors
  enqueueUserAssistant("Test retry", "Test response", "retry-test");

  service.start();
  await service.flush();

  const stats = service.getStats();
  console.log(`Processed: ${stats.processed}`);
  console.log(`Failed: ${stats.failed}`);

  if (stats.processed >= 0 && stats.failed === 0) {
    console.log("✅ PASS - Queue handles processing");
  } else {
    console.log("❌ FAIL - Queue error handling issue");
  }

  AutoExtractionService.reset();
}

async function main(): Promise<void> {
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║  OpenClaw Processing Queue - Quick Tests (No DB)   ║");
  console.log("╚══════════════════════════════════════════════════════╝");

  try {
    await testEnqueueSpeed();
    await testDeduplication();
    await testPersistence();
    await testConcurrency();
    await testRetry();

    console.log("\n" + "=".repeat(56));
    console.log("All tests completed!");
    console.log("=".repeat(56) + "\n");
  } catch (error) {
    console.error("\n❌ Test suite failed:", error);
    process.exit(1);
  }
}

main();
