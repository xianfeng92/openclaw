# Project Neuro ADR 0004 Context Capture v1 Clipboard Active Window and Ring Buffer Bounds

Status: Accepted  
Date: 2026-02-12  
Owners: macOS Engineer, Windows Engineer, Gateway Lead  
Related:

- [Neuro Architecture and Backlog](/prd/project-neuro-architecture-and-task-breakdown)
- [ADR 0002 Event Contracts v1](/prd/project-neuro-adr-0002-event-contracts-v1)
- [ADR 0003 Redaction Baseline and Source Filters](/prd/project-neuro-adr-0003-redaction-baseline-source-filters)

---

## 1. Context

`TODO-P0-004` requires context capture v1 foundations:

- `clipboard` adapter
- `active_window` adapter
- bounded in-memory ring buffer by session/source

`TODO-P0-003` already established redaction and source filtering. `TODO-P0-004` must consume those guarantees while producing `context.event.v1` payloads.

---

## 2. Decision

Implement context capture v1 under `src/gateway/neuro`:

- `src/gateway/neuro/context-capture.ts`
- `src/gateway/neuro/context-ring-buffer.ts`

with tests:

- `src/gateway/neuro/context-capture.test.ts`
- `src/gateway/neuro/context-ring-buffer.test.ts`

The capture service emits `context.event.v1` events and pushes them into a volatile ring buffer.

---

## 3. Capture Adapters v1

## 3.1 Clipboard

- Best-effort command adapters:
  - macOS: `pbpaste`
  - Windows: `powershell/pwsh Get-Clipboard -Raw`
  - Linux fallback: `wl-paste` / `xclip`
- Empty/failed/denied reads are treated as no-data rather than hard failure.

## 3.2 Active Window

- Best-effort command adapters:
  - macOS: `osascript` via System Events for front app/window
  - Windows: PowerShell + Win32 foreground window lookup
- Permission-denied behavior is non-fatal and treated as no-data.

---

## 4. Ring Buffer Bounds

Bounds are enforced per source:

- TTL window
- max event count
- max byte budget

Defaults include:

- clipboard TTL: 30s
- active window TTL: 120s
- bounded max events and bytes per source

When byte pressure occurs, oldest entries are evicted; at least one most-recent entry is preserved to avoid empty snapshots during bursts.

---

## 5. Contract and Privacy Integration

- Every captured payload is transformed through `applyNeuroRedaction(...)`.
- Emitted event shape is `context.event.v1`.
- Capture service includes short-window duplicate suppression to reduce repeated identical events.

---

## 6. Validation

Primary verification:

- `pnpm test src/gateway/neuro/context-capture.test.ts`
- `pnpm test src/gateway/neuro/context-ring-buffer.test.ts`
- `pnpm test src/gateway/neuro/redaction.test.ts`
- `pnpm test src/gateway/protocol/schema/neuro.test.ts`
- `pnpm check`

Coverage includes:

- schema-valid event emission
- redaction assertions on captured payloads
- URL query stripping for active window payloads
- ring buffer TTL/count/byte cap behavior
- duplicate suppression behavior

---

## 7. Consequences

Positive:

- Delivers capture foundation needed before ingest endpoint work (`TODO-P0-005`).
- Keeps capture data volatile and bounded.
- Reuses redaction baseline to avoid raw sensitive payload retention.

Tradeoff:

- OS adapter commands are best-effort and may return no-data under restrictive permission environments.

---

## 8. Traceability

This decision fulfills:

- `TODO-P0-004` in [Prioritized TODO Backlog](/prd/project-neuro-architecture-and-task-breakdown#111-p0-must-deliver-for-ghost-layer-mvp)
