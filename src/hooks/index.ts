/**
 * OpenClaw Integration Hooks
 *
 * Hooks for integrating the memory system with OpenClaw agents.
 *
 * Usage:
 * ```typescript
 * import { createContextHook, createExtractionHook } from 'openclaw-memory/hooks';
 *
 * // Context injection - add relevant memories to agent context
 * const contextHook = createContextHook({ maxTokens: 2000 });
 * const { context, memoryCount } = await contextHook.getContext(userMessage, project);
 *
 * // Extraction - queue conversations for memory extraction
 * const extractionHook = createExtractionHook();
 * await extractionHook.extract({ userMessage, assistantResponse, project });
 * ```
 */

// Context Hook - Inject relevant memories into agent context
export {
  createContextHook,
  getContextHook,
  initContextHook,
  type ContextHook,
  type ContextHookOptions,
  type ContextHookResult,
  type ContextHookMetrics,
} from "./context-hook.js";

// Extraction Hook - Queue conversations for memory extraction
export {
  createExtractionHook,
  getExtractionHook,
  initExtractionHook,
  type ExtractionHook,
  type ExtractionHookOptions,
  type ExtractionHookResult,
  type ConversationInput,
  type QueueStatus,
  type ExtractionHookMetrics,
} from "./extraction-hook.js";
