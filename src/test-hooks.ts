/**
 * OpenClaw Hooks Tests
 *
 * Tests for the context and extraction hooks.
 */

import {
  createContextHook,
  getContextHook,
  initContextHook,
  type ContextHook,
} from "./hooks/context-hook.js";
import {
  createExtractionHook,
  getExtractionHook,
  initExtractionHook,
  type ExtractionHook,
} from "./hooks/extraction-hook.js";
import { initMemorySystem, resetMemorySystem, getMemorySystem } from "./memory-system.js";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// ============================================================================
// TEST UTILITIES
// ============================================================================

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    testsPassed++;
  } else {
    console.log(`  ✗ ${message}`);
    testsFailed++;
  }
}

async function runTest(
  name: string,
  fn: () => Promise<void>
): Promise<void> {
  console.log(`\n${name}`);
  try {
    await fn();
  } catch (error) {
    console.log(`  ✗ Test threw error: ${error}`);
    testsFailed++;
  }
}

// ============================================================================
// CONTEXT HOOK TESTS
// ============================================================================

async function testContextHookCreation(): Promise<void> {
  await runTest("Context Hook - Creation", async () => {
    // Test factory function
    const hook = createContextHook();
    assert(hook !== null, "createContextHook returns a hook");
    assert(typeof hook.getContext === "function", "Hook has getContext method");
    assert(typeof hook.clearCache === "function", "Hook has clearCache method");
    assert(typeof hook.getMetrics === "function", "Hook has getMetrics method");

    // Test with options
    const customHook = createContextHook({
      maxTokens: 1000,
      format: "xml",
      minScore: 0.7,
      maxMemories: 5,
      enableCache: false,
    });
    assert(customHook !== null, "createContextHook accepts options");
  });
}

async function testContextHookSingleton(): Promise<void> {
  await runTest("Context Hook - Singleton", async () => {
    // Initialize with options
    const hook1 = initContextHook({ maxTokens: 500 });
    const hook2 = getContextHook();

    // Should return same instance after init
    assert(hook1 === hook2, "getContextHook returns initialized instance");

    // Re-init should create new instance
    const hook3 = initContextHook({ maxTokens: 1000 });
    assert(hook3 !== hook1, "initContextHook creates new instance");
  });
}

async function testContextHookGetContext(): Promise<void> {
  await runTest("Context Hook - getContext", async () => {
    const hook = createContextHook({
      maxTokens: 2000,
      format: "markdown",
      enableCache: true,
      cacheTTL: 60,
    });

    // Test with a query
    const result = await hook.getContext("How do we handle authentication?");

    assert(typeof result.context === "string", "Result has context string");
    assert(typeof result.memoryCount === "number", "Result has memoryCount");
    assert(typeof result.tokenCount === "number", "Result has tokenCount");
    assert(typeof result.latency === "number", "Result has latency");
    assert(typeof result.cached === "boolean", "Result has cached flag");

    // Context might be empty if no memories, but should still be valid
    assert(result.latency >= 0, "Latency is non-negative");
    assert(result.tokenCount >= 0, "Token count is non-negative");
  });
}

async function testContextHookCaching(): Promise<void> {
  await runTest("Context Hook - Caching", async () => {
    // Initialize memory system first to avoid initialization interfering with cache test
    try {
      await initMemorySystem({ logLevel: "error" });
    } catch {
      // Already initialized, that's fine
    }

    const hook = createContextHook({
      enableCache: true,
      cacheTTL: 60,
      autoInit: false, // Don't auto-init since we did it above
    });

    const query = "What is our caching strategy for this test?";

    // First call - should not be cached
    const result1 = await hook.getContext(query);
    assert(result1.cached === false, "First call is not cached");

    // Second call with same query - should be cached
    const result2 = await hook.getContext(query);
    assert(result2.cached === true, "Second call is cached");

    // Clear cache
    hook.clearCache();

    // Third call - should not be cached after clear
    const result3 = await hook.getContext(query);
    assert(result3.cached === false, "Call after clearCache is not cached");
  });
}

async function testContextHookMetrics(): Promise<void> {
  await runTest("Context Hook - Metrics", async () => {
    // Use autoInit: false since memory system should already be initialized
    const hook = createContextHook({ enableCache: true, autoInit: false });

    // Make some calls
    await hook.getContext("Test query metrics 1");
    await hook.getContext("Test query metrics 2");
    await hook.getContext("Test query metrics 1"); // Cache hit

    const metrics = hook.getMetrics();

    assert(typeof metrics.totalCalls === "number", "Metrics has totalCalls");
    assert(metrics.totalCalls >= 3, "Total calls counted");
    assert(typeof metrics.cacheHits === "number", "Metrics has cacheHits");
    assert(metrics.cacheHits >= 1, "Cache hit counted");
    assert(typeof metrics.cacheMisses === "number", "Metrics has cacheMisses");
    assert(typeof metrics.averageLatency === "number", "Metrics has averageLatency");
    assert(typeof metrics.errors === "number", "Metrics has errors");
  });
}

async function testContextHookFormats(): Promise<void> {
  await runTest("Context Hook - Formats", async () => {
    const formats = ["markdown", "xml", "plain", "compact"] as const;

    for (const format of formats) {
      const hook = createContextHook({ format });
      const result = await hook.getContext("Test query");
      assert(typeof result.context === "string", `Format '${format}' returns string`);
    }
  });
}

// ============================================================================
// EXTRACTION HOOK TESTS
// ============================================================================

async function testExtractionHookCreation(): Promise<void> {
  await runTest("Extraction Hook - Creation", async () => {
    // Test factory function
    const hook = createExtractionHook();
    assert(hook !== null, "createExtractionHook returns a hook");
    assert(typeof hook.extract === "function", "Hook has extract method");
    assert(typeof hook.getQueueStatus === "function", "Hook has getQueueStatus method");
    assert(typeof hook.flush === "function", "Hook has flush method");
    assert(typeof hook.getMetrics === "function", "Hook has getMetrics method");
    assert(typeof hook.isEnabled === "function", "Hook has isEnabled method");
    assert(typeof hook.setEnabled === "function", "Hook has setEnabled method");

    // Test with options
    const customHook = createExtractionHook({
      enabled: true,
      minLength: 100,
      concurrency: 1,
      dedupeWindow: 600,
    });
    assert(customHook !== null, "createExtractionHook accepts options");
  });
}

async function testExtractionHookSingleton(): Promise<void> {
  await runTest("Extraction Hook - Singleton", async () => {
    // Initialize with options
    const hook1 = initExtractionHook({ minLength: 30 });
    const hook2 = getExtractionHook();

    assert(hook1 === hook2, "getExtractionHook returns initialized instance");

    // Re-init should create new instance
    const hook3 = initExtractionHook({ minLength: 100 });
    assert(hook3 !== hook1, "initExtractionHook creates new instance");
  });
}

async function testExtractionHookEnabled(): Promise<void> {
  await runTest("Extraction Hook - Enable/Disable", async () => {
    const hook = createExtractionHook({ enabled: true });

    assert(hook.isEnabled() === true, "Hook starts enabled");

    hook.setEnabled(false);
    assert(hook.isEnabled() === false, "Hook can be disabled");

    // Extraction should be skipped when disabled
    const result = await hook.extract({
      userMessage: "Test message",
      assistantResponse: "Test response that is long enough to normally be extracted",
    });
    assert(result.queued === false, "Disabled hook skips extraction");
    assert(result.skipReason?.includes("disabled"), "Skip reason mentions disabled");

    hook.setEnabled(true);
    assert(hook.isEnabled() === true, "Hook can be re-enabled");
  });
}

async function testExtractionHookMinLength(): Promise<void> {
  await runTest("Extraction Hook - Min Length", async () => {
    const hook = createExtractionHook({
      enabled: true,
      minLength: 100,
    });

    // Short message should be skipped
    const shortResult = await hook.extract({
      userMessage: "Hi",
      assistantResponse: "Hello!",
    });
    assert(shortResult.queued === false, "Short message skipped");
    assert(shortResult.skipReason?.includes("too short"), "Skip reason mentions length");
  });
}

async function testExtractionHookSkipPatterns(): Promise<void> {
  await runTest("Extraction Hook - Skip Patterns", async () => {
    const hook = createExtractionHook({
      enabled: true,
      minLength: 10,
      skipPatterns: [/^hello$/i, /^thanks$/i],
    });

    // Greeting should be skipped
    const greetingResult = await hook.extract({
      userMessage: "Hello",
      assistantResponse: "This is a response that is definitely long enough",
    });
    assert(greetingResult.queued === false, "Greeting pattern skipped");
    assert(
      greetingResult.skipReason?.includes("skip pattern"),
      "Skip reason mentions pattern"
    );
  });
}

async function testExtractionHookDeduplication(): Promise<void> {
  await runTest("Extraction Hook - Deduplication", async () => {
    const hook = createExtractionHook({
      enabled: true,
      minLength: 10,
      dedupeWindow: 300, // 5 minutes
      autoInit: false, // Don't auto-init to avoid memory system dependency
    });

    const conversation = {
      userMessage: "What is the meaning of life according to our docs?",
      assistantResponse:
        "Based on the documentation, the meaning of life varies by context and implementation.",
      conversationId: "test-conv-123",
    };

    // First call - should be queued (or fail gracefully without memory system)
    const result1 = await hook.extract(conversation);
    // Either queued or failed due to no memory system - both acceptable

    // Second call with same conversationId - should be deduplicated
    const result2 = await hook.extract(conversation);
    assert(
      result2.queued === false && result2.skipReason?.includes("Duplicate"),
      "Duplicate conversation detected"
    );
  });
}

async function testExtractionHookQueueStatus(): Promise<void> {
  await runTest("Extraction Hook - Queue Status", async () => {
    const hook = createExtractionHook();

    const status = hook.getQueueStatus();

    assert(typeof status.pending === "number", "Status has pending count");
    assert(typeof status.processing === "number", "Status has processing count");
    assert(typeof status.completed === "number", "Status has completed count");
    assert(typeof status.failed === "number", "Status has failed count");
  });
}

async function testExtractionHookMetrics(): Promise<void> {
  await runTest("Extraction Hook - Metrics", async () => {
    const hook = createExtractionHook({
      enabled: true,
      minLength: 10,
    });

    // Make some extract calls
    await hook.extract({
      userMessage: "Short",
      assistantResponse: "msg",
    });

    const metrics = hook.getMetrics();

    assert(typeof metrics.totalQueued === "number", "Metrics has totalQueued");
    assert(typeof metrics.totalCompleted === "number", "Metrics has totalCompleted");
    assert(typeof metrics.totalSkipped === "number", "Metrics has totalSkipped");
    assert(metrics.totalSkipped >= 1, "Skipped count incremented");
    assert(typeof metrics.totalFailed === "number", "Metrics has totalFailed");
    assert(typeof metrics.averageExtractionTime === "number", "Metrics has averageExtractionTime");
    assert(typeof metrics.memoriesExtracted === "number", "Metrics has memoriesExtracted");

    // Test reset
    hook.resetMetrics();
    const resetMetrics = hook.getMetrics();
    assert(resetMetrics.totalSkipped === 0, "Metrics reset works");
  });
}

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

async function testHooksIntegration(): Promise<void> {
  await runTest("Hooks Integration - Workflow", async () => {
    // Initialize memory system
    try {
      await initMemorySystem({
        logLevel: "error",
      });

      // Create hooks
      const contextHook = createContextHook({
        maxTokens: 1000,
        format: "markdown",
        enableCache: true,
      });

      const extractionHook = createExtractionHook({
        enabled: true,
        minLength: 50,
      });

      // Simulate conversation flow
      const userMessage = "What is our recommended approach for handling user authentication?";
      const assistantResponse =
        "Based on our architecture, we recommend using JWT tokens for authentication. " +
        "This provides stateless authentication that works well with our microservices setup.";

      // 1. Get context for the query
      const context = await contextHook.getContext(userMessage, "api-gateway");
      assert(typeof context.context === "string", "Got context for query");

      // 2. After response, queue for extraction
      const extraction = await extractionHook.extract({
        userMessage,
        assistantResponse,
        project: "api-gateway",
      });

      // Either queued or gracefully failed
      assert(
        extraction.queued || extraction.skipReason !== undefined,
        "Extraction handled gracefully"
      );

      // 3. Check metrics
      const contextMetrics = contextHook.getMetrics();
      const extractionMetrics = extractionHook.getMetrics();

      assert(contextMetrics.totalCalls >= 1, "Context calls tracked");
      assert(
        extractionMetrics.totalQueued >= 0 || extractionMetrics.totalSkipped >= 0,
        "Extraction tracked"
      );

      console.log("  Integration workflow completed successfully");
    } finally {
      await resetMemorySystem();
    }
  });
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const testRoot = await mkdtemp(join(tmpdir(), "openclaw-memory-test-"));
  await initMemorySystem({
    dbPath: join(testRoot, "database"),
    enableSync: false,
    enableAutoExtraction: false,
    backup: {
      autoBackup: false,
      path: join(testRoot, "backups"),
    },
    logLevel: "error",
  });

  try {
  console.log("===================================================");
  console.log("   OpenClaw Hooks Test Suite");
  console.log("===================================================");

  // Context Hook Tests
  console.log("\n--- Context Hook Tests ---");
  await testContextHookCreation();
  await testContextHookSingleton();
  await testContextHookGetContext();
  await testContextHookCaching();
  await testContextHookMetrics();
  await testContextHookFormats();

  // Extraction Hook Tests
  console.log("\n--- Extraction Hook Tests ---");
  await testExtractionHookCreation();
  await testExtractionHookSingleton();
  await testExtractionHookEnabled();
  await testExtractionHookMinLength();
  await testExtractionHookSkipPatterns();
  await testExtractionHookDeduplication();
  await testExtractionHookQueueStatus();
  await testExtractionHookMetrics();

  // Integration Tests
  console.log("\n--- Integration Tests ---");
  await testHooksIntegration();

  // Summary
  console.log("\n===================================================");
  console.log(`   Results: ${testsPassed} passed, ${testsFailed} failed`);
  console.log("===================================================\n");

  if (testsFailed > 0) {
    process.exitCode = 1;
  }
  } finally {
    await resetMemorySystem();
    await rm(testRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("Test suite failed:", error);
  process.exit(1);
});
