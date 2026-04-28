---
name: recall
description: Semantic recall — search AgentDB and Claude Code memories by meaning
---
$ARGUMENTS

Semantic recall across all memory namespaces using HNSW vector search.

```bash
npx @claude-flow/cli@latest memory search --query "$ARGUMENTS" --limit 5
```

This searches across patterns, tasks, solutions, feedback, and claude-memories namespaces. Results are ranked by cosine similarity with MMR diversity reranking.

If no arguments provided, show recent memory entries:
```bash
npx @claude-flow/cli@latest memory list --limit 10
```
