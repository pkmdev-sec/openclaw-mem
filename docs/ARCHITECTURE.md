# Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Memory System                                  │
│                                                                         │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐      │
│  │  Context    │ │ Extraction  │ │   Backup    │ │    Sync     │      │
│  │   Hook      │ │    Hook     │ │   Manager   │ │   Manager   │      │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬──────┘      │
│         │               │               │               │              │
│         v               v               v               v              │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                     MemorySystem (Orchestrator)                  │  │
│  │                                                                   │  │
│  │  ┌─────────┐  ┌─────────────┐  ┌───────────┐  ┌───────────┐    │  │
│  │  │  CRUD   │  │  Retrieval  │  │ Extraction │  │   Events  │    │  │
│  │  │ Manager │  │  Pipeline   │  │  Pipeline  │  │  Emitter  │    │  │
│  │  └────┬────┘  └──────┬──────┘  └─────┬─────┘  └───────────┘    │  │
│  │       │              │               │                          │  │
│  │       v              v               v                          │  │
│  │  ┌──────────────────────────────────────────────────────────┐  │  │
│  │  │                    Connection Manager                     │  │  │
│  │  │                      (LanceDB)                            │  │  │
│  │  └──────────────────────────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    v
┌─────────────────────────────────────────────────────────────────────────┐
│                         File System Storage                              │
│                                                                         │
│    ~/.openclaw-memory/                                                  │
│    ├── memories.lance/    # LanceDB vector data                        │
│    ├── config.json        # System configuration                        │
│    └── backups/           # Compressed backup archives                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Memory Storage

```
User Input
    │
    v
┌───────────────┐
│ CreateMemory  │
└───────┬───────┘
        │
        v
┌───────────────┐     ┌───────────────┐
│   Validate    │────>│   Generate    │
│    Input      │     │   Embedding   │
└───────────────┘     └───────┬───────┘
                              │
                              v
                      ┌───────────────┐
                      │   Store in    │
                      │   LanceDB     │
                      └───────────────┘
```

### Context Retrieval

```
User Query
    │
    v
┌───────────────┐
│ Intent Analyze│ ──> "What type of query is this?"
└───────┬───────┘
        │
        v
┌───────────────┐
│ Multi-Query   │ ──> Generate 3-5 search queries
│ Generation    │
└───────┬───────┘
        │
        v
┌───────────────┐
│ Parallel      │ ──> Execute queries concurrently
│ Vector Search │
└───────┬───────┘
        │
        v
┌───────────────┐
│ Ranking &     │ ──> Score = 50% semantic + 20% recency + 30% project
│ Deduplication │
└───────┬───────┘
        │
        v
┌───────────────┐
│ Context       │ ──> Format as markdown/xml/plain
│ Formatting    │
└───────────────┘
```

### Extraction Pipeline

```
Conversation
    │
    v
┌───────────────┐
│ Pre-filter    │ ──> Skip greetings, short messages
└───────┬───────┘
        │
        v
┌───────────────┐
│ LLM Extract   │ ──> Qwen 2.5 7B identifies facts
└───────┬───────┘
        │
        v
┌───────────────┐
│ Post-process  │ ──> Validate, categorize, score
└───────┬───────┘
        │
        v
┌───────────────┐
│ Batch Store   │ ──> Store with embeddings
└───────────────┘
```

## Key Design Decisions

### 1. LanceDB for Storage
- **Rationale**: Embedded, file-based, fast vector search
- **Trade-off**: Less mature than Postgres/pgvector but simpler deployment

### 2. Local LLM (Qwen 2.5 7B)
- **Rationale**: Privacy, no API costs, fast on Apple Silicon
- **Trade-off**: Lower accuracy than GPT-4 but acceptable for extraction

### 3. Syncthing for Sync
- **Rationale**: Self-hosted, automatic, handles conflicts
- **Trade-off**: Requires manual setup but no cloud dependency

### 4. Last-Write-Wins Conflict Resolution
- **Rationale**: Simple, predictable behavior
- **Trade-off**: May lose data in rare edge cases

### 5. Multi-Query Retrieval
- **Rationale**: Maximizes recall accuracy
- **Trade-off**: Higher latency but better results

### 6. Background Extraction
- **Rationale**: Zero impact on conversation latency
- **Trade-off**: Memories not immediately available

## Performance Characteristics

| Component | Latency | Bottleneck |
|-----------|---------|------------|
| Memory Create | 34ms | Embedding generation |
| Vector Search | 7ms | LanceDB query |
| Full Recall | 6-7s (cold) | LLM intent analysis |
| Full Recall (warm) | <100ms | Cache hit |
| Extraction | 2.7s | LLM processing |
| Backup | 20ms | Compression |

## Scalability

- **Memory Count**: Tested up to 1000 memories, 7ms search
- **Concurrent Queries**: Supports parallel recall requests
- **Database Size**: LanceDB handles millions of vectors
- **Sync Volume**: Syncthing handles large file changes

## Security Considerations

- All data stored locally
- No cloud transmission (unless Syncthing configured)
- Backups include checksums
- No sensitive data in logs
