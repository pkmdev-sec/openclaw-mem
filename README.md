# OpenClaw Smart Memory System

A standalone memory persistence system for AI agents. Designed for edge-first, offline-capable operation with cross-device sync support.

## Features

- **Vector Storage**: LanceDB-powered semantic search with 768-dimensional embeddings
- **Smart Extraction**: Automatic memory extraction from conversations using local LLMs
- **Context Retrieval**: Multi-query retrieval with intelligent ranking
- **Cross-Device Sync**: Syncthing integration for self-hosted synchronization
- **Disaster Recovery**: Compressed backups with checksums and point-in-time restore
- **CLI & REPL**: Command-line tools for standalone usage

## Quick Start

### Prerequisites

```bash
# Install Ollama (for local LLM)
curl -fsSL https://ollama.com/install.sh | sh

# Start Ollama service
ollama serve

# Pull required models
ollama pull nomic-embed-text
ollama pull qwen2.5:7b
```

### Installation

```bash
cd ~/openclaw-memory-prototype
npm install
```

### Basic Usage

```typescript
import { initMemorySystem, getMemorySystem } from 'openclaw-memory';

// Initialize
const system = await initMemorySystem({
  dbPath: '~/.openclaw-memory',
  enableSync: true,
  enableAutoExtraction: true,
});

// Store a memory
await system.memories.create({
  content: 'We use JWT tokens with 24-hour expiry for auth',
  category: 'decision',
  importance: 8,
  project: 'api-gateway',
  tags: ['auth', 'jwt'],
});

// Recall relevant context
const result = await system.recall('How does authentication work?', {
  project: 'api-gateway',
  maxTokens: 2000,
});

console.log(result.context);
```

### CLI Usage

```bash
# Check system status
npx tsx src/cli.ts status

# Search memories
npx tsx src/cli.ts recall "authentication best practices"

# List recent memories
npx tsx src/cli.ts list --limit 10

# Create backup
npx tsx src/cli.ts backup create

# Start interactive REPL
npx tsx src/repl.ts
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Memory System                          │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Storage  │  │Extraction│  │Retrieval │  │   Sync   │   │
│  │  Layer   │  │ Pipeline │  │  System  │  │  Layer   │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       │             │             │             │          │
│       v             v             v             v          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                    LanceDB                           │  │
│  │            (Embedded Vector Database)                │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Components

| Component | Purpose | Performance |
|-----------|---------|-------------|
| **Storage** | CRUD operations, vector indexing | ~27ms avg |
| **Extraction** | LLM-based memory extraction | 2.7s/conversation |
| **Retrieval** | Multi-query semantic search | ~7ms |
| **Sync** | Syncthing integration | Real-time |
| **Backup** | Compressed archives | ~14x compression |

## OpenClaw Integration

For integration with OpenClaw agents, use the provided hooks:

```typescript
import { createContextHook, createExtractionHook } from './hooks';

// Context injection for agent prompts
const contextHook = createContextHook({
  maxTokens: 2000,
  format: 'markdown',
  enableCache: true,
});

// Add memories to agent context
const { context, memoryCount } = await contextHook.getContext(userMessage, project);
systemPrompt += context;

// Auto-extract memories after conversations
const extractionHook = createExtractionHook({
  enabled: true,
  minLength: 50,
});

await extractionHook.extract({
  userMessage,
  assistantResponse,
  project,
});
```

## Performance

| Operation | Target | Actual | Status |
|-----------|--------|--------|--------|
| Vector Search | <100ms | ~7ms | 14x faster |
| Memory Create | - | ~34ms | - |
| Recall (warm) | - | <10ms | - |
| Extraction | <3s | 2.7s | On target |
| Backup compression | - | ~14x | - |

## Running Tests

```bash
# E2E integration tests
npx tsx src/test-e2e.ts

# Hook tests
npx tsx src/test-hooks.ts

# Memory system tests
npx tsx src/test-memory-system.ts

# Benchmarks
npx tsx src/benchmark.ts
```

## Documentation

- [Usage Guide](docs/USAGE.md) - Detailed CLI and REPL usage
- [Integration Guide](docs/INTEGRATION.md) - OpenClaw integration
- [API Reference](docs/API.md) - Complete API documentation
- [Architecture](docs/ARCHITECTURE.md) - Technical design

## License

MIT
