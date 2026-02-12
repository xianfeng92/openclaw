# Project Neuro: Architecture and Work Breakdown (Addendum v1)

Status: Draft for implementation planning  
Date: 2026-02-12  
Source PRD: `docs/prd/project-neuro.md`

---

## 1. Purpose

This document converts the narrative PRD into:

1. Executable architecture decisions.
2. A requirement baseline with traceable IDs.
3. Gap completion for missing product and engineering definitions.
4. A phased task breakdown with dependencies and Definition of Done (DoD).

This document does not replace `docs/prd/project-neuro.md`. It operationalizes it.

---

## 2. Requirement Baseline (Normalized)

## 2.1 Functional Requirements

- FR-01 Context stream: Desktop continuously captures bounded, volatile context from clipboard, active window, terminal output, workspace file events, and editor state.
- FR-02 Instant invoke: Hotkey invoke path must render immediate UI shell in <100ms and stream AI content asynchronously.
- FR-03 Proactive cards: Predictive corner cards can appear without explicit prompt, with accept or dismiss actions.
- FR-04 Ghost behavior: Default operation is low-friction and mostly invisible; high-noise prompts are avoided.
- FR-05 Execution safety: Safe Mode is default. Flow Mode is explicit opt-in and scoped by allowlisted actions.
- FR-06 Revertibility: File writes, command effects, and deletes must be reversible through one-click undo windows.
- FR-07 Learning loop: User interactions (accept, dismiss, modify, ignore) are recorded and influence future suggestions.
- FR-08 Offline first capture: Context capture and local pattern matching work offline; model inference degrades gracefully.
- FR-09 Local auth UX: Desktop local control path must be tokenless from user perspective without leaking credentials in URL query.
- FR-10 Cross-platform parity: macOS and Windows deliver the same core Neuro behaviors; Linux remains CLI-first.

## 2.2 Non-Functional Requirements

- NFR-01 UI responsiveness: UI shell reaction <100ms p95 for invoke and card reveal.
- NFR-02 AI responsiveness: First model token <2000ms p95 when provider is healthy.
- NFR-03 Memory: Idle total <200MB target across desktop app + gateway + context buffers.
- NFR-04 Privacy: Context capture is local-first with redaction before persistence; volatile buffers are memory-only.
- NFR-05 Security: Tool execution obeys allowlist and sandbox boundaries; local traffic is authenticated and loopback-bound.
- NFR-06 Observability: Metrics and logs must be metadata-centric; no raw sensitive payload logging.
- NFR-07 Reliability: No user-facing crash or stuck session when providers fail, disconnect, or rate-limit.

---

## 3. PRD Gaps and Proposed Completion

The PRD is strong on vision but leaves several implementation-critical areas under-specified.

| Gap ID | Missing/Unclear Area                                                                              | Risk if Unresolved                          | Proposed Completion                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| GAP-01 | Windows runtime stack mismatch (PRD says React Native + WebView; repo uses Electron main/preload) | Wrong staffing and architecture assumptions | Canonicalize Windows implementation as Electron in this phase; revisit stack migration only as a separate ADR. |
| GAP-02 | Explicit event contract for context and suggestion data                                           | Cross-layer integration drift               | Define versioned schemas (`context.event.v1`, `suggestion.card.v1`, `suggestion.feedback.v1`).                 |
| GAP-03 | Redaction policy coverage and severity handling                                                   | Secret leakage and compliance risk          | Define a 3-tier redaction policy: block, mask, hash; add source-specific filters and test corpus.              |
| GAP-04 | Undo semantics for multi-file and command actions                                                 | Irreversible operations in Flow Mode        | Add `Undo Journal` with per-action snapshots, expiry windows, and transactional grouping.                      |
| GAP-05 | Flow Mode graduation and rollback criteria                                                        | Unsafe auto-apply behavior                  | Introduce confidence thresholds, allowlist scopes, and circuit breakers per workspace/provider.                |
| GAP-06 | Sync conflict strategy for behavioral preferences                                                 | Cross-device inconsistency                  | Define merge strategy: LWW for preference state, append-only for events, conflict metrics.                     |
| GAP-07 | SLO measurement method and ownership                                                              | Targets cannot be enforced                  | Add latency budget decomposition with owners and p50/p95 dashboards.                                           |
| GAP-08 | Permission and consent lifecycle for sensors                                                      | UX and legal ambiguity                      | Define first-run consent matrix, revocation behavior, and degraded mode per sensor.                            |
| GAP-09 | Kill switch and feature flags                                                                     | Hard to contain regressions                 | Introduce remote/local kill switches for proactive cards, flow auto-apply, sync.                               |
| GAP-10 | Rollout criteria by phase                                                                         | Unclear release readiness                   | Add hard gates for each milestone (stability, acceptance, resource budget).                                    |
| GAP-11 | Failure taxonomy for model/gateway errors                                                         | Repeated opaque user errors                 | Standardize error mapping and user-safe fallback messaging categories.                                         |
| GAP-12 | Data retention enforcement jobs                                                                   | Drift from privacy promises                 | Implement retention daemon jobs with verification metrics and audit logs.                                      |

---

## 4. Target Architecture

## 4.1 Architecture Principles

- AP-01 Local-first context, explicit data boundaries.
- AP-02 Fast UI path independent from model path.
- AP-03 Safety and undo are first-class, not bolt-ons.
- AP-04 Observable by default, debuggable without sensitive payload leakage.
- AP-05 Progressive autonomy: suggest first, auto-apply later with measured trust.

## 4.2 Layered Architecture

```text
[Desktop Sensors Layer]
  clipboard | active-window | terminal-tail | workspace-fs | editor-bridge
        |
        v
[Privacy + Normalization Layer]
  classify -> redact -> normalize -> priority score
        |
        v
[Context Runtime Layer]
  in-memory ring buffers (volatile) + session snapshot assembler
        |
        v
[Gateway Neuro Services]
  ingest API | context query API | planner | safety policy | undo manager
        |
        v
[Intelligence Layer]
  pattern matcher + behavioral store + suggestion planner + model orchestrator
        |
        v
[Experience Layer]
  spotlight invoke + corner cards + quick actions + feedback loop
```

## 4.3 Core Components and Responsibilities

### Desktop App (macOS and Windows)

- `ContextCaptureService`
  - Collect bounded events from approved sources.
  - Push normalized events to gateway over authenticated local channel.
- `CardOrchestrator`
  - Shows proactive and invoke-triggered UI cards.
  - Handles action taps (`apply`, `undo`, `dismiss`, `explain`).
- `InvokeController`
  - Hotkey, deep link, tray/menu entry normalization.
  - Guarantees UI shell render before model result.

### Gateway

- `ContextIngestRouter`
  - Validates schema and rate limits source streams.
  - Stores in volatile per-session context caches.
- `NeuroPlanner`
  - Computes immediate recommendations from context + behavior profile.
  - Chooses suggest vs apply path based on policy and confidence.
- `ExecutionPolicyEngine`
  - Enforces Safe vs Flow mode gates.
  - Verifies allowlist, sandbox mode, and workspace boundaries.
- `UndoJournalManager`
  - Records reversible action snapshots and expiry windows.
  - Exposes one-click rollback endpoint.

### Storage

- Volatile context store: memory-only ring buffers by session and source.
- Behavioral store: `~/.openclaw/behavioral.db` (SQLite).
- Undo journal store: `~/.openclaw/undo-journal.db` (SQLite, short retention).

## 4.4 Data Contracts (Proposed)

### Context Event

```ts
type ContextEventV1 = {
  version: "context.event.v1";
  eventId: string;
  ts: number;
  sessionKey: string;
  source: "clipboard" | "active_window" | "terminal" | "fs" | "editor";
  payload: Record<string, unknown>;
  redaction: {
    applied: boolean;
    level: "none" | "mask" | "hash" | "block";
    reasons: string[];
  };
  bounds: {
    bytes: number;
    dropped: boolean;
  };
};
```

### Suggestion Card

```ts
type SuggestionCardV1 = {
  version: "suggestion.card.v1";
  suggestionId: string;
  sessionKey: string;
  confidence: number;
  mode: "safe" | "flow";
  actions: Array<"apply" | "dismiss" | "undo" | "explain">;
  expiresAt: number;
};
```

### Feedback Event

```ts
type SuggestionFeedbackV1 = {
  version: "suggestion.feedback.v1";
  suggestionId: string;
  action: "accept" | "dismiss" | "modify" | "ignore";
  ts: number;
  sessionKey: string;
};
```

## 4.5 Behavioral DB Schema (Proposed)

```sql
CREATE TABLE behavior_events (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  session_key TEXT NOT NULL,
  type TEXT NOT NULL,
  pattern_hash TEXT NOT NULL,
  workspace TEXT,
  file_path TEXT,
  app_name TEXT,
  user_action TEXT,
  confidence REAL,
  metadata_json TEXT
);

CREATE INDEX idx_behavior_events_ts ON behavior_events(ts);
CREATE INDEX idx_behavior_events_pattern ON behavior_events(pattern_hash);
CREATE INDEX idx_behavior_events_session ON behavior_events(session_key);

CREATE TABLE pattern_preferences (
  pattern_hash TEXT PRIMARY KEY,
  preference TEXT NOT NULL, -- auto_apply | suggest | ignore
  score REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sync_watermarks (
  device_id TEXT PRIMARY KEY,
  last_event_ts INTEGER NOT NULL
);
```

## 4.6 Key Runtime Flows

### Flow A: Alt+Space Invoke

1. User invokes hotkey.
2. Desktop renders shell card in <100ms.
3. Desktop requests context snapshot from local ring buffer + recent gateway state.
4. Gateway composes context and starts model run.
5. Stream partial output to card.
6. User action triggers safe apply or flow apply path.

### Flow B: Proactive Suggestion

1. Context event crosses trigger threshold.
2. Planner checks pattern history and user preferences.
3. Suggestion card emitted with confidence and expiry.
4. Feedback event recorded and fed into preference model.

### Flow C: Reversible Apply

1. Planner proposes action.
2. Policy engine decides safe prompt vs flow auto-apply.
3. Undo snapshot written.
4. Action executed.
5. Undo option available until expiry.

---

## 5. Security, Privacy, and Governance

## 5.1 Data Classification

- Class A: secrets and credentials (must block or hash; never store raw).
- Class B: potentially sensitive user content (mask before persistence).
- Class C: operational metadata (store allowed with retention limits).

## 5.2 Redaction Pipeline

1. Source pre-filter.
2. Pattern detector.
3. Structured redaction transform.
4. Audit metadata (`redaction.level`, reason codes).

## 5.3 Safety Controls

- Safe Mode default for all workspaces.
- Flow Mode requires explicit enable + allowlist scope.
- Hard deny list for destructive commands even in Flow Mode.
- Workspace path guards and symlink escape checks remain mandatory.

## 5.4 Operational Controls

- Feature flags:
  - `neuro.proactive_cards`
  - `neuro.flow_auto_apply`
  - `neuro.preference_sync`
- Emergency kill switch at gateway startup and runtime config reload.

---

## 6. Observability and SLOs

## 6.1 Core Metrics

- `neuro.invoke.ui_ready_ms` (p50/p95)
- `neuro.invoke.first_token_ms` (p50/p95)
- `neuro.suggestion.accept_rate`
- `neuro.suggestion.false_positive_rate`
- `neuro.undo.usage_rate`
- `neuro.memory.desktop_mb` and `neuro.memory.gateway_mb`
- `neuro.redaction.block_count` and `neuro.redaction.mask_count`

## 6.2 Log Policy

- Log IDs, lengths, timing, and decision codes.
- Never log full clipboard payloads, model prompts, or raw secrets.
- Keep structured logs for incident and audit reconstruction.

---

## 7. Work Breakdown Structure

## 7.1 Milestones

- M0 Architecture and Safety Baseline
- M1 Ghost Layer MVP (capture + invoke + cards)
- M2 Learning Loop MVP (behavior DB + feedback)
- M3 Predictive Engine v1 (heuristic)
- M4 Flow Mode Graduation and Sync

## 7.2 Epic Breakdown

### EPIC-00 Alignment and ADRs (Prerequisite)

- T-0001 Finalize platform implementation baseline (Windows Electron decision).
- T-0002 Publish schema ADR for context and suggestion events.
- T-0003 Define SLO dashboard and owner mapping.
- DoD:
  - ADRs merged.
  - Requirement-to-epic trace table approved.

### EPIC-01 Context Capture Foundation

- T-0101 Implement clipboard sensor adapter with bounds and redaction.
- T-0102 Implement active window adapter with permission handling.
- T-0103 Implement terminal tail adapter and line caps.
- T-0104 Implement workspace file event adapter with path guards.
- T-0105 Build in-memory ring buffer service with TTL and byte caps.
- DoD:
  - All adapters produce `context.event.v1`.
  - Memory profile under configured caps.
  - Privacy tests for secret leakage pass.

### EPIC-02 Gateway Neuro Ingest and Snapshot

- T-0201 Add context ingest RPC/WS endpoint and validation.
- T-0202 Add per-session volatile cache and snapshot assembler.
- T-0203 Add rate limiting and overload shedding.
- T-0204 Add telemetry for ingest health and drops.
- DoD:
  - Snapshot query p95 < 50ms local.
  - Ingest survives burst load without gateway crash.

### EPIC-03 Invoke and Card Experience

- T-0301 Implement invoke shell rendering path (<100ms target).
- T-0302 Build card rendering component with action hooks.
- T-0303 Add action handlers: apply, dismiss, explain, undo.
- T-0304 Add UX fallbacks for offline/provider errors.
- DoD:
  - Invoke shell p95 < 100ms.
  - Card lifecycle telemetry complete.
  - Accessibility checks pass for desktop overlays.

### EPIC-04 Reversible Execution and Policy

- T-0401 Implement undo journal schema and service.
- T-0402 Add grouped action snapshots for multi-file edits.
- T-0403 Integrate policy engine into apply path (safe/flow).
- T-0404 Add hard deny list and exception audit trail.
- DoD:
  - One-click undo works for covered actions in SLA window.
  - Unsafe action paths are blocked and auditable.

### EPIC-05 Behavioral Context Store

- T-0501 Create `behavioral.db` schema and migration.
- T-0502 Record suggestion and feedback events.
- T-0503 Implement retention jobs and delete/export endpoints.
- T-0504 Add preference aggregation view.
- DoD:
  - Retention policy enforceable and tested.
  - Export and delete complete with verification.

### EPIC-06 Prediction Engine v1

- T-0601 Build heuristic trigger rules and confidence scoring.
- T-0602 Add pattern similarity lookup and ranking.
- T-0603 Add suppression logic to avoid repeated nuisance cards.
- T-0604 Add acceptance-rate optimization loop.
- DoD:
  - False positive rate within agreed threshold.
  - Suggestion acceptance reaches baseline target in dogfood.

### EPIC-07 Flow Mode Graduation

- T-0701 Define graduation criteria and policy thresholds.
- T-0702 Implement workspace-scoped Flow enablement.
- T-0703 Add confidence guardrails for auto-apply.
- T-0704 Add rollback circuit breaker.
- DoD:
  - Flow mode cannot bypass non-negotiable safety controls.
  - Auto-apply events always attach undo metadata.

### EPIC-08 Multi-Device Preference Sync

- T-0801 Define sync protocol and device watermark model.
- T-0802 Implement LWW merge for preferences.
- T-0803 Implement append-only event replication.
- T-0804 Add conflict and lag telemetry.
- DoD:
  - Cross-device preference propagation deterministic.
  - Sync failures degrade safely to local mode.

### EPIC-09 Hardening and Rollout

- T-0901 Add feature flags and kill switches.
- T-0902 Add chaos tests for provider/gateway disconnects.
- T-0903 Run memory and latency performance gates.
- T-0904 Prepare staged rollout plan (silent -> hint -> helpful -> integrated).
- DoD:
  - Rollout gates defined and measurable.
  - Abort plan documented and tested.

## 7.3 Dependency Graph (High Level)

```text
EPIC-00
  -> EPIC-01 -> EPIC-02 -> EPIC-03
  -> EPIC-04
EPIC-02 + EPIC-03 + EPIC-04
  -> EPIC-05 -> EPIC-06 -> EPIC-07
EPIC-05
  -> EPIC-08
EPIC-03 + EPIC-07 + EPIC-08
  -> EPIC-09
```

---

## 8. Test Strategy and Exit Criteria

## 8.1 Test Layers

- Unit: schema validation, redaction, planner scoring, policy decisions.
- Integration: desktop sensors -> gateway ingest -> card emission.
- End-to-end: invoke, suggest, apply, undo, feedback loop.
- Reliability: provider timeout, ws disconnect, high event bursts.
- Security: secret leakage regression corpus, path-escape tests, approval bypass tests.

## 8.2 Phase Exit Gates

- M1 gate:
  - UI shell <100ms p95.
  - No secret leakage in capture logs.
- M2 gate:
  - Feedback loop writes and retention jobs validated.
- M3 gate:
  - Acceptance rate trend positive and false positives below threshold.
- M4 gate:
  - Flow mode guarded; rollback and kill switch validated under chaos tests.

---

## 9. Delivery Notes

- Keep this addendum as the execution source for planning.
- Create two follow-up design docs before implementation of later phases:
  - `docs/prd/behavioral-context-store.md`
  - `docs/prd/prediction-engine.md`

These follow-up docs should expand schema, migration, algorithm strategy, and validation datasets.

---

## 10. Execution Plan (Weekly Schedule and Role Assignment)

## 10.1 Planning Assumptions

- Planning horizon: 16 weeks.
- Iteration cadence: weekly execution, bi-weekly release train.
- Environments: local dev + staging + dogfood + production.
- Team model: one cross-functional squad with embedded security and QA.

## 10.2 Role Model

| Role Code | Role                   | Core Ownership                                         |
| --------- | ---------------------- | ------------------------------------------------------ |
| PO        | Product Owner          | Priority, acceptance, rollout decisions                |
| AA        | AI Architect           | Target architecture, design review, technical risk     |
| GL        | Gateway Lead Engineer  | Gateway services, policies, contracts, performance     |
| ME        | macOS Engineer         | macOS sensors, overlays, invoke UX                     |
| WE        | Windows Engineer       | Windows sensors, overlays, invoke UX                   |
| DE        | Data/ML Engineer       | Behavioral store, heuristics, tuning, sync semantics   |
| SE        | Security Engineer      | Redaction, threat review, hardening gates              |
| QA        | QA/Automation Engineer | Test strategy, automation, quality gate ownership      |
| SRE       | Release/SRE Engineer   | Telemetry, SLO dashboards, release gating, kill switch |

## 10.3 RACI by Epic

| Epic                          | R (Responsible) | A (Accountable) | C (Consulted)      | I (Informed)    |
| ----------------------------- | --------------- | --------------- | ------------------ | --------------- |
| EPIC-00 Alignment and ADRs    | AA, GL          | AA              | PO, SE, QA         | SRE, ME, WE, DE |
| EPIC-01 Context Capture       | ME, WE          | AA              | GL, SE, QA         | PO, SRE, DE     |
| EPIC-02 Gateway Ingest        | GL              | AA              | ME, WE, SE, QA     | PO, SRE, DE     |
| EPIC-03 Invoke and Cards      | ME, WE          | PO              | AA, GL, QA         | SRE, SE, DE     |
| EPIC-04 Reversible Execution  | GL              | AA              | SE, QA, ME, WE     | PO, SRE, DE     |
| EPIC-05 Behavioral Store      | DE, GL          | AA              | SE, QA             | PO, SRE, ME, WE |
| EPIC-06 Prediction Engine     | DE              | AA              | PO, GL, QA         | SRE, SE, ME, WE |
| EPIC-07 Flow Graduation       | GL, DE          | AA              | SE, QA, PO         | SRE, ME, WE     |
| EPIC-08 Preference Sync       | DE, GL          | AA              | SRE, SE, QA        | PO, ME, WE      |
| EPIC-09 Hardening and Rollout | SRE, QA, GL     | PO              | AA, SE, ME, WE, DE | All             |

## 10.4 Weekly Delivery Plan (16 Weeks)

| Week | Focus                          | Main Deliverables                                                                     | Primary Owners | Exit Criteria                                        |
| ---- | ------------------------------ | ------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------- |
| W1   | Program kickoff + scope freeze | Requirement trace table, milestone baseline, delivery board                           | PO, AA         | Scope frozen, risks ranked, ownership confirmed      |
| W2   | Architecture and contracts     | ADR set, `context.event.v1` and suggestion schemas, latency budget ownership          | AA, GL         | ADRs approved, contract tests scaffolded             |
| W3   | Sensor foundation I            | Clipboard + active window capture adapters with redaction hooks                       | ME, WE         | Adapter tests pass, no raw secret logging            |
| W4   | Sensor foundation II           | Terminal tail + fs watcher adapters, volatile ring buffer service                     | ME, WE, GL     | Memory caps verified under soak test                 |
| W5   | Gateway ingest path            | Ingest endpoint, validation, per-session context cache, rate limiting                 | GL             | Snapshot query p95 target met in staging             |
| W6   | Invoke fast-path UX            | Alt+Space shell path, immediate card skeleton, streaming bridge                       | ME, WE         | UI ready <100ms p95 in dogfood                       |
| W7   | Card actions and fallback      | Card actions (`apply`, `dismiss`, `explain`, `undo`) and offline/provider fallback UX | ME, WE, GL     | End-to-end invoke flow stable                        |
| W8   | Undo and safety core           | Undo journal v1, grouped snapshots, safe-mode enforcement path                        | GL, SE         | One-click undo succeeds for covered actions          |
| W9   | Policy hardening               | Flow mode gates, deny list, exception audit trail, policy telemetry                   | GL, SE, QA     | No unsafe bypass in regression suite                 |
| W10  | Behavioral store v1            | `behavioral.db` schema, migrations, feedback event ingest                             | DE, GL         | Migration and write path validated                   |
| W11  | Retention and control plane    | Retention jobs, export/delete APIs, preference aggregation                            | DE, SE, QA     | Privacy and retention checks pass                    |
| W12  | Prediction v1 heuristics       | Rule engine, similarity lookup, suppression controls                                  | DE             | False-positive baseline within target                |
| W13  | Optimization + dogfood         | Acceptance tuning loop, nuisance suppression, experiment flags                        | DE, PO, QA     | Acceptance trend positive over dogfood window        |
| W14  | Flow graduation                | Confidence guardrails, workspace-scoped flow rollout, rollback breaker                | GL, DE, SE     | Flow guardrails verified by chaos tests              |
| W15  | Preference sync                | Sync protocol v1, LWW merge, lag/conflict telemetry                                   | DE, GL, SRE    | Deterministic sync in multi-device tests             |
| W16  | Hardening + staged release     | Kill switches, full non-functional gate, phased rollout playbook                      | SRE, QA, PO    | Release gate sign-off for silent/hint/helpful stages |

## 10.5 Weekly Ceremonies and Decision Rhythm

- Monday:
  - Planning: weekly goal, dependency check, risk updates.
  - Architecture review for cross-layer changes.
- Wednesday:
  - Mid-week integration checkpoint (desktop + gateway + data).
  - Security and privacy delta review for new capture paths.
- Friday:
  - Demo and gate review against weekly exit criteria.
  - Roll-forward or rollback decision for release train branch.

## 10.6 Capacity and Allocation Guidance

- AA: 30-40% architecture/governance, 60-70% unblock/design review in W1-W8.
- GL: 80% implementation in W2-W9, 50% in W10-W16.
- ME/WE: 80% implementation in W3-W8, 40% support in W9-W16.
- DE: 20% design support in W1-W9, 80% implementation in W10-W15.
- SE: 30% continuous review, 60% in W8-W14 hardening windows.
- QA: automation from W2 onward, strongest load in W8-W16.
- SRE: telemetry setup in W2-W6, release gating in W14-W16.
- PO: acceptance and rollout governance every week.

## 10.7 Weekly Risk Register Template

Use this template in weekly review:

- Risk ID:
- Description:
- Affected weeks:
- Probability (L/M/H):
- Impact (L/M/H):
- Owner:
- Mitigation:
- Trigger for escalation:

## 10.8 Go/No-Go Gates for Release Stages

- Silent stage gate:
  - Sensor stability and redaction coverage validated.
- Hint stage gate:
  - Card relevance baseline and dismiss rate acceptable.
- Helpful stage gate:
  - Acceptance rate and undo reliability meet threshold.
- Integrated stage gate:
  - Flow guardrails, sync integrity, and kill switch drills pass.

---

## 11. Prioritized TODO Backlog

Use this as the execution-facing checklist. Priority is strict: P0 first, then P1, then P2.

## 11.1 P0 (Must deliver for Ghost Layer MVP)

| Priority | TODO ID     | Task                                                                                     | Owner   | Target Week | Dependency               | Done When                                                                                                                      |
| -------- | ----------- | ---------------------------------------------------------------------------------------- | ------- | ----------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| P0       | TODO-P0-001 | Freeze architecture scope and Windows runtime baseline (Electron for this phase)         | AA, PO  | W1          | None                     | ADR approved and linked in planning board. Completed via [ADR 0001](/prd/project-neuro-adr-0001-scope-freeze-windows-baseline) |
| P0       | TODO-P0-002 | Finalize `context.event.v1`, `suggestion.card.v1`, `suggestion.feedback.v1` contracts    | AA, GL  | W2          | TODO-P0-001              | Schema tests and sample payload fixtures merged. Completed via [ADR 0002](/prd/project-neuro-adr-0002-event-contracts-v1)      |
| P0       | TODO-P0-003 | Implement redaction baseline (block/mask/hash), source filters, and regression corpus    | SE, GL  | W3          | TODO-P0-002              | Secret leakage test suite green                                                                                                |
| P0       | TODO-P0-004 | Build context capture v1 (clipboard + active window + ring buffer bounds)                | ME, WE  | W3-W4       | TODO-P0-002, TODO-P0-003 | Memory cap and redaction assertions pass on macOS/Windows                                                                      |
| P0       | TODO-P0-005 | Implement gateway ingest endpoint + validation + per-session volatile snapshot cache     | GL      | W5          | TODO-P0-004              | Snapshot query p95 < 50ms in staging                                                                                           |
| P0       | TODO-P0-006 | Implement invoke fast-path shell (`Alt+Space`) and streaming bridge                      | ME, WE  | W6          | TODO-P0-005              | UI shell p95 < 100ms in dogfood                                                                                                |
| P0       | TODO-P0-007 | Add feature flags + kill switch scaffold for proactive cards and flow mode               | SRE, GL | W6          | TODO-P0-005              | Runtime toggle verified in staging                                                                                             |
| P0       | TODO-P0-008 | Add baseline observability (`ui_ready_ms`, `first_token_ms`, memory, redaction counters) | SRE, QA | W6          | TODO-P0-005              | Dashboards and alert thresholds available                                                                                      |

## 11.2 P1 (Must deliver for Learning Loop MVP)

| Priority | TODO ID     | Task                                                                                            | Owner      | Target Week | Dependency  | Done When                                       |
| -------- | ----------- | ----------------------------------------------------------------------------------------------- | ---------- | ----------- | ----------- | ----------------------------------------------- |
| P1       | TODO-P1-001 | Implement card actions (`apply`, `dismiss`, `explain`, `undo`) and provider/offline fallback UX | ME, WE, GL | W7          | TODO-P0-006 | End-to-end action loop passes integration tests |
| P1       | TODO-P1-002 | Implement undo journal schema/service and grouped action snapshots                              | GL         | W8          | TODO-P1-001 | One-click undo works for covered action types   |
| P1       | TODO-P1-003 | Integrate safe/flow policy engine and hard deny list into apply path                            | GL, SE     | W9          | TODO-P1-002 | No policy bypass in security regression suite   |
| P1       | TODO-P1-004 | Implement `behavioral.db` schema, migration, and feedback write path                            | DE, GL     | W10         | TODO-P1-001 | Migration and write/read validation passes      |
| P1       | TODO-P1-005 | Implement retention jobs + behavioral data export/delete endpoints                              | DE, SE     | W11         | TODO-P1-004 | Retention and delete verification tests pass    |
| P1       | TODO-P1-006 | Add reliability tests for provider failures, ws disconnect, and event burst overload            | QA, GL     | W11         | TODO-P1-003 | Reliability suite stable in CI                  |

## 11.3 P2 (Scale, optimization, and graduated autonomy)

| Priority | TODO ID     | Task                                                                            | Owner       | Target Week | Dependency               | Done When                                       |
| -------- | ----------- | ------------------------------------------------------------------------------- | ----------- | ----------- | ------------------------ | ----------------------------------------------- |
| P2       | TODO-P2-001 | Build heuristic prediction v1 (trigger rules, similarity lookup, suppression)   | DE          | W12         | TODO-P1-004              | False-positive rate under agreed threshold      |
| P2       | TODO-P2-002 | Add acceptance-rate optimization loop and experiment framework                  | DE, PO, QA  | W13         | TODO-P2-001              | Dogfood trend improves for 2+ weeks             |
| P2       | TODO-P2-003 | Implement Flow Mode graduation (confidence thresholds, rollback breaker)        | GL, DE, SE  | W14         | TODO-P1-003, TODO-P2-001 | Auto-apply always reversible and policy-guarded |
| P2       | TODO-P2-004 | Implement preference sync v1 (LWW merge + conflict telemetry)                   | DE, GL, SRE | W15         | TODO-P1-004              | Deterministic sync in multi-device test matrix  |
| P2       | TODO-P2-005 | Complete hardening and staged rollout (silent -> hint -> helpful -> integrated) | SRE, QA, PO | W16         | TODO-P2-003, TODO-P2-004 | Release go/no-go gates all pass                 |

## 11.4 Current Recommended Start Queue (This Week)

- [x] TODO-P0-001 Freeze architecture scope and runtime baseline. See [ADR 0001](/prd/project-neuro-adr-0001-scope-freeze-windows-baseline).
- [x] TODO-P0-002 Finalize and test event contracts. See [ADR 0002](/prd/project-neuro-adr-0002-event-contracts-v1).
- [ ] TODO-P0-003 Deliver redaction baseline with regression corpus.
- [ ] TODO-P0-004 Start context capture v1 on macOS and Windows.
