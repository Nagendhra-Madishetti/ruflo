---
name: memory
description: Store, search, retrieve, and list entries in AgentDB memory with vector search
---
$ARGUMENTS

Memory CRUD operations with HNSW-indexed vector search (150x-12,500x faster).

**Store**: `npx @claude-flow/cli@latest memory store --key "KEY" --value "VALUE" --namespace NAMESPACE`
**Search**: `npx @claude-flow/cli@latest memory search --query "QUERY" --namespace NAMESPACE --limit 5`
**Retrieve**: `npx @claude-flow/cli@latest memory retrieve --key "KEY" --namespace NAMESPACE`
**List**: `npx @claude-flow/cli@latest memory list --namespace NAMESPACE --limit 10`
**Delete**: `npx @claude-flow/cli@latest memory delete --key "KEY" --namespace NAMESPACE`

Default namespace is "default". Common namespaces: patterns, tasks, solutions, feedback, claude-memories.

Parse $ARGUMENTS to determine the operation and parameters. If no arguments, run `memory list`.
