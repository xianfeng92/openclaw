# Project Neuro ADR 0006 Invoke Fast Path and Streaming Bridge

Status: Accepted  
Date: 2026-02-12  
Owners: macOS Engineer, Windows Engineer, Gateway Lead  
Related:

- [Neuro Architecture and Backlog](/prd/project-neuro-architecture-and-task-breakdown)
- [ADR 0005 Gateway Ingest and Snapshot Cache](/prd/project-neuro-adr-0005-gateway-ingest-snapshot-cache)

---

## 1. Context

`TODO-P0-006` requires:

- invoke fast-path shell for quick summon (`Alt+Space`)
- immediate UI shell rendering while full UI boots
- streaming bridge so chat deltas render in the UI before final transcript reload

Before this ADR:

- Windows desktop had no global invoke shortcut.
- Web chat state tracked run lifecycle but did not surface delta text to `chatStream`.

---

## 2. Decision

Implement invoke fast-path and streaming bridge in current desktop stack:

- Windows app (`apps/windows`) registers global shortcut `Alt+Space`.
- Invoke opens a lightweight local bootstrap shell first, then asynchronously transitions to Web UI.
- Control UI chat controller maps `chat` delta events into live `chatStream`.

---

## 3. Windows Invoke Path

Added:

- global hotkey registration in `apps/windows/src/main/index.ts`
- tray action `Quick Invoke (Alt+Space)` in `apps/windows/src/main/tray.ts`
- invoke IPC surface:
  - `window:invoke` in `apps/windows/src/main/ipc.ts`
  - `window.invoke()` in `apps/windows/src/preload/index.ts`

Window fast-path behavior in `apps/windows/src/main/window.ts`:

- `showInvokeWindow()` creates/focuses window through invoke path.
- invoke path loads local shell data URL immediately.
- gateway startup and Web UI load proceed asynchronously.

This preserves perceived responsiveness while still converging to the full Control UI.

---

## 4. Streaming Bridge

Updated `ui/src/ui/controllers/chat.ts`:

- parse assistant text from incoming `chat` delta payloads
- merge incremental/cumulative delta patterns into `chatStream`
- clear waiting indicator once real text starts flowing

Updated tests:

- `ui/src/ui/controllers/chat.test.ts`

This enables visible streaming text before `chat.final` and history refresh.

---

## 5. Validation

Primary verification:

- `pnpm --dir ui test src/ui/controllers/chat.test.ts`
- `pnpm --dir apps/windows typecheck`
- `pnpm --dir apps/windows build`
- `pnpm check`

---

## 6. Consequences

Positive:

- Delivers `TODO-P0-006` invoke responsiveness target path.
- Reduces perceived latency via shell-first rendering and live stream text.
- Keeps implementation within existing Electron + Control UI architecture.

Tradeoff:

- Invoke shell is currently Windows-first in this phase; macOS parity remains follow-up.

---

## 7. Traceability

This decision fulfills:

- `TODO-P0-006` in [Prioritized TODO Backlog](/prd/project-neuro-architecture-and-task-breakdown#111-p0-must-deliver-for-ghost-layer-mvp)
