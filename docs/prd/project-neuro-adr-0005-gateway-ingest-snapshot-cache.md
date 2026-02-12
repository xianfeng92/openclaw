# Project Neuro ADR 0005 Gateway Ingest Endpoint and Snapshot Cache

Status: Accepted  
Date: 2026-02-12  
Owners: Gateway Lead  
Related:

- [Neuro Architecture and Backlog](/prd/project-neuro-architecture-and-task-breakdown)
- [ADR 0002 Event Contracts v1](/prd/project-neuro-adr-0002-event-contracts-v1)
- [ADR 0004 Context Capture v1 Ring Buffer](/prd/project-neuro-adr-0004-context-capture-v1-ring-buffer)

---

## 1. Context

`TODO-P0-005` requires a gateway side ingest path that accepts validated `context.event.v1` events and serves per-session volatile snapshots for invoke and planning paths.

Before this ADR:

- Event contracts existed (`context.event.v1` / `suggestion.card.v1` / `suggestion.feedback.v1`).
- Capture service and ring buffer existed in `src/gateway/neuro`.
- No dedicated gateway RPC path exposed ingest and snapshot operations.

---

## 2. Decision

Implement dedicated Neuro gateway RPC methods:

- `neuro.context.ingest`
- `neuro.context.snapshot`

with schema validation and a per-session in-memory cache shared through `GatewayRequestContext`.

---

## 3. API Contract

Added protocol schemas:

- `NeuroContextIngestParamsSchema`
- `NeuroContextIngestResultSchema`
- `NeuroContextSnapshotParamsSchema`
- `NeuroContextSnapshotResultSchema`

Added validators:

- `validateNeuroContextIngestParams`
- `validateNeuroContextSnapshotParams`

Method behavior:

- `neuro.context.ingest`
  - Validates payload and appends events into volatile ring buffer.
  - Returns accepted count, dropped count, and current cache stats.
- `neuro.context.snapshot`
  - Validates query and returns session snapshot metadata.
  - Supports `includeEvents` and `maxEvents` to bound payload size.

---

## 4. Runtime Integration

Runtime now initializes a shared `neuroContextCache` in gateway startup and injects it into request context:

- `src/gateway/server.impl.ts`
- `src/gateway/server-methods/types.ts`

Handlers are wired into method registry and auth scopes:

- `src/gateway/server-methods/neuro.ts`
- `src/gateway/server-methods.ts`
- `src/gateway/server-methods-list.ts`

Scope model:

- `neuro.context.ingest` -> write scope
- `neuro.context.snapshot` -> read scope

---

## 5. Validation

Primary verification:

- `pnpm check`
- `pnpm test src/gateway/server-methods/neuro.test.ts src/gateway/protocol/schema/neuro.test.ts`

Coverage includes:

- schema validation for ingest and snapshot params/results
- ingest write path to volatile cache
- snapshot query behavior (`maxEvents`, metadata only mode)
- invalid params rejection (`INVALID_REQUEST`)

---

## 6. Consequences

Positive:

- Delivers `TODO-P0-005` gateway data path required by invoke/planner stages.
- Keeps context data volatile and bounded in memory.
- Reuses existing ring buffer limits and redaction event model.

Tradeoff:

- Snapshot result currently defaults to in-memory data only; cross-process durability remains out of scope for P0.

---

## 7. Traceability

This decision fulfills:

- `TODO-P0-005` in [Prioritized TODO Backlog](/prd/project-neuro-architecture-and-task-breakdown#111-p0-must-deliver-for-ghost-layer-mvp)
