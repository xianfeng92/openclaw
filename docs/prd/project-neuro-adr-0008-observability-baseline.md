# Project Neuro ADR 0008 Observability Baseline

Status: Accepted  
Date: 2026-02-12  
Owners: Release SRE Engineer, QA Engineer  
Related:

- [Neuro Architecture and Backlog](/prd/project-neuro-architecture-and-task-breakdown)
- [ADR 0007 Feature Flags and Kill Switch Scaffold](/prd/project-neuro-adr-0007-feature-flags-kill-switch-scaffold)

---

## 1. Context

`TODO-P0-008` requires a baseline observability layer for invoke latency, memory pressure, and privacy-control activity.

Required metrics in P0:

- `ui_ready_ms`
- `first_token_ms`
- desktop and gateway memory
- redaction counters (`mask`, `block`)

---

## 2. Decision

Implement a lightweight in-memory metrics service with explicit read/write RPC methods:

- `neuro.metrics.get`
- `neuro.metrics.observe`

Data model:

- latency distributions for `uiReadyMs` and `firstTokenMs` with count/min/max/avg/p50/p95
- memory snapshot with gateway process memory and optional desktop-reported memory
- redaction counters for mask/block levels

---

## 3. Implementation

Gateway:

- Added `createNeuroMetrics` service in `src/gateway/neuro/metrics.ts`.
- Injected metrics service into request context in `src/gateway/server.impl.ts`.
- Wired first-token tracking:
  - run start in `src/gateway/server-methods/chat.ts`
  - first assistant token in `src/gateway/server-chat.ts`
- Wired redaction-level counters in `src/gateway/server-methods/neuro.ts` during context ingest.

Control UI:

- On gateway hello, report UI readiness and optional JS heap usage via `neuro.metrics.observe` in `ui/src/ui/app-gateway.ts`.

Protocol:

- Added metrics schemas/validators in:
  - `src/gateway/protocol/schema/neuro.ts`
  - `src/gateway/protocol/index.ts`
  - `src/gateway/protocol/schema/protocol-schemas.ts`
  - `src/gateway/protocol/schema/types.ts`

---

## 4. Validation

- Unit tests:
  - `src/gateway/neuro/metrics.test.ts`
  - `src/gateway/server-chat.agent-events.test.ts`
  - `src/gateway/server-methods/neuro.test.ts`
  - `src/gateway/protocol/schema/neuro.test.ts`
- Quality gate:
  - `pnpm check`

---

## 5. Consequences

Positive:

- P0 latency and memory signals are observable without logging raw user content.
- Metrics collection uses explicit RPC contracts and can be consumed by later dashboards.

Tradeoff:

- Current metrics are process-local and reset on restart; long-term retention/export is deferred to later phases.

---

## 6. Traceability

This ADR fulfills:

- `TODO-P0-008` in [Prioritized TODO Backlog](/prd/project-neuro-architecture-and-task-breakdown#111-p0-must-deliver-for-ghost-layer-mvp)
