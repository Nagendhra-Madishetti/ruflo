---
name: loop
description: Start a /loop worker for periodic Ruflo task execution
---
$ARGUMENTS
Start a cache-aware /loop worker. Parse the worker name from $ARGUMENTS.

Available workers:
- **audit** (critical) -- security scanning
- **optimize** (high) -- performance optimization
- **testgaps** (normal) -- test coverage analysis
- **map** (normal) -- codebase mapping
- **consolidate** (low) -- memory consolidation
- **predict** (normal) -- predictive preloading
- **document** (normal) -- auto-documentation

Run the worker via `npx @claude-flow/cli@latest hooks worker dispatch --trigger WORKER_NAME`, then use `ScheduleWakeup` with delay 270s (cache-warm) to schedule the next iteration.
