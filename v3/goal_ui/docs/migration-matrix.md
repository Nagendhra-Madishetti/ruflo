# Migration Matrix — `v3/goal_ui/` Supabase → RVF

> Step 04 deliverable. Authoritative classification of every workflow and every edge function for the migration. Drives Steps 09 (RVF backend), 11 (POC), 18 (table migration), 19 (function port), 21 (Supabase removal).

## Target classifications

| Target | Where it runs | Reads from | Writes to |
|--------|---------------|------------|-----------|
| `RVF_BROWSER` | Browser, IndexedDB-backed | IndexedDB → `src/integrations/rvf/` | IndexedDB |
| `LOCAL_FN` | Node Hono server on `:8787` (dev only) | env-side keys + `RVF_NODE` | `RVF_NODE` |
| `GCF` | Google Cloud Functions (prod) | env-side keys + `RVF_NODE` (same handler as LOCAL_FN) | `RVF_NODE` |
| `DEFER` | unwired today; decision in Step 21 | — | — |
| `OUT_OF_SCOPE` | not migrated by ADR-093 | — | — |

`LOCAL_FN` and `GCF` always pair: same `handler.ts` exported once for Hono and once as a GCF entrypoint. The classification means "implement once, deploy two ways."

## Per-workflow classifications

| Workflow | Trigger UI | Today | Target | Justification |
|---|---|---|---|---|
| **W-1a** generate suggested goal | `GoalInput` G-05..G-12 | `supabase.functions.invoke('generate-research-goal')` | `LOCAL_FN` + `GCF` | LLM call; key MUST stay server-side; same shape, swap the URL |
| **W-1b** optimize config (parallel) | `GoalInput` G-05..G-12 | `supabase.functions.invoke('optimize-research-config')` | `LOCAL_FN` + `GCF` | LLM call; key server-side; same handler as W-4 |
| **W-2** run a research step | `Index.tsx` plan execution | `supabase.functions.invoke('research-step')` (×N steps) | `LOCAL_FN` + `GCF` | LLM call (hot path); key server-side; potential streaming target later |
| **W-3** generate action items | `ResearchReportModal` mount | `supabase.functions.invoke('generate-action-items')` | `LOCAL_FN` + `GCF` | LLM call; key server-side |
| **W-4** optimize config (preset trigger) | `ReviseResearchForm` preset change | `supabase.functions.invoke('optimize-research-config')` | `LOCAL_FN` + `GCF` | Same handler as W-1b — no separate impl |
| **W-5** streaming research API | (unwired in `src/`) | `supabase.functions.invoke('research-api')` (no client callsite) | `DEFER` | Unwired today. Step 21 decides: delete handler, OR re-host as `LOCAL_FN` + `GCF` if treated as a public API surface |

All 5 edge functions are accounted for. Zero `KEEP_SUPABASE` rows.

## Per-state classifications (client-side persistence)

The app today has **zero Supabase tables** but also **zero client persistence** (everything is React state, lost on reload). Migration ADDS persistence via RVF.

| State | Source today | Target | Justification |
|---|---|---|---|
| `userGoal` / `researchGoal` | React state | `RVF_BROWSER` | Recovers in-flight goal across reloads; semantic-search target for "similar past goals" feature |
| `researchSteps[]` (plan tree) | React state | `RVF_BROWSER` | Multi-minute LLM execution shouldn't disappear on a tab refresh; keyed by goal id |
| `researchConfig` | React state | `RVF_BROWSER` | Sticky preferences improve UX |
| `widgetConfig` | React state (likely localStorage today — verify in Step 09) | `RVF_BROWSER` | Unified store; keep widget-bucket separate |
| `finalRecommendations` | React state, derived | `RVF_BROWSER` (cache only) | Derived from plan, but caching avoids re-running W-3 |
| `aiModel` selection | React state | `RVF_BROWSER` | Same reason as `widgetConfig` |
| Auth / sessions | (none today) | `OUT_OF_SCOPE` | Local-first acceptable for v0.1; revisit in a follow-up ADR if multi-device sync required |

## Per-source-file classification

| File | Today | After migration |
|---|---|---|
| `src/integrations/supabase/client.ts` | re-exports `supabase` from `@supabase/supabase-js` | DELETED in Step 21 |
| `src/integrations/supabase/types.ts` | auto-generated DB types (mostly empty since no tables used) | DELETED in Step 21 |
| `src/integrations/supabase/` (dir) | data layer | DELETED |
| `src/integrations/rvf/` (NEW) | — | Browser RVF backend (Step 09) — IndexedDB-backed, format-compatible with `@claude-flow/memory` Node RVF |
| `src/integrations/functions/` (NEW) | — | Thin fetch client to `LOCAL_FN`/`GCF` endpoints (Step 19) — uses `VITE_FUNCTIONS_BASE_URL` |
| `functions/` (NEW, repo root or `v3/goal_ui/functions/`) | — | One subdir per former edge function: `index.ts` (GCF entrypoint) + `handler.ts` (shared logic) + `server.ts` mounting all handlers locally |
| `supabase/functions/` | 5 Deno-style edge functions | DELETED in Step 21 (after porting). Logic lives in `functions/`. |

## Per-environment-variable classification

| Var | Today | After |
|---|---|---|
| `VITE_SUPABASE_URL` | Vite-exposed, browser uses it | REMOVED |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Vite-exposed (anon) | REMOVED |
| `VITE_SUPABASE_PROJECT_ID` | Vite-exposed | REMOVED |
| `VITE_RVF_ENABLED` | (NEW) Vite-exposed | feature flag, default `true` in dev once Step 11 lands |
| `VITE_FUNCTIONS_BASE_URL` | (NEW) Vite-exposed | `http://localhost:8787` in dev, GCF URL in prod |
| `VITE_FUNCTIONS_PUBLIC_TOKEN` | (NEW) Vite-exposed | Weak abuse-control token; pair with `RUFLO_FUNCTIONS_TOKEN` (server-side) |
| `LOVABLE_API_KEY` | server-side (today, in Lovable Cloud env) | KEPT, but only in `LOCAL_FN`/`GCF` env — never `VITE_*` |
| `ANTHROPIC_API_KEY` | (optional NEW) server-side | If we replace the Lovable Gateway with direct Anthropic calls |
| `RUFLO_FUNCTIONS_TOKEN` | (NEW) server-side only | Validated by every function handler against the bundle's `VITE_FUNCTIONS_PUBLIC_TOKEN` |

**Vite secret rule** — anything WITHOUT the `VITE_` prefix is server-side by Vite construction. Step 22a adds CI grep that blocks committing strings matching `sk-`, `sk-ant-`, `AIza` patterns.

## Decision log

1. **Why `LOCAL_FN`+`GCF` and not browser→LLM direct?** User direction: keep API keys server-side. Browser→Anthropic exposes the key via dev tools / network tab; rate-limit + abuse-control belongs server-side anyway.
2. **Why `DEFER` for W-5 (`research-api`)?** Zero client callsites today. Could be a public API or just dead code. Decision in Step 21 needs git-blame + intent confirmation.
3. **Why `RVF_BROWSER` for state, not `LOCAL_FN`?** State is per-user, no auth, browser-tab-local. Sending it to a server adds latency + multi-user complexity ADR-093 explicitly defers (`OUT_OF_SCOPE` for auth).
4. **Why no `KEEP_SUPABASE` rows?** User direction. Supabase is removed entirely; auth is `OUT_OF_SCOPE` rather than punted to Supabase.
5. **What about Lovable AI Gateway?** Today edge functions call `https://ai.gateway.lovable.dev/...` with `LOVABLE_API_KEY`. Two paths in Step 19:
   - **Path A (continuity):** `LOCAL_FN`/`GCF` keep calling the Lovable Gateway, just from a different host. Minimal change.
   - **Path B (independence):** Replace with direct Anthropic SDK calls; new `ANTHROPIC_API_KEY`. More work, more control, no third-party gateway dependency.
   - Default = Path A in Step 19; Path B as a follow-up if the user wants to drop the Lovable dep.

## Step ordering implications

- **Step 09** (RVF browser backend) — must build a Map-like API: `getOne(key)`, `query(filter)`, `upsert(key, value)`, `delete(key)`, plus `searchByVector(vec, k)`. Mirror `IMemoryBackend` from `@claude-flow/memory` so server and browser stay format-compatible.
- **Step 11** (POC) — pick `widgetConfig` or `researchConfig` for the POC swap. Smallest blast radius (no LLM coupling, no plan-tree complexity).
- **Step 19** (function port) — port `generate-research-goal` first (simplest signature, no streaming, no `previousStepsData`).
- **Step 21** (Supabase removal) — concrete checklist:
  1. `npm uninstall @supabase/supabase-js`
  2. `git rm -r src/integrations/supabase/`
  3. `git rm -r supabase/`
  4. Update `example.env` (drop VITE_SUPABASE_*, add new vars)
  5. Decide W-5 fate (delete handler or move to `functions/research-api/`)

## Phase-level summary

- **Phase 1 (Steps 5–9)** delivers `src/integrations/rvf/` (browser RVF backend) + Vite WASM config + feature flag.
- **Phase 2 (Steps 10–12)** delivers a working RVF write/read for ONE workflow + measurement.
- **Phase 3 (Steps 13–17)** delivers Playwright e2e harness covering 76 elements + 4 wired workflows × 5 paths.
- **Phase 4 (Steps 18–21)** delivers `functions/` directory + every Supabase callsite migrated + Supabase fully removed.
- **Phase 5 (Steps 22a-e, 23, 24)** delivers security hardening + branding pass + widget verification.
- **Phase 6 (Steps 25, 26)** delivers final checkpoint + PR.
