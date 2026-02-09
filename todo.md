# Desktop MVP Slim Branch - Work Plan / TODO

## Working Agreements (Must Follow)

Verbatim requirements (from user):

> 1) 无论接下来做什么，都要把计划和 todo 列表放在一个 work.md 或 todo.md 这类文件里。
> 2) 每完成一个阶段的工作，就把上一阶段的经验教训更新到 agents.md 里。
> 3) 当一个计划完成并且代码合并后，把这个工作的设计文档添加到项目的知识库中（.codex/knowledge）。

Operationalization:

- Keep the active plan + TODOs in `todo.md` (this file) or `work.md`. Prefer `todo.md` unless the file gets too large.
- When a phase completes, append a short "Lessons Learned" entry for that phase to `AGENTS.md`.
- When the plan is fully completed and merged, add a design doc to `.codex/knowledge/` (create the directory if missing).

## Goals

- Produce a "desktop MVP slim" branch that keeps the desktop experience usable while cutting non-desktop scope.
- Decide desktop gateway auth UX (token/device token) without weakening security.
- Keep `cli_model` as a long-term supported capability (not a temporary hack).

## Current State (Snapshot: 2026-02-09)

- Work is on `desktop-mvp-slim`, rebased onto current `origin/main` (no longer behind).
- Large baseline commit exists: Android/iOS removed; most `extensions/*` removed; Windows desktop app added.
- Gates are not green (typecheck/tests/lint/format issues remain).

## Top Risks / Must-Fix Findings (From Review)

- Gateway auth bypass: "localDirect" requests can skip auth based on spoofable headers (User-Agent/Host).
- `cli_model` tool: executes shell command strings via PowerShell (`exec` + interpolation), unsafe by default and bypasses exec policy.
- `fs_read` tool: workspace boundary check is symlink-bypassable; file reads are unbounded; output includes non-ASCII icons.
- Logging: debug/info logs include user/assistant text snippets (risk of leaking sensitive content to logs).

## Decisions (Pending)

- Desktop token strategy:
- Desktop slim gating strategy (env/config driven vs hardcoded):
- Desktop minimal toolset strategy (default vs opt-in):
- Plugin strategy for slim build (keep disabled vs remove references/tests):

## Phase Plan

### Phase 0 - Branch Hygiene / Baseline

TODO:

- [x] Create a dedicated branch for this work (do not continue directly on `main`). (Created: `desktop-mvp-slim`)
- [x] Sync with `origin/main` early so the slim branch is based on current head. (Rebased: 2026-02-09)
- [x] Define "what must stay green" for this slim branch.

Green gates (run before push):

- `pnpm check` (typecheck + lint + format)
- `pnpm build`
- `pnpm ui:build`
- `pnpm test` (unit + gateway)
- Windows desktop: `pnpm --dir apps/windows typecheck` and `pnpm --dir apps/windows build`

Lessons Learned (to append to `AGENTS.md` when Phase 0 completes):

- TBD

### Phase 1 - Security Hardening (Blockers)

TODO:

- Remove or redesign the "localDirect skips auth" behavior. At minimum, require loopback client IP before any bypass, and do not bypass token/password for HTTP endpoints like `/tools/invoke`.
- Restore expected auth semantics and fix affected tests (`src/gateway/auth.test.ts`, `src/gateway/tools-invoke-http.test.ts`).
- Harden `cli_model` for long-term use:
- Make it disabled by default (opt-in via config/flag).
- Restrict `action` to a strict enum / allowlist.
- Replace shell-string `exec()` with a safe spawn/execFile strategy (no shell injection).
- Add timeouts, output limits, and integrate with existing exec security/approval policy.
- Fix `fs_read`:
- Prevent symlink escape (use `lstat` and/or `realpath` checks).
- Add max-bytes + truncation for file reads and directory trees.
- Keep output ASCII-only (no emoji icons).
- Remove or gate logs that include message content snippets (reply dispatcher, webchat, UI debug logs).

Lessons Learned (to append to `AGENTS.md` when Phase 1 completes):

- TBD

### Phase 2 - Typecheck / Lint / Format Green

TODO:

- Fix `pnpm tsgo` errors:
- `src/cli/gateway-cli/dev.ts`: type `baseConfig` as `OpenClawConfig` (avoid string widening).
- `ui/src/ui/app-view-state.ts`: add `chatWaitingForResponse`.
- `ui/src/ui/controllers/chat.test.ts`: ensure `chatWaitingForResponse` is always provided (boolean).
- Run and fix `pnpm check` (lint + format) until clean.

Lessons Learned (to append to `AGENTS.md` when Phase 2 completes):

- TBD

### Phase 3 - Desktop Auth UX ("Tokenless Feel", Still Secure)

TODO:

- Keep token/device-token auth enabled, but make it user-invisible in the desktop app:
- Generate/store token for the desktop profile.
- Start gateway with loopback bind and auth enabled.
- Ensure the desktop UI connects using the token without leaking it (avoid logs/URL where possible).
- Add docs for recovery/reset flows.

Lessons Learned (to append to `AGENTS.md` when Phase 3 completes):

- TBD

### Phase 4 - Slim Scope Alignment (Plugins, Tests, Packaging)

TODO:

- Decide plugin strategy for slim branch:
- Option A: keep plugin system, but disabled by default in desktop slim mode; keep core plugin catalog/tests adjusted.
- Option B: remove plugin catalog usage and adjust tests to not import deleted `extensions/*`.
- Align CLI behavior with slim mode (avoid half-disabled code paths like "empty plugin registration block").
- Get `pnpm test` green under the decided scope (may require updating/removing extension-dependent tests).

Lessons Learned (to append to `AGENTS.md` when Phase 4 completes):

- TBD

### Phase 5 - Wrap Up / Merge / Knowledge Base

TODO:

- Add a design doc for this work into `.codex/knowledge/` after the plan is complete and merged.
- Ensure `AGENTS.md` contains the phase-by-phase "Lessons Learned" entries.

Lessons Learned (to append to `AGENTS.md` when Phase 5 completes):

- TBD
