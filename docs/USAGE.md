# Usage Guide

## CLI Reference

The CLI provides a comprehensive set of commands for managing the memory system.

### Status

Check system status:

```bash
npx tsx src/cli.ts status
npx tsx src/cli.ts status --json  # JSON output
```

### Recall

Search for relevant memories:

```bash
# Basic search
npx tsx src/cli.ts recall "How does authentication work?"

# With options
npx tsx src/cli.ts recall "auth setup" --project api-gateway --limit 5

# JSON output
npx tsx src/cli.ts recall "testing strategy" --json
```

Options:
- `--project <name>` - Filter/boost by project
- `--limit <n>` - Maximum memories to return (default: 10)
- `--format <type>` - Output format: markdown, xml, plain, compact
- `--json` - Return raw JSON

### List

List recent memories:

```bash
# List last 10 memories
npx tsx src/cli.ts list

# With filters
npx tsx src/cli.ts list --limit 20 --project frontend
```

### Store

Store a conversation for extraction:

```bash
npx tsx src/cli.ts store "We decided to use PostgreSQL for the database"
npx tsx src/cli.ts store "..." --project backend
```

### Backup Commands

```bash
# Create backup
npx tsx src/cli.ts backup create
npx tsx src/cli.ts backup create --name "before-migration"

# List backups
npx tsx src/cli.ts backup list

# Restore from backup
npx tsx src/cli.ts backup restore ./backups/backup-2024-01-01.tar.gz
```

### Sync Commands

```bash
# Check sync status
npx tsx src/cli.ts sync status

# Get setup instructions
npx tsx src/cli.ts sync setup
```

### Config Commands

```bash
# Show current config
npx tsx src/cli.ts config show

# Update config
npx tsx src/cli.ts config set retrieval.maxTokens 3000
npx tsx src/cli.ts config set logLevel debug
```

## Interactive REPL

Start the interactive REPL:

```bash
npx tsx src/repl.ts
```

### REPL Commands

| Command | Description |
|---------|-------------|
| `.recall <query>` | Search for memories |
| `.store <text>` | Store text for extraction |
| `.list` | List recent memories |
| `.get <id>` | Get memory by ID |
| `.delete <id>` | Delete memory |
| `.status` | Show system status |
| `.help` | Show help |
| `.quit` | Exit |

### Natural Language Mode

Simply type a question to recall relevant memories:

```
> How do we handle rate limiting?
[Returns relevant context]

> remember: The API uses Redis for session storage
[Stores for extraction]
```

## Configuration

Configuration is stored in `~/.openclaw-memory/config.json`:

```json
{
  "dbPath": "~/.openclaw-memory",
  "enableSync": true,
  "enableAutoExtraction": true,
  "extractionModel": "qwen2.5:7b",
  "embeddingModel": "nomic-embed-text",
  "backup": {
    "autoBackup": true,
    "interval": 24,
    "maxBackups": 10
  },
  "retrieval": {
    "maxTokens": 2000,
    "minScore": 0.5,
    "maxResults": 10,
    "defaultFormat": "markdown"
  },
  "logLevel": "info"
}
```

## Best Practices

1. **Project Organization**: Use consistent project names for better context
2. **Importance Scoring**: Use 1-3 for low, 4-6 for medium, 7-10 for high
3. **Tags**: Add relevant tags for additional filtering
4. **Backups**: Create backups before major changes
5. **Sync**: Set up Syncthing for cross-device access
