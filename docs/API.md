# API Reference

## Core Classes

### MemorySystem

Main orchestration class for all memory operations.

```typescript
import { initMemorySystem, getMemorySystem, resetMemorySystem } from 'openclaw-memory';

// Initialize
const system = await initMemorySystem(config?: MemorySystemConfig);

// Get singleton instance
const system = getMemorySystem();

// Shutdown
await resetMemorySystem();
```

#### Methods

**recall(query, options?)**
```typescript
const result = await system.recall(query: string, options?: RecallOptions);
// Returns: RecallResult { context, memoryCount, tokenCount, latency, cached }
```

**getStatus()**
```typescript
const status = await system.getStatus();
// Returns: MemorySystemStatus { initialized, dbPath, memoryCount, syncStatus, uptime }
```

**storeConversation(conversation, project?)**
```typescript
const memoryIds = await system.storeConversation(text: string, project?: string);
// Returns: string[] (IDs of created memories)
```

#### Sub-objects

**system.memories**
```typescript
await system.memories.create(input: CreateMemoryInput): Memory
await system.memories.get(id: string): Memory | null
await system.memories.update(id: string, updates: Partial<Memory>): Memory
await system.memories.delete(id: string): boolean
await system.memories.search(query: string, limit?: number): Memory[]
await system.memories.count(): number
```

**system.sync**
```typescript
await system.sync.getStatus(): SyncInfo | null
await system.sync.checkConflicts(): number
system.sync.getSetupInstructions(): string
```

**system.backup**
```typescript
await system.backup.create(name?: string): BackupResult
await system.backup.restore(path: string): RestoreResult
await system.backup.list(): BackupInfo[]
await system.backup.prune(keepCount: number): number
```

## Types

### Memory
```typescript
interface Memory {
  id: string;
  content: string;
  category: 'fact' | 'decision' | 'preference' | 'context';
  project?: string;
  importance: number; // 1-10
  tags: string[];
  vector: number[];
  createdAt: number;
  updatedAt: number;
}
```

### CreateMemoryInput
```typescript
interface CreateMemoryInput {
  content: string;
  category: MemoryCategory;
  importance: number;
  project?: string;
  tags?: string[];
}
```

### RecallOptions
```typescript
interface RecallOptions {
  limit?: number;
  minScore?: number;
  maxTokens?: number;
  format?: 'markdown' | 'xml' | 'plain' | 'compact';
  project?: string;
  includeMemories?: boolean;
}
```

### RecallResult
```typescript
interface RecallResult {
  context: string;
  memoryCount: number;
  tokenCount: number;
  latency: number;
  cached: boolean;
  memories?: Memory[];
}
```

### MemorySystemConfig
```typescript
interface MemorySystemConfig {
  dbPath?: string;
  enableSync?: boolean;
  enableAutoExtraction?: boolean;
  extractionModel?: string;
  embeddingModel?: string;
  backup?: BackupConfig;
  retrieval?: RetrievalConfig;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}
```

## Hooks

### ContextHook

```typescript
import { createContextHook } from 'openclaw-memory/hooks';

const hook = createContextHook(options?: ContextHookOptions);

await hook.getContext(message: string, project?: string): ContextHookResult
hook.clearCache(): void
hook.getMetrics(): ContextHookMetrics
```

### ExtractionHook

```typescript
import { createExtractionHook } from 'openclaw-memory/hooks';

const hook = createExtractionHook(options?: ExtractionHookOptions);

await hook.extract(input: ConversationInput): ExtractionHookResult
hook.getQueueStatus(): QueueStatus
await hook.flush(): void
hook.getMetrics(): ExtractionHookMetrics
hook.isEnabled(): boolean
hook.setEnabled(enabled: boolean): void
```

## Events

```typescript
import { getMemoryEventEmitter } from 'openclaw-memory';

const emitter = getMemoryEventEmitter();

// Subscribe to events
const unsubscribe = emitter.subscribe(eventType: string, callback);

// Event types
type MemoryEventType =
  | 'system:initialized' | 'system:shutdown' | 'system:error'
  | 'memory:created' | 'memory:updated' | 'memory:deleted' | 'memory:searched'
  | 'extraction:queued' | 'extraction:started' | 'extraction:completed'
  | 'recall:started' | 'recall:completed' | 'recall:cached'
  | 'sync:started' | 'sync:completed' | 'sync:conflict'
  | 'backup:created' | 'backup:restored';
```

## Backup Functions

```typescript
import { createBackup, restoreBackup, listBackups, pruneBackups } from 'openclaw-memory';

await createBackup(dbPath: string, options?: BackupOptions): BackupResult
await restoreBackup(backupPath: string, options?: RestoreOptions): RestoreResult
await listBackups(backupDir?: string): BackupInfo[]
await pruneBackups(backupDir: string, keepCount: number): number
```
