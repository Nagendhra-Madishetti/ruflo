# ADR-033: Ruvocal WASM-MCP Integration from RuVector Upstream

**Status:** Proposed
**Date:** 2026-05-01
**Author:** Ruflo Team
**Deciders:** Engineering
**Related:** ADR-002-WASM-CORE-PACKAGE, ADR-029-HUGGINGFACE-CHAT-UI-CLOUD-RUN, ADR-030-MCP-TOOL-GAP-ANALYSIS, ADR-032-RVF-PRIVATE-MCP-TUNNEL

---

## Context

The local copy of the Ruvocal chat UI at `ruflo/src/ruvocal/` is a snapshot fork of the SvelteKit-based HuggingFace `chat-ui` (v0.20.0). The canonical upstream lives at `ruvnet/RuVector/ui/ruvocal` and has diverged with substantial new functionality, primarily an in-browser **WASM MCP server** powered by `rvagent-wasm`.

A directory-level diff between upstream and local shows:

**Net-new in upstream (absent locally):**
- `src/lib/wasm/` — WASM loader, types, IndexedDB persistence, capability tests (84 KB)
- `src/lib/components/wasm/GalleryPanel.svelte` — UI for browsing/loading WASM templates
- `src/lib/components/FoundationBackground.svelte`
- `src/lib/stores/wasmMcp.ts` — Svelte store wrapping WASM MCP server lifecycle
- `src/lib/constants/rvagentPresets.ts` — preset templates
- `src/lib/server/textGeneration/mcp/wasmTools.test.ts`
- `static/wasm/rvagent_wasm.js` + `rvagent_wasm_bg.wasm` — compiled WASM bundle (~588 KB)
- `config/branding.env.example`

**Modified upstream (incompatible drift in local):**
- Chat components: `ChatInput`, `ChatMessage`, `ChatWindow`, `ChatIntroduction`, `BlockWrapper`, `TaskGroup`, `ToolUpdate`, `FileDropzone`
- MCP UI: `MCPServerManager`, `AddServerForm`, `ServerCard`
- Servers: `lib/server/mcp/clientPool.ts`, `httpClient.ts`, `lib/server/router/toolsRoute.ts`, `lib/server/textGeneration/index.ts`, `runMcpFlow.ts`, `toolInvocation.ts`, `types.ts`, `utils/toolPrompt.ts`
- Stores/utils: `mcpServers.ts`, `settings.ts`, `Settings.ts`, `Tool.ts`, `messageUpdates.ts`, `switchTheme.ts`
- Routes: `+layout.svelte`, `models/+page.svelte`, settings layout/model pages, `conversation/[id]/+page.svelte` & `+server.ts`, `api/mcp/health/+server.ts`, `api/mcp/servers/+server.ts`, `api/v2/user/settings/+server.ts`
- Visual/branding: `app.html`, `styles/main.css`, `static/chatui/{favicon,icon,logo}.svg`, `static/chatui/manifest.json`
- Misc: `Modal.svelte`, `NavMenu.svelte`, `RuFloUniverse.svelte`, `Switch.svelte`, `WelcomeModal.svelte`, `Logo.svelte`, `mcpExamples.ts`, `.gitignore`, `rvf.manifest.json`

**Local-only (must preserve):**
- `mcp-bridge/index.js` — local MCP bridge implementation (absent in upstream)
- `src/routes/api/v2/debug/` — debug routes used by ruflo
- `stub/@reflink/reflink/index.js` — reflink stub
- `.env` — populated local environment
- `package-lock.json` — local lockfile
- All ruflo-specific docs/CLAUDE.md guidance

`package.json` is identical between local and upstream — no dependency changes required.

## Decision

We will pull the upstream improvements into `ruflo/src/ruvocal/` on a dedicated feature branch (`feat/ruvocal-wasm-mcp-integration`) using a **directory-level overlay strategy** rather than a Git merge, because the local snapshot has no shared history with the upstream repository.

The integration is staged in three commits to keep the diff reviewable:

1. **NEW files** — copy WASM core, components, stores, constants, static assets, and config example. Pure additions; cannot break existing behavior.
2. **MODIFIED files** — overwrite divergent files with upstream versions, then re-apply local-only customizations:
   - Restore `src/routes/api/v2/debug/` after upstream overlay (upstream lacks it).
   - Restore `mcp-bridge/index.js` after overlay.
   - Restore `stub/@reflink/reflink/index.js`.
   - Keep local `.env` and `package-lock.json` untouched.
3. **Verification** — `npm install`, `npm run check`, `npm run build`, then local docker compose + `ruflo-browser` smoke test.

The `package.json` overlay is safe because it is byte-identical.

### What we are explicitly NOT doing

- No Git submodule or subtree linkage to RuVector — keeps the snapshot model intact.
- No changes to `ruflo/src/chat-ui/` (the thin HF base-image wrapper) in this ADR.
- No Cloud Run deployment in this change — that is tracked separately under ADR-011 / ADR-029.
- No upstream contribution back to RuVector at this time.

## Consequences

**Positive:**
- Brings in-browser WASM MCP capability — chat UI gains local tool execution without a backend bridge for the supported tool set.
- Aligns local with canonical upstream, narrowing the divergence we have to maintain by hand.
- New `GalleryPanel` UX for browsing rvagent templates.
- Tests added (`wasmTools.test.ts`, `wasm-capabilities.test.ts`) raise the coverage floor.

**Negative / risks:**
- Increases bundle size by ~588 KB (the WASM artifact). Loaded lazily via `browser`-gated dynamic import, so initial paint is unaffected.
- Local-only files (`mcp-bridge/index.js`, `routes/api/v2/debug/`) must be re-applied after each upstream sync; this ADR documents that requirement so future syncs don't drop them.
- Modified server-side files (`clientPool`, `httpClient`, `toolsRoute`, `runMcpFlow`, etc.) may interact with the local mcp-bridge differently than upstream's. Smoke test before merge.
- Changes to `Settings.ts` / `Tool.ts` types could ripple into ruflo packages that import from `src/ruvocal`. Mitigation: run `npm run check` before merging.

**Rollback:** revert the feature branch; no data migrations, no external service changes.

## Verification

Acceptance criteria for merging the branch:

- [ ] `npm install` succeeds.
- [ ] `npm run check` passes (svelte-check, no new TS errors).
- [ ] `npm run build` produces a working bundle.
- [ ] `npm run test` — `wasmTools.test.ts` and `wasm-capabilities.test.ts` pass.
- [ ] `docker compose up -d` brings up MongoDB; `npm run dev` serves at `http://localhost:5173`.
- [ ] `ruflo-browser` smoke test: load the home page, open the gallery panel, send a message through a non-WASM model, confirm no console errors.
- [ ] Local-only files still present after overlay: `mcp-bridge/index.js`, `routes/api/v2/debug/`, `stub/@reflink/reflink/index.js`, `.env`, `package-lock.json`.

## Deployment

Cloud Run deployment is **out of scope for this PR** but the path is staged in `ruflo/src/ruvocal/cloudbuild.yaml`. Two infrastructure prerequisites must be satisfied before the first deploy:

1. **MongoDB endpoint** — HF chat-ui requires a Mongo server. Cloud Run cannot run Mongo natively. Two options:
   - **MongoDB Atlas free tier** (M0): create a cluster, get the connection string, store as Secret Manager secret `ruvocal-mongodb-url`.
   - **Cloud Run multi-container** (sidecar): deploy a `mongo:8` sidecar in the same revision; main container connects to `localhost:27017`. Requires `--container` flags on `gcloud run deploy`.
2. **AI provider secrets** — already exist in `ruv-dev` Secret Manager per ADR-029: `openai-api-key`, `google-api-key`, `openrouter-api-key`.

Once both are in place:

```bash
cd ruflo/src/ruvocal
gcloud builds submit --config=cloudbuild.yaml --project=ruv-dev --region=us-central1
```

Validation after deploy: `npx agent-browser open <run-url>` then check console for `[WASM MCP] Server initialized successfully · 18 tools`.

The thin `ruflo/src/chat-ui/Dockerfile` wrapper (FROM `ghcr.io/huggingface/chat-ui-db:latest`) is **unsuitable** for deploying this integration — it can only patch the upstream HF base image with a few static files; it cannot include compiled WASM source. The full ruvocal Dockerfile build is required.

## References

- Upstream source: `https://github.com/ruvnet/ruvector` → `ui/ruvocal/`
- Local target: `ruflo/src/ruvocal/`
- Branch: `feat/ruvocal-wasm-mcp-integration`
- PR: https://github.com/ruvnet/ruflo/pull/1687
- Cloud Build config: `ruflo/src/ruvocal/cloudbuild.yaml`
- Related deployment ADR: ADR-029 (HF Chat UI on Cloud Run)
