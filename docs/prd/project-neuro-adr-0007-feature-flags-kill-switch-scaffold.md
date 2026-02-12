# Project Neuro ADR 0007 Feature Flags and Kill Switch Scaffold

Status: Accepted  
Date: 2026-02-12  
Owners: Release SRE Engineer, Gateway Lead  
Related:

- [Neuro Architecture and Backlog](/prd/project-neuro-architecture-and-task-breakdown)
- [ADR 0005 Gateway Ingest and Snapshot Cache](/prd/project-neuro-adr-0005-gateway-ingest-snapshot-cache)

---

## 1. Context

`TODO-P0-007` requires runtime-controllable feature gates for Neuro behavior so rollout risk can be contained without redeploy.

Required scope for the P0 scaffold:

- proactive cards gate
- flow mode gate
- preference sync gate
- global kill switch

---

## 2. Decision

Implement an in-memory Neuro flag service in gateway with explicit RPC controls:

- `neuro.flags.get`
- `neuro.flags.set`
- event broadcast `neuro.flags.changed`

Flag model:

- configured flags: `proactiveCards`, `flowMode`, `preferenceSync`, `killSwitch`
- effective flags: all feature flags forced off when `killSwitch=true`

This keeps the first implementation simple and deterministic while preserving a clean surface for later persistence/remote config.

---

## 3. Implementation

Gateway runtime:

- Added `createNeuroFeatureFlags` service in `src/gateway/neuro/feature-flags.ts`.
- Injected service into gateway request context from `src/gateway/server.impl.ts`.

Protocol and handlers:

- Added Neuro flag schemas and validators in `src/gateway/protocol/schema/neuro.ts` and `src/gateway/protocol/index.ts`.
- Added handlers in `src/gateway/server-methods/neuro.ts`.
- Registered methods/events in:
  - `src/gateway/server-methods-list.ts`
  - `src/gateway/server-methods.ts` (scope gating)

---

## 4. Validation

- Unit tests:
  - `src/gateway/neuro/feature-flags.test.ts`
  - `src/gateway/server-methods/neuro.test.ts`
  - `src/gateway/protocol/schema/neuro.test.ts`
- Quality gate:
  - `pnpm check`

---

## 5. Consequences

Positive:

- Flags can be toggled at runtime through stable RPC interfaces.
- Kill switch semantics are centralized and easy to audit.

Tradeoff:

- Current scaffold is process-local and non-persistent; restart resets to defaults until config-backed storage is introduced.

---

## 6. Traceability

This ADR fulfills:

- `TODO-P0-007` in [Prioritized TODO Backlog](/prd/project-neuro-architecture-and-task-breakdown#111-p0-must-deliver-for-ghost-layer-mvp)
