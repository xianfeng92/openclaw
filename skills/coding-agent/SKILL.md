---
name: coding-agent
description: Run OpenClaw's built-in agent or external coding agents (Claude Code, Codex, Pi) for programmatic control.
metadata:
  {
    "openclaw": { "emoji": "🧩", "requires": { "anyBins": ["claude", "codex", "opencode", "pi", "openclaw"] } },
  }
---

# Coding Agent (Cross-Platform)

**Preferred: Use OpenClaw's built-in agent** - it's cross-platform and works on Windows, macOS, and Linux.

## ⚠️ Windows Users: Use OpenClaw Built-in Agent

On Windows, external tools like Codex have compatibility issues with PowerShell. **Use `openclaw agent` instead:**

```bash
# ✅ Recommended for Windows - native agent
openclaw agent --local --workspace "C:\path\to\project" --message "Your task here"

# ✅ Or use spawn for isolated worktrees
/spawn "Your task description"
```

The OpenClaw built-in agent:
- Works on all platforms (Windows, macOS, Linux)
- Handles git operations automatically
- Provides PTY emulation for correct output
- Manages worktrees for isolated work

## ⚠️ PTY Mode Required!

Coding agents (Codex, Claude Code, Pi) are **interactive terminal applications** that need a pseudo-terminal (PTY) to work correctly. Without PTY, you'll get broken output, missing colors, or the agent may hang.

**Always use `pty:true`** when running coding agents:

```bash
# ✅ Correct - with PTY
bash pty:true command:"codex exec 'Your prompt'"

# ❌ Wrong - no PTY, agent may break
bash command:"codex exec 'Your prompt'"
```

### Bash Tool Parameters

| Parameter    | Type    | Description                                                                 |
| ------------ | ------- | --------------------------------------------------------------------------- |
| `command`    | string  | The shell command to run                                                    |
| `pty`        | boolean | **Use for coding agents!** Allocates a pseudo-terminal for interactive CLIs |
| `workdir`    | string  | Working directory (agent sees only this folder's context)                   |
| `background` | boolean | Run in background, returns sessionId for monitoring                         |
| `timeout`    | number  | Timeout in seconds (kills process on expiry)                                |
| `elevated`   | boolean | Run on host instead of sandbox (if allowed)                                 |

### Process Tool Actions (for background sessions)

| Action      | Description                                          |
| ----------- | ---------------------------------------------------- |
| `list`      | List all running/recent sessions                     |
| `poll`      | Check if session is still running                    |
| `log`       | Get session output (with optional offset/limit)      |
| `write`     | Send raw data to stdin                               |
| `submit`    | Send data + newline (like typing and pressing Enter) |
| `send-keys` | Send key tokens or hex bytes                         |
| `paste`     | Paste text (with optional bracketed mode)            |
| `kill`      | Terminate the session                                |

---

## Windows-Specific Commands

On Windows PowerShell/CMD, use OpenClaw's native agent instead of bash commands:

```powershell
# PowerShell: Use OpenClaw built-in agent
openclaw agent --local --workspace "C:\Projects\MyProject" --message "Add error handling"

# Or use the spawn command in OpenClaw Terminal
/spawn "Add error handling to the API calls"

# For temp directory work (PowerShell 7+ with && support):
$scratch = New-TemporaryFile | % { Remove-Item $_; mkdir $_ }; cd $scratch; git init; openclaw agent --local --message "Your task"

# For older PowerShell (no &&):
$scratch = [System.IO.Path]::GetTempPath() + [Guid]::NewGuid()
mkdir $scratch; cd $scratch
git init
openclaw agent --local --message "Your task here"
```

**Do NOT use:** `&&` chaining in older PowerShell, `mktemp`, or bash-style paths (`~/project`).

---

## Unix/Linux/macOS: Quick Start

On Unix-like systems with bash, you can use external tools or OpenClaw's built-in agent:

```bash
# ✅ Using OpenClaw built-in agent (recommended - works everywhere)
openclaw agent --local --workspace ~/Projects/myproject --message "Add error handling to the API calls"

# ✅ Quick temp directory setup (bash)
SCRATCH=$(mktemp -d) && cd $SCRATCH && git init && openclaw agent --local --message "Your prompt here"

# ⚠️ External tool example (Codex - requires separate installation)
SCRATCH=$(mktemp -d) && cd $SCRATCH && git init && codex exec "Your prompt here"
```

**Why git init?** Some tools (like Codex) refuse to run outside a git directory. OpenClaw's agent is more flexible but still works best with git.

---

## Platform Detection

Before running commands, check the platform:

```javascript
// In tool calls, check process.platform or use appropriate commands
// - "win32": Use PowerShell/Windows commands or openclaw agent
// - "darwin", "linux": Use bash commands
```

**Rules:**
1. **On Windows**: Always prefer `openclaw agent --local` over external tools
2. **On Unix**: Can use bash commands with `&&`, `mktemp`, etc.
3. **When in doubt**: Use `openclaw agent --local` - it works everywhere

---

## The Pattern: workdir + background + pty (Unix only)

For longer tasks on Unix-like systems, use background mode with PTY:

```bash
# Start agent in target directory (with PTY!)
bash pty:true workdir:~/project background:true command:"openclaw agent --local --message 'Build a snake game'"
# Returns sessionId for tracking

# Monitor progress
process action:log sessionId:XXX

# Check if done
process action:poll sessionId:XXX

# Send input (if agent asks a question)
process action:write sessionId:XXX data:"y"

# Submit with Enter (like typing "yes" and pressing Enter)
process action:submit sessionId:XXX data:"yes"

# Kill if needed
process action:kill sessionId:XXX
```

**Why workdir matters:** Agent wakes up in a focused directory, doesn't wander off reading unrelated files (like your soul.md 😅).

---

## Windows Pattern: Use spawn or agent command

On Windows, use OpenClaw's orchestral commands instead of bash/process tools:

```powershell
# Use the spawn command (creates isolated worktree automatically)
/spawn "Build a snake game with HTML5 Canvas"

# Or use agent command directly
openclaw agent --local --workspace "C:\Projects\MyProject" --message "Build a snake game"
```

---

## Codex CLI (Unix/Linux/macOS only - NOT Windows)

**⚠️ WARNING: Codex CLI does NOT work properly on Windows PowerShell.** Use `openclaw agent` instead on Windows.

**Model:** `gpt-5.2-codex` is the default (set in ~/.codex/config.toml)

### Flags

| Flag            | Effect                                             |
| --------------- | -------------------------------------------------- |
| `exec "prompt"` | One-shot execution, exits when done                |
| `--full-auto`   | Sandboxed but auto-approves in workspace           |
| `--yolo`        | NO sandbox, NO approvals (fastest, most dangerous) |

### Building/Creating (Unix only)

```bash
# Quick one-shot (auto-approves) - remember PTY!
bash pty:true workdir:~/project command:"codex exec --full-auto 'Build a dark mode toggle'"

# Background for longer work
bash pty:true workdir:~/project background:true command:"codex --yolo 'Refactor the auth module'"
```

### Windows Alternative

```powershell
# Instead of codex on Windows, use:
openclaw agent --local --workspace "C:\Projects\MyProject" --message "Build a dark mode toggle"
```

### Reviewing PRs

**⚠️ CRITICAL: Never review PRs in OpenClaw's own project folder!**
Clone to temp folder or use git worktree.

```bash
# Clone to temp for safe review
REVIEW_DIR=$(mktemp -d)
git clone https://github.com/user/repo.git $REVIEW_DIR
cd $REVIEW_DIR && gh pr checkout 130
bash pty:true workdir:$REVIEW_DIR command:"codex review --base origin/main"
# Clean up after: trash $REVIEW_DIR

# Or use git worktree (keeps main intact)
git worktree add /tmp/pr-130-review pr-130-branch
bash pty:true workdir:/tmp/pr-130-review command:"codex review --base main"
```

### Batch PR Reviews (parallel army!)

```bash
# Fetch all PR refs first
git fetch origin '+refs/pull/*/head:refs/remotes/origin/pr/*'

# Deploy the army - one Codex per PR (all with PTY!)
bash pty:true workdir:~/project background:true command:"codex exec 'Review PR #86. git diff origin/main...origin/pr/86'"
bash pty:true workdir:~/project background:true command:"codex exec 'Review PR #87. git diff origin/main...origin/pr/87'"

# Monitor all
process action:list

# Post results to GitHub
gh pr comment <PR#> --body "<review content>"
```

---

## Claude Code

```bash
# With PTY for proper terminal output
bash pty:true workdir:~/project command:"claude 'Your task'"

# Background
bash pty:true workdir:~/project background:true command:"claude 'Your task'"
```

---

## OpenCode

```bash
bash pty:true workdir:~/project command:"opencode run 'Your task'"
```

---

## Pi Coding Agent

```bash
# Install: npm install -g @mariozechner/pi-coding-agent
bash pty:true workdir:~/project command:"pi 'Your task'"

# Non-interactive mode (PTY still recommended)
bash pty:true command:"pi -p 'Summarize src/'"

# Different provider/model
bash pty:true command:"pi --provider openai --model gpt-4o-mini -p 'Your task'"
```

**Note:** Pi now has Anthropic prompt caching enabled (PR #584, merged Jan 2026)!

---

## Parallel Issue Fixing with git worktrees

For fixing multiple issues in parallel, use git worktrees:

```bash
# 1. Create worktrees for each issue
git worktree add -b fix/issue-78 /tmp/issue-78 main
git worktree add -b fix/issue-99 /tmp/issue-99 main

# 2. Launch Codex in each (background + PTY!)
bash pty:true workdir:/tmp/issue-78 background:true command:"pnpm install && codex --yolo 'Fix issue #78: <description>. Commit and push.'"
bash pty:true workdir:/tmp/issue-99 background:true command:"pnpm install && codex --yolo 'Fix issue #99: <description>. Commit and push.'"

# 3. Monitor progress
process action:list
process action:log sessionId:XXX

# 4. Create PRs after fixes
cd /tmp/issue-78 && git push -u origin fix/issue-78
gh pr create --repo user/repo --head fix/issue-78 --title "fix: ..." --body "..."

# 5. Cleanup
git worktree remove /tmp/issue-78
git worktree remove /tmp/issue-99
```

---

## ⚠️ Rules

1. **Platform detection first:** Check if running on Windows (`process.platform === "win32"`) before using bash commands.
2. **On Windows: Use `openclaw agent` or `/spawn`** - External tools like Codex have PowerShell compatibility issues.
3. **On Unix: Can use external tools** - Codex, Claude Code, Pi all work with bash.
4. **Always use pty:true on Unix** - coding agents need a terminal!
5. **Respect tool choice** - if user asks for Codex (on Unix), use Codex.
   - On Windows, inform user of limitation and suggest `openclaw agent` instead.
   - Orchestrator mode: do NOT hand-code patches yourself.
   - If an agent fails/hangs, respawn it or ask the user for direction, but don't silently take over.
6. **Be patient** - don't kill sessions because they're "slow"
7. **Monitor with process:log** - check progress without interfering (Unix only)
8. **--full-auto for building** - auto-approves changes (Codex Unix only)
9. **vanilla for reviewing** - no special flags needed
10. **Parallel is OK** - run many agent processes at once for batch work
11. **NEVER start external agents in sensitive directories** - they'll read files they shouldn't.

---

## Progress Updates (Critical)

When you spawn coding agents in the background, keep the user in the loop.

- Send 1 short message when you start (what's running + where).
- Then only update again when something changes:
  - a milestone completes (build finished, tests passed)
  - the agent asks a question / needs input
  - you hit an error or need user action
  - the agent finishes (include what changed + where)
- If you kill a session, immediately say you killed it and why.

This prevents the user from seeing only "Agent failed before reply" and having no idea what happened.

---

## Auto-Notify on Completion

For long-running background tasks, append a wake trigger to your prompt so OpenClaw gets notified immediately when the agent finishes (instead of waiting for the next heartbeat):

```
... your task here.

When completely finished, run this command to notify me:
openclaw gateway wake --text "Done: [brief summary of what was built]" --mode now
```

**Example:**

```bash
bash pty:true workdir:~/project background:true command:"codex --yolo exec 'Build a REST API for todos.

When completely finished, run: openclaw gateway wake --text \"Done: Built todos REST API with CRUD endpoints\" --mode now'"
```

This triggers an immediate wake event — Skippy gets pinged in seconds, not 10 minutes.

---

## Learnings (Feb 2026)

- **Cross-platform is key:** `openclaw agent --local` works on Windows, macOS, and Linux. Prefer it over external tools.
- **Windows limitations:** PowerShell < 7 doesn't support `&&`, has no `mktemp`, uses different path syntax.
- **PTY is essential on Unix:** Coding agents are interactive terminal apps. Without `pty:true`, output breaks or agent hangs.
- **Git repo recommended:** Some tools won't run outside a git directory. Use `mktemp -d && git init` for scratch work on Unix.
- **Spawn is your friend:** The `/spawn` command creates isolated worktrees automatically on all platforms.
- **Sass works:** Agents respond well to playful prompts. Asked it to write a haiku about being second fiddle to a space lobster, got: _"Second chair, I code / Space lobster sets the tempo / Keys glow, I follow"_ 🦞
