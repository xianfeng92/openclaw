# Project Neuro ADR 0001 Scope Freeze and Windows Baseline

Status: Accepted  
Date: 2026-02-12  
Owners: AI Architect, Product Owner  
Related: [Neuro Architecture and Backlog](/prd/project-neuro-architecture-and-task-breakdown)

---

## 1. Context

Project Neuro requires a clear execution boundary for P0 so the team can ship the Ghost Layer MVP without architecture churn.

There is a mismatch in current product docs:

- `docs/prd/project-neuro.md` lists Windows stack as React Native plus WebView.
- Repository implementation currently runs Windows desktop on Electron (`apps/windows/src/main`, `apps/windows/src/preload`).

Without a baseline freeze, planning, staffing, and implementation risk drift.

---

## 2. Decision

We freeze P0 scope and Windows baseline as follows.

## 2.1 Scope In

- Context event contracts finalized for P0:
  - `context.event.v1`
  - `suggestion.card.v1`
  - `suggestion.feedback.v1`
- Desktop context capture v1:
  - clipboard
  - active window
  - bounded in-memory ring buffers
  - redaction baseline
- Gateway ingest and snapshot path:
  - validated ingest endpoint
  - per-session volatile cache
  - basic rate limiting and telemetry
- Fast invoke path:
  - hotkey invoke shell
  - streaming response bridge
  - p95 UI readiness target
- Control and safety baselines:
  - feature flags for proactive cards and flow mode
  - emergency kill switch scaffold
  - observability baseline metrics

## 2.2 Scope Out

- Windows runtime migration to React Native.
- Multi-device preference sync.
- Prediction engine beyond heuristic baseline.
- Flow Mode graduation and autonomous apply optimization.
- Any cross-platform UI redesign outside Ghost Layer needs.

## 2.3 Windows Technical Baseline

Windows desktop remains Electron for this phase.

- Main process responsibilities:
  - tray lifecycle
  - local gateway process management
  - local auth token lifecycle
  - IPC policy enforcement
- Preload responsibilities:
  - tokenless local auth seeding for loopback control UI
  - strict surface boundary (no token on window globals)
- Renderer responsibilities:
  - control UI presentation and action dispatch only
- Security posture:
  - loopback binding
  - authenticated gateway channel
  - no credentials in dashboard URL query

Any runtime migration proposal must be a new ADR and cannot block P0 delivery.

---

## 3. Decision Drivers

- Reduce delivery risk for W1 to W6.
- Align implementation with existing codebase.
- Keep P0 milestones measurable and testable.
- Avoid mixed runtime ownership on Windows during MVP.

---

## 4. Consequences

## 4.1 Positive

- Planning and staffing alignment becomes explicit.
- Engineering focus stays on P0 outcomes, not framework migration.
- Existing Windows code paths can be hardened immediately.

## 4.2 Tradeoffs

- React Native parity exploration is deferred.
- Some UI portability concerns are accepted for current phase.

## 4.3 Revisit Conditions

Open a follow-up ADR when all are true:

- Ghost Layer MVP exit criteria are met.
- Windows Electron runtime shows blocking constraints not solvable in phase.
- A migration plan includes cost, risk, and rollback path.

---

## 5. Implementation Notes

- This decision satisfies `TODO-P0-001` from [Prioritized TODO Backlog](/prd/project-neuro-architecture-and-task-breakdown#111-p0-must-deliver-for-ghost-layer-mvp).
- Execution should proceed to:
  - `TODO-P0-002` contracts
  - `TODO-P0-003` redaction baseline
  - `TODO-P0-004` context capture v1

---

## 6. Validation Checklist

- [x] Scope boundaries documented (in and out).
- [x] Windows baseline fixed to Electron for P0.
- [x] Revisit gate defined.
- [x] Backlog item traceability linked.
