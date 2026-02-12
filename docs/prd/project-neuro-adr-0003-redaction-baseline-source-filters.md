# Project Neuro ADR 0003 Redaction Baseline Source Filters and Regression Corpus v1

Status: Accepted  
Date: 2026-02-12  
Owners: Security Engineer, Gateway Lead  
Related:

- [Neuro Architecture and Backlog](/prd/project-neuro-architecture-and-task-breakdown)
- [ADR 0002 Event Contracts v1](/prd/project-neuro-adr-0002-event-contracts-v1)

---

## 1. Context

`TODO-P0-003` requires a baseline privacy layer before context capture adapters are expanded:

- 3-tier redaction policy (`block`, `hash`, `mask`)
- source-specific pre-filters
- regression corpus for secret leakage

Without this layer, upcoming capture work in `TODO-P0-004` can leak raw credentials into in-memory context payloads and downstream gateway consumers.

---

## 2. Decision

Implement a reusable Neuro redaction pipeline at:

- `src/gateway/neuro/redaction.ts`

with supporting regression corpus and tests:

- `src/gateway/neuro/redaction-regression-corpus.ts`
- `src/gateway/neuro/redaction.test.ts`

The pipeline order is fixed:

1. source pre-filter
2. pattern detector
3. structured redaction transform
4. audit metadata (`redaction.level`, reason codes, bounds)

---

## 3. Redaction Policy v1

## 3.1 Class A Secrets and Credentials

- Level: `block` or `hash`
- Rule examples:
  - private key PEM blocks are hard blocked
  - assignment and JSON secret fields are hashed
  - Bearer and provider-style tokens are hashed

Rationale: raw Class A material must never remain in event payload content.

## 3.2 Class B Sensitive User Content

- Level: `mask`
- Rule examples:
  - emails are masked
  - phone-like values are masked

Rationale: preserve minimal context utility while reducing direct exposure.

## 3.3 Class C Operational Metadata

- Level: `none` unless source filters need trimming
- Examples:
  - timestamps, event names, paths without raw file body content

---

## 4. Source Filters v1

- `active_window`:
  - strip URL query and fragment from `url`
- `terminal`:
  - cap line-based fields to last 100 lines
- `clipboard`:
  - cap `text/content` fields at 10 KB
- `editor`:
  - cap `selection/text` fields at 8 KB
- `fs`:
  - remove file-body style keys (`content`, `raw`, `base64`, `buffer`, and variants)

These filters execute before pattern transforms and can set `bounds.dropped=true` when data is removed or truncated.

---

## 5. Regression Corpus

Secret leakage fixtures are maintained in:

- `src/gateway/neuro/redaction-regression-corpus.ts`

Coverage includes:

- env-style secret assignments
- JSON secret fields
- active window URL query token leakage
- Bearer token leakage
- file-system payload body removal
- private key block handling
- PII masking

Done criteria validation:

- `pnpm test src/gateway/neuro/redaction.test.ts`

---

## 6. Consequences

Positive:

- Establishes a deterministic redaction contract before capture adapters expand.
- Reduces chance of accidental credential/PII exposure in context payloads.
- Regression corpus provides stable guardrails against leak regressions.

Tradeoff:

- Conservative source filters may remove payload detail that some future heuristics could use; follow-up tuning must preserve privacy guarantees.

---

## 7. Traceability

This decision fulfills:

- `TODO-P0-003` in [Prioritized TODO Backlog](/prd/project-neuro-architecture-and-task-breakdown#111-p0-must-deliver-for-ghost-layer-mvp)
