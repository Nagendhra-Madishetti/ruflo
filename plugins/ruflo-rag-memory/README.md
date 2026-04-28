# ruflo-rag-memory

RuVector memory with HNSW search, AgentDB, and semantic retrieval.

## Install

```
/plugin marketplace add ruvnet/ruflo
/plugin install ruflo-rag-memory@ruflo
```

## What's Included

- **HNSW Vector Search**: 150x-12,500x faster pattern retrieval with persistent indexes
- **AgentDB**: 19 controllers for memory, sessions, patterns, trajectories, and feedback
- **Semantic Retrieval**: Smart retrieval with MMR diversity and recency scoring
- **ONNX Embeddings**: all-MiniLM-L6-v2 (384 dimensions) for cross-platform search
- **Claude Memory Bridge**: Auto-import from Claude Code's native memory into AgentDB
- **Unified Search**: Query across all namespaces (claude-memories, patterns, tasks, feedback)

## Requires

- `ruflo-core` plugin (provides MCP server)
