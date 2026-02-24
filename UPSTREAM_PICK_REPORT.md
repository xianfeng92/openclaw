# Upstream Pick Report (desktop-mvp-slim)

Date: 2026-02-24

## P0 (must-do security and auth hardening)

| Upstream commit | Local commit | Notes |
| --- | --- | --- |
| `c275932aa` | `2a8468c2b` | Skill packaging Zip Slip + symlink protections. |
| `ee1d6427b` | `530940170` | Symlink-safe skill packaging enforcement. |
| `f1e1ad73a` | _skipped (empty)_ | Became empty after conflict resolution on current branch. |
| `26c9b37f5` | `e61b75bbc` | Strict IPv4 SSRF literal handling. |
| `f7a7a28c5` | `977788d79` | Enforce hooks token separation from gateway auth (adapted to current runtime config path). |
| `981d26648` | `a68863f1c` | Block webchat session mutators. |
| `e955582c8` | `98419e919` | Baseline security headers on gateway HTTP responses. |
| `40a292619` | `c2c50af40` | Control UI insecure auth bypass hardening (adapted test harness). |
| `71bd15bb4` | `185e4d254` | Block special-use IPv4 ranges in SSRF checks. |
| `4b226b74f` | `44763e79f` | Archive extraction symlink escape protection. |
| `fe609c0c7` | `6a8b40199` | Block prototype-chain traversal in hook template path access. |
| `44dfbd23d` | `214969b86` | Centralize SSRF host/IP block checks. |
| `f4dd0577b` | `1b0e6f7bd` | Block hook transform symlink escapes (adapted for current `hooks.transformsDir` semantics). |

## P1 (cron stability fixes)

| Upstream commit | Local commit | Notes |
| --- | --- | --- |
| `39e3d58fe` | `cd237dfbe` | Prevent cron skips when `nextRunAtMs` advances. |
| `a88ea42ec` | `04d6e83cb` | Prevent one-shot `at` jobs re-firing after restart. |
| `b0dfb8395` | `71624309a` | Use requested `agentId` for isolated cron auth resolution. |
| `04e3a66f9` | `afc03a7a2` | Pass `agentId` to `runHeartbeatOnce` for main-session jobs. |
| `04f695e56` | `1b544c2db` | Isolate scheduler errors (one bad job should not break all). |
| `ace5e33ce` | `a1f31d2f2` | Re-arm timer when `onTimer` fires during active execution. |
| `dd6047d99` | `fd404d669` | Prevent duplicate fires when jobs trigger simultaneously. |

## P2

No additional P2 commit was picked in this batch.

## P0 (next security batch)

| Upstream commit | Local commit | Notes |
| --- | --- | --- |
| `649d14152` | `a77e8828d` | Prevent tabnabbing when opening chat images in Control UI. |
| `83689fc83` | `268578679` | Include proxy-vouched auth in shared-auth skip logic (adapted to current `tailscale` auth method in this branch). |
| `d51a4695f` | `7c5b77231` | Deny `cron` on HTTP tools invoke by default; kept explicit allow override path (`gateway.tools.allow`) for compatibility. |
| _local follow-up_ | `b4581221b` | Branch-specific backport alignment: auth method mapping + stable regression test mocks/error handling. |

## Test notes

- Focused regression suites passed:
  - `src/gateway/hooks-mapping.test.ts`
  - `src/infra/net/ssrf.pinning.test.ts`
  - `src/infra/archive.test.ts`
- New batch checks passed:
  - `src/gateway/tools-invoke-http.cron-regression.test.ts` (via `vitest.gateway` config)
  - `ui/src/ui/app-chat.test.ts`
  - `ui/src/ui/views/chat.test.ts`
- Full `pnpm test` was executed but does not pass on this branch due many existing unrelated failures/timeouts outside the picked areas.
