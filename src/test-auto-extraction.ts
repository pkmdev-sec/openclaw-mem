/**
 * Integration tests for auto-extraction service
 * Tests full pipeline: enqueue → extract → store
 */

import {
  AutoExtractionService,
  initAutoExtraction,
  enqueueConversation,
  enqueueUserAssistant,
} from "./auto-extraction.js";
import { createOllamaProvider } from "./llm-provider.js";
import { ConversationTurn } from "./extraction-prompts.js";

/**
 * Test utilities
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHeader(text: string): void {
  console.log("\n" + "=".repeat(70));
  console.log(`  ${text}`);
  console.log("=".repeat(70) + "\n");
}

function printStats(stats: any): void {
  console.log("Statistics:");
  console.log(`  Queued: ${stats.queued}`);
  console.log(`  Processed: ${stats.processed}`);
  console.log(`  Failed: ${stats.failed}`);
  console.log(`  Memories Created: ${stats.memoriesCreated}`);
  console.log(`  Duplicates Skipped: ${stats.duplicatesSkipped}`);
  console.log(`  Uptime: ${(stats.uptime / 1000).toFixed(2)}s`);
}

/**
 * Test 1: Basic enqueue and process
 */
async function testBasicEnqueue(): Promise<boolean> {
  printHeader("Test 1: Basic Enqueue and Process");

  try {
    const provider = createOllamaProvider();
    const service = initAutoExtraction({
      provider,
      queueConcurrency: 2,
      autoStart: false,
    });

    // Enqueue a simple conversation
    enqueueUserAssistant(
      "I want to use LanceDB for vector storage",
      "Great choice! LanceDB is excellent for local vector storage with Arrow format.",
      "test-project"
    );

    console.log("✓ Enqueued conversation");

    // Start processing
    service.start();
    console.log("✓ Started service");

    // Wait for processing
    await service.flush();
    console.log("✓ Processing completed");

    // Check stats
    const stats = service.getStats();
    printStats(stats);

    const success = stats.processed === 1 && stats.failed === 0;
    console.log(success ? "\n✅ Test PASSED" : "\n❌ Test FAILED");

    return success;
  } catch (error) {
    console.error("❌ Test FAILED:", error);
    return false;
  } finally {
    AutoExtractionService.reset();
  }
}

/**
 * Test 2: High volume enqueue
 */
async function testHighVolume(): Promise<boolean> {
  printHeader("Test 2: High Volume (50+ conversations)");

  try {
    const provider = createOllamaProvider();
    const service = initAutoExtraction({
      provider,
      queueConcurrency: 5,
      autoStart: true,
    });

    // Sample conversations for testing
    const conversations = [
      {
        user: "What's the best way to implement error handling in TypeScript?",
        assistant: "Use try-catch blocks with typed errors and custom error classes for better type safety.",
      },
      {
        user: "How do I optimize React rendering performance?",
        assistant: "Use React.memo, useMemo, and useCallback to prevent unnecessary re-renders.",
      },
      {
        user: "Should I use MongoDB or PostgreSQL for my app?",
        assistant: "It depends on your data structure. Use PostgreSQL for relational data and MongoDB for flexible documents.",
      },
      {
        user: "What's the difference between let and const in JavaScript?",
        assistant: "const prevents reassignment, while let allows it. Both are block-scoped unlike var.",
      },
      {
        user: "How do I handle authentication in a web app?",
        assistant: "Use JWT tokens with secure HTTP-only cookies and implement refresh token rotation.",
      },
    ];

    const startTime = Date.now();
    const targetCount = 50;

    // Enqueue many conversations
    console.log(`Enqueueing ${targetCount} conversations...`);
    for (let i = 0; i < targetCount; i++) {
      const conv = conversations[i % conversations.length];
      enqueueUserAssistant(
        `${conv.user} (batch ${Math.floor(i / conversations.length)})`,
        conv.assistant,
        "high-volume-test"
      );
    }

    const enqueueTime = Date.now() - startTime;
    const avgEnqueueTime = enqueueTime / targetCount;

    console.log(`✓ Enqueued ${targetCount} items in ${enqueueTime}ms`);
    console.log(`  Average per enqueue: ${avgEnqueueTime.toFixed(2)}ms`);

    // Check enqueue performance
    if (avgEnqueueTime > 1) {
      console.warn(`⚠️  Average enqueue time (${avgEnqueueTime.toFixed(2)}ms) exceeds 1ms target`);
    } else {
      console.log("✓ Enqueue performance meets < 1ms requirement");
    }

    // Wait for processing
    console.log("\nProcessing queue...");
    await service.flush();

    // Check stats
    const stats = service.getStats();
    printStats(stats);

    const success =
      stats.queued === targetCount &&
      stats.processed === targetCount &&
      avgEnqueueTime < 5; // Allow some leeway for slower systems

    console.log(success ? "\n✅ Test PASSED" : "\n❌ Test FAILED");

    return success;
  } catch (error) {
    console.error("❌ Test FAILED:", error);
    return false;
  } finally {
    AutoExtractionService.reset();
  }
}

/**
 * Test 3: Deduplication
 */
async function testDeduplication(): Promise<boolean> {
  printHeader("Test 3: Deduplication");

  try {
    const provider = createOllamaProvider();
    const service = initAutoExtraction({
      provider,
      queueConcurrency: 2,
      enableDeduplication: true,
      autoStart: true,
    });

    const conversation: ConversationTurn[] = [
      { role: "user", content: "What is TypeScript?" },
      { role: "assistant", content: "TypeScript is a typed superset of JavaScript that compiles to plain JavaScript." },
    ];

    // Enqueue the same conversation multiple times
    console.log("Enqueueing same conversation 5 times...");
    for (let i = 0; i < 5; i++) {
      service.enqueue(conversation, "dedup-test");
    }

    // Wait a bit for processing
    await sleep(100);

    // Check stats
    const stats = service.getStats();
    console.log(`✓ Queued: ${stats.queued}`);
    console.log(`✓ Duplicates Skipped: ${stats.duplicatesSkipped}`);

    const success = stats.queued === 1 && stats.duplicatesSkipped === 4;
    console.log(success ? "\n✅ Test PASSED" : "\n❌ Test FAILED");

    if (!success) {
      console.log("\nExpected: queued=1, duplicatesSkipped=4");
      console.log(`Actual: queued=${stats.queued}, duplicatesSkipped=${stats.duplicatesSkipped}`);
    }

    return success;
  } catch (error) {
    console.error("❌ Test FAILED:", error);
    return false;
  } finally {
    AutoExtractionService.reset();
  }
}

/**
 * Test 4: Performance - enqueue latency
 */
async function testEnqueuePerformance(): Promise<boolean> {
  printHeader("Test 4: Enqueue Performance (< 1ms)");

  try {
    const provider = createOllamaProvider();
    const service = initAutoExtraction({
      provider,
      queueConcurrency: 1,
      autoStart: false, // Don't process, just measure enqueue
      enableDeduplication: false, // Disable to test pure enqueue speed
    });

    const testCount = 100;
    const timings: number[] = [];

    console.log(`Measuring ${testCount} enqueue operations...`);

    for (let i = 0; i < testCount; i++) {
      const start = performance.now();

      enqueueUserAssistant(
        `Test message ${i}`,
        `Response ${i}`,
        "perf-test"
      );

      const duration = performance.now() - start;
      timings.push(duration);
    }

    // Calculate statistics
    const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
    const maxTime = Math.max(...timings);
    const minTime = Math.min(...timings);
    const p95Time = timings.sort((a, b) => a - b)[Math.floor(timings.length * 0.95)];

    console.log("\nPerformance Results:");
    console.log(`  Average: ${avgTime.toFixed(3)}ms`);
    console.log(`  Min: ${minTime.toFixed(3)}ms`);
    console.log(`  Max: ${maxTime.toFixed(3)}ms`);
    console.log(`  P95: ${p95Time.toFixed(3)}ms`);

    const success = avgTime < 1.0 && p95Time < 2.0;

    if (success) {
      console.log("✓ All timings within acceptable range");
    } else {
      console.warn("⚠️  Some timings exceed target");
    }

    console.log(success ? "\n✅ Test PASSED" : "\n❌ Test FAILED");

    return success;
  } catch (error) {
    console.error("❌ Test FAILED:", error);
    return false;
  } finally {
    AutoExtractionService.reset();
  }
}

/**
 * Test 5: Crash recovery (persistence)
 */
async function testCrashRecovery(): Promise<boolean> {
  printHeader("Test 5: Crash Recovery (Persistence)");

  try {
    const provider = createOllamaProvider();

    // Clear any existing queue first
    console.log("Phase 0: Clearing old queue...");
    if (AutoExtractionService.hasInstance()) {
      AutoExtractionService.reset();
    }
    let cleanupService = initAutoExtraction({
      provider,
      queueConcurrency: 1,
      autoStart: false,
    });
    cleanupService.getQueue().clear();
    AutoExtractionService.reset();
    console.log("✓ Cleared old queue\n");

    // Phase 1: Create service and enqueue items
    console.log("Phase 1: Creating service and enqueueing items...");
    let service = initAutoExtraction({
      provider,
      queueConcurrency: 1,
      autoStart: false,
      enableDeduplication: false, // Disable for this test
    });

    enqueueUserAssistant(
      "First conversation unique test 1",
      "First response unique test 1",
      "crash-test"
    );
    enqueueUserAssistant(
      "Second conversation unique test 2",
      "Second response unique test 2",
      "crash-test"
    );

    const beforeStats = service.getStats();
    console.log(`✓ Enqueued ${beforeStats.queued} items`);

    // Simulate crash by resetting (but queue is persisted to disk)
    console.log("\nPhase 2: Simulating crash...");
    AutoExtractionService.reset();

    // Phase 3: Create new service (should load from disk)
    console.log("Phase 3: Restarting service...");
    service = initAutoExtraction({
      provider,
      queueConcurrency: 1,
      autoStart: true,
      enableDeduplication: false, // Disable for this test
    });

    const afterStats = service.getQueueStatus();
    console.log(`✓ Queue loaded with ${afterStats.total} total items`);
    console.log(`  Pending: ${afterStats.pending}`);
    console.log(`  Processing: ${afterStats.processing}`);
    console.log(`  Completed: ${afterStats.completed}`);
    console.log(`  Failed: ${afterStats.failed}`);

    const success = afterStats.total === beforeStats.queued &&
                    (afterStats.pending + afterStats.processing) === beforeStats.queued;
    console.log(success ? "\n✅ Test PASSED" : "\n❌ Test FAILED");

    if (!success) {
      console.log(`\nExpected ${beforeStats.queued} items (pending+processing), got ${afterStats.pending + afterStats.processing}`);
    }

    return success;
  } catch (error) {
    console.error("❌ Test FAILED:", error);
    return false;
  } finally {
    AutoExtractionService.reset();
  }
}

/**
 * Demo: Real-world usage
 */
async function runDemo(): Promise<void> {
  printHeader("DEMO: Real-World Usage");

  try {
    const provider = createOllamaProvider();

    console.log("Step 1: Initialize auto-extraction service");
    const service = initAutoExtraction({
      provider,
      queueConcurrency: 3,
      autoStart: true,
    });
    console.log("✓ Service initialized and started\n");

    console.log("Step 2: Simulate ongoing conversation");
    console.log("   (In real app, this would be called after each user interaction)\n");

    // Simulate a multi-turn conversation
    const conversations = [
      {
        user: "I'm building a TypeScript library for data processing",
        assistant: "That's great! For data processing in TypeScript, consider using streams for large datasets and proper type definitions.",
      },
      {
        user: "Should I use classes or functions?",
        assistant: "For a library, I'd recommend functional composition with immutable data. It's easier to test and reason about.",
      },
      {
        user: "What about error handling?",
        assistant: "Use discriminated unions for error types and the Result pattern. It makes errors explicit in the type system.",
      },
    ];

    for (const conv of conversations) {
      console.log(`User: ${conv.user}`);
      console.log(`Assistant: ${conv.assistant.substring(0, 50)}...`);

      // This is the key integration point - call after each exchange
      const beforeEnqueue = performance.now();
      enqueueUserAssistant(conv.user, conv.assistant, "demo-project");
      const enqueueTime = performance.now() - beforeEnqueue;

      console.log(`⚡ Enqueued in ${enqueueTime.toFixed(3)}ms (non-blocking)\n`);
      await sleep(100); // Simulate time between messages
    }

    console.log("Step 3: Check processing status");
    let status = service.getQueueStatus();
    console.log(`  Pending: ${status.pending}`);
    console.log(`  Processing: ${status.processing}`);
    console.log(`  Completed: ${status.completed}\n`);

    console.log("Step 4: Wait for background processing...");
    await service.flush();
    console.log("✓ All items processed\n");

    console.log("Step 5: View final statistics");
    const stats = service.getStats();
    printStats(stats);

    console.log("\n✓ Demo completed successfully!");
    console.log("\nKey Takeaway:");
    console.log("  - User NEVER waits for extraction");
    console.log("  - Enqueue calls are < 1ms each");
    console.log("  - Memories are extracted in background");
    console.log("  - System survives crashes (persisted queue)");

  } catch (error) {
    console.error("❌ Demo failed:", error);
  } finally {
    AutoExtractionService.reset();
  }
}

/**
 * Main test runner
 */
async function main(): Promise<void> {
  console.log("\n");
  console.log("╔═══════════════════════════════════════════════════════════════════╗");
  console.log("║   OpenClaw Auto-Extraction Service - Integration Tests & Demo    ║");
  console.log("╚═══════════════════════════════════════════════════════════════════╝");

  const args = process.argv.slice(2);
  const runMode = args[0] || "all";

  try {
    if (runMode === "demo") {
      await runDemo();
      return;
    }

    const results: { name: string; passed: boolean }[] = [];

    if (runMode === "all" || runMode === "1") {
      results.push({ name: "Basic Enqueue", passed: await testBasicEnqueue() });
    }

    if (runMode === "all" || runMode === "2") {
      results.push({ name: "High Volume", passed: await testHighVolume() });
    }

    if (runMode === "all" || runMode === "3") {
      results.push({ name: "Deduplication", passed: await testDeduplication() });
    }

    if (runMode === "all" || runMode === "4") {
      results.push({
        name: "Enqueue Performance",
        passed: await testEnqueuePerformance(),
      });
    }

    if (runMode === "all" || runMode === "5") {
      results.push({
        name: "Crash Recovery",
        passed: await testCrashRecovery(),
      });
    }

    // Print summary
    printHeader("Test Summary");
    let allPassed = true;
    for (const result of results) {
      const status = result.passed ? "✅ PASS" : "❌ FAIL";
      console.log(`${status} - ${result.name}`);
      if (!result.passed) allPassed = false;
    }

    console.log("\n" + "=".repeat(70));
    if (allPassed) {
      console.log("🎉 All tests passed!");
    } else {
      console.log("⚠️  Some tests failed");
    }
    console.log("=".repeat(70) + "\n");

    process.exit(allPassed ? 0 : 1);
  } catch (error) {
    console.error("\n❌ Test suite failed:", error);
    process.exit(1);
  }
}

// Run tests
main();
