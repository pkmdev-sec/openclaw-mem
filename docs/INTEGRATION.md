# OpenClaw Integration Guide

This guide explains how to integrate the Smart Memory System with OpenClaw agents.

## Overview

The memory system provides two main hooks for integration:

1. **Context Hook**: Injects relevant memories into agent prompts
2. **Extraction Hook**: Extracts memories from conversations after responses

## Setup

```typescript
import { initMemorySystem } from 'openclaw-memory';
import { createContextHook, createExtractionHook } from 'openclaw-memory/hooks';

// Initialize the memory system at application startup
await initMemorySystem({
  dbPath: '~/.openclaw-memory',
  enableSync: true,
  enableAutoExtraction: true,
});
```

## Context Injection

### Basic Usage

```typescript
const contextHook = createContextHook({
  maxTokens: 2000,
  format: 'markdown',
  enableCache: true,
  cacheTTL: 60, // seconds
});

// In your agent's context builder
async function buildAgentContext(userMessage: string, project?: string) {
  const { context, memoryCount, tokenCount } = await contextHook.getContext(
    userMessage,
    project
  );

  return `
${systemPrompt}

## Relevant Context from Previous Conversations
${context}

## User Message
${userMessage}
  `;
}
```

### Configuration Options

```typescript
interface ContextHookOptions {
  maxTokens?: number;     // Max tokens for context (default: 2000)
  format?: string;        // markdown, xml, plain, compact
  minScore?: number;      // Minimum relevance score (default: 0.5)
  maxMemories?: number;   // Max memories to include (default: 10)
  enableCache?: boolean;  // Enable caching (default: true)
  cacheTTL?: number;      // Cache TTL in seconds (default: 60)
}
```

### Context Formats

**Markdown** (default):
```markdown
## Relevant Context from Previous Conversations

1. **[decision]** We use JWT tokens with 24-hour expiry
   - Project: api-gateway
   - Relevance: 0.89

2. **[fact]** Rate limiting is 100 req/min per user
   - Project: api-gateway
   - Relevance: 0.76
```

**XML**:
```xml
<memory_context>
  <memory category="decision" project="api-gateway" relevance="0.89">
    We use JWT tokens with 24-hour expiry
  </memory>
</memory_context>
```

**Compact**:
```
[decision] We use JWT tokens with 24-hour expiry | [fact] Rate limiting is 100 req/min
```

## Memory Extraction

### Basic Usage

```typescript
const extractionHook = createExtractionHook({
  enabled: true,
  minLength: 50,
});

// After generating a response
async function afterResponse(
  userMessage: string,
  assistantResponse: string,
  project?: string
) {
  const result = await extractionHook.extract({
    userMessage,
    assistantResponse,
    project,
    conversationId: sessionId, // Optional, for deduplication
  });

  if (result.queued) {
    console.log('Extraction queued');
  }
}
```

### Configuration Options

```typescript
interface ExtractionHookOptions {
  enabled?: boolean;       // Enable extraction (default: true)
  minLength?: number;      // Min conversation length (default: 50)
  skipPatterns?: RegExp[]; // Patterns to skip (greetings, etc.)
  concurrency?: number;    // Max concurrent extractions
  dedupeWindow?: number;   // Deduplication window in seconds
}
```

### Skip Patterns

By default, these patterns are skipped:
- Short messages (< minLength)
- Greetings: "hello", "hi", "thanks", etc.
- Acknowledgments: "ok", "got it", etc.

Custom patterns:
```typescript
const extractionHook = createExtractionHook({
  skipPatterns: [
    /^(hello|hi|hey)/i,
    /^thanks/i,
    /^ok$/i,
  ],
});
```

## Event Handling

Subscribe to memory system events:

```typescript
import { getMemoryEventEmitter } from 'openclaw-memory';

const emitter = getMemoryEventEmitter();

// Listen for all events
emitter.subscribe('*', (event) => {
  console.log(`Event: ${event.type}`, event.data);
});

// Listen for specific events
emitter.subscribe('memory:created', (event) => {
  console.log('Memory created:', event.data);
});

emitter.subscribe('recall:completed', (event) => {
  console.log(`Recalled ${event.data.memoryCount} memories`);
});
```

### Event Types

| Event | Description |
|-------|-------------|
| `system:initialized` | System started |
| `system:shutdown` | System stopped |
| `memory:created` | New memory stored |
| `memory:updated` | Memory modified |
| `memory:deleted` | Memory removed |
| `recall:started` | Recall query started |
| `recall:completed` | Recall finished |
| `recall:cached` | Recall served from cache |
| `extraction:queued` | Extraction job queued |
| `extraction:completed` | Extraction finished |
| `sync:conflict` | Sync conflict detected |

## Performance Tuning

### Caching

Enable caching for repeated queries:
```typescript
const hook = createContextHook({
  enableCache: true,
  cacheTTL: 60, // 1 minute
});
```

### Batch Operations

For high-volume scenarios:
```typescript
// Use the memory system directly for batch operations
const system = getMemorySystem();

const memories = await Promise.all(
  items.map(item => system.memories.create(item))
);
```

### Memory Limits

Control context size:
```typescript
const hook = createContextHook({
  maxTokens: 1500,    // Limit total tokens
  maxMemories: 5,     // Limit number of memories
  minScore: 0.6,      // Only high-relevance memories
});
```

## Error Handling

Hooks gracefully handle errors:

```typescript
const hook = createContextHook();

// Returns empty context on error
const { context, error } = await hook.getContext(query);
if (context === '') {
  // Handle gracefully - system continues without memories
}

// Check metrics for error counts
const metrics = hook.getMetrics();
console.log('Errors:', metrics.errors);
```

## Complete Integration Example

```typescript
import { initMemorySystem, getMemorySystem } from 'openclaw-memory';
import { createContextHook, createExtractionHook } from 'openclaw-memory/hooks';

class OpenClawAgent {
  private contextHook;
  private extractionHook;

  async initialize() {
    await initMemorySystem({
      enableAutoExtraction: true,
    });

    this.contextHook = createContextHook({
      maxTokens: 2000,
      format: 'markdown',
      enableCache: true,
    });

    this.extractionHook = createExtractionHook({
      enabled: true,
      minLength: 50,
    });
  }

  async processMessage(userMessage: string, project?: string) {
    // 1. Get relevant context
    const { context } = await this.contextHook.getContext(userMessage, project);

    // 2. Build prompt with context
    const prompt = this.buildPrompt(userMessage, context);

    // 3. Generate response
    const response = await this.generateResponse(prompt);

    // 4. Extract memories (async, non-blocking)
    this.extractionHook.extract({
      userMessage,
      assistantResponse: response,
      project,
    });

    return response;
  }
}
```
