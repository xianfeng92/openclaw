# Project Neuro ADR 0002 Event Contracts v1

Status: Accepted  
Date: 2026-02-12  
Owners: AI Architect, Gateway Lead  
Related:

- [Neuro Architecture and Backlog](/prd/project-neuro-architecture-and-task-breakdown)
- [ADR 0001 Scope Freeze and Windows Baseline](/prd/project-neuro-adr-0001-scope-freeze-windows-baseline)

---

## 1. Context

`TODO-P0-002` requires canonical event contracts for:

- `context.event.v1`
- `suggestion.card.v1`
- `suggestion.feedback.v1`

Without fixed schemas, desktop clients, gateway ingest, and planner feedback loops can drift.

---

## 2. Decision

We standardize v1 contracts as TypeBox schemas and enforce them with AJV validation tests.

Canonical implementation files:

- `src/gateway/protocol/schema/neuro.ts`
- `src/gateway/protocol/schema/neuro.test.ts`

These schemas are exported from protocol schema barrel:

- `src/gateway/protocol/schema.ts`
- `src/gateway/protocol/schema/types.ts`

---

## 3. Contract Definitions

## 3.1 `context.event.v1`

Required fields:

- `version`: `"context.event.v1"`
- `eventId`: non-empty string
- `ts`: integer epoch milliseconds
- `sessionKey`: non-empty string
- `source`: `clipboard | active_window | terminal | fs | editor`
- `payload`: object map
- `redaction`:
  - `applied`: boolean
  - `level`: `none | mask | hash | block`
  - `reasons`: string array
- `bounds`:
  - `bytes`: integer
  - `dropped`: boolean

## 3.2 `suggestion.card.v1`

Required fields:

- `version`: `"suggestion.card.v1"`
- `suggestionId`: non-empty string
- `sessionKey`: non-empty string
- `confidence`: number in range `[0, 1]`
- `mode`: `safe | flow`
- `actions`: non-empty unique array of `apply | dismiss | undo | explain`
- `expiresAt`: integer epoch milliseconds

## 3.3 `suggestion.feedback.v1`

Required fields:

- `version`: `"suggestion.feedback.v1"`
- `suggestionId`: non-empty string
- `action`: `accept | dismiss | modify | ignore`
- `ts`: integer epoch milliseconds
- `sessionKey`: non-empty string

---

## 4. Compatibility Rules

- Versioned event names are immutable once released (`*.v1`).
- New optional fields are allowed only via version bump planning and migration note.
- Breaking changes require a new contract version (`v2`) and coexistence period.
- Unknown top-level fields are rejected in v1 (`additionalProperties: false`).

---

## 5. Test Samples

Validation samples are executable tests in:

- `src/gateway/protocol/schema/neuro.test.ts`

Coverage includes:

- valid `context.event.v1` payload
- invalid `context.event.v1` missing required field
- valid `suggestion.card.v1` payload
- invalid `suggestion.card.v1` confidence out of range
- valid `suggestion.feedback.v1` payload
- invalid `suggestion.feedback.v1` unknown action

---

## 6. Consequences

Positive:

- Desktop and gateway have one source of truth for event payloads.
- Planner and analytics paths can safely consume validated events.
- Tests provide regression guardrail for schema drift.

Tradeoff:

- Strict top-level schemas may require quicker version bumps when adding fields.

---

## 7. Traceability

This decision fulfills:

- `TODO-P0-002` in [Prioritized TODO Backlog](/prd/project-neuro-architecture-and-task-breakdown#111-p0-must-deliver-for-ghost-layer-mvp)
