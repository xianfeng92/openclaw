# AI Collaboration Quality Guide

## Purpose

This document defines how to work with coding agents effectively in this repository and identifies the project changes that will most improve agent quality, speed, and reliability.

It combines:

- Official best practices from OpenAI and Anthropic
- Direct observations from the current repository structure
- Concrete actions for CyDeck / OpenClaw to reduce context noise and improve execution quality

## Executive Summary

The current project is already usable with AI, but it has four clear drag factors:

1. Too much low-value context is discoverable by default.
2. Too much critical logic is concentrated in a small number of very large files.
3. Project instructions are rich but not sufficiently layered for context-constrained agents.
4. Tasks are often expressed conversationally instead of being packaged as reusable task briefs with explicit acceptance criteria.

The highest-leverage changes are not model changes. They are repository hygiene, instruction modularization, task packetization, and evaluation.

## What Official Best Practices Say

### OpenAI

- Put instructions first and separate instructions from context clearly.
- Be specific about outcome, format, length, and success criteria.
- Show the desired output format with examples when consistency matters.
- High-quality instructions are especially important for agents because ambiguity causes tool and workflow errors.
- Start simple: maximize a single agent plus tools before adding orchestration complexity.
- Use evals, datasets, and prompt optimization to improve agent quality instead of relying on intuition.
- For risky or ambiguous behavior, strengthen prompts with policy documentation, examples, and human checkpoints.

Implication for this repo: prompt quality is not just a user skill problem. It is a systems problem. The repository must make the right context easy to load and the wrong context easy to ignore.

### Anthropic / Claude Code

- Persistent project instructions should be specific, concise, and well-structured.
- Claude Code recommends keeping each `CLAUDE.md` under about 200 lines and splitting large instructions into modular rules.
- Path-scoped rules reduce noise by loading only when relevant files are touched.
- Examples are one of the most reliable ways to improve accuracy and consistency.
- Add context and motivation, not only commands, so the model understands why a rule matters.
- Subagents are useful when work can be isolated or parallelized, but they consume context and should not be overused for quick iterative tasks.
- MCP and shared tool configuration are best handled centrally so all users get the same working environment.

Implication for this repo: the project needs layered, path-scoped AI instructions and a cleaner default context boundary.

## Current Repository Diagnosis

### 1. Context Noise Is Too High

Observed repository facts:

- `AGENTS.md` is 23,407 bytes and 196 lines.
- CyDeck already reported that this file exceeded the injected context limit and was truncated.
- `docs/` contains 694 files, including 647 Markdown files.
- `docs/zh-CN/` alone contains 309 generated files.
- `.openclaw/worktrees/` contains 5 nested worktrees and about 68,110 files.

Why this hurts AI:

- Agents search locally before they understand which files are authoritative.
- Nested worktrees and generated docs create false positives during search and summarization.
- Truncated bootstrap instructions create the worst of both worlds: high token cost and incomplete guidance.
- A large instruction file at repository root increases startup cost for every task, even when most rules are irrelevant.

Conclusion:

The primary problem is not "too many docs" in the abstract. The real problem is that high-noise material is too close to the default search and instruction path.

### 2. Instructions Exist, But They Are Not Layered Well Enough

Observed repository facts:

- Root `CLAUDE.md` is only a pointer to `AGENTS.md`.
- The main instruction source is therefore a single broad repository bootstrap file.
- The project already contains many specialized domains: channels, gateway, desktop, orchestration, mobile, docs, release, plugins.

Why this hurts AI:

- One large root instruction file forces every task to pay for every domain.
- Broad instructions increase contradiction risk.
- A coding agent working on `apps/windows` does not need most release, iOS, channel, or VM operational guidance in active context.

Conclusion:

The repo needs a thin root bootstrap plus modular, path-scoped instructions for major domains.

### 3. Code Locality Is Weak In High-Churn Areas

Observed repository facts:

- 45 TypeScript files under `src/` exceed 700 lines.
- Notable hotspots include:
  - `src/telegram/bot.test.ts` at 2,698 lines
  - `src/memory/manager.ts` at 2,310 lines
  - `src/infra/exec-approvals.ts` at 2,288 lines
  - `src/agents/bash-tools.exec.ts` at 1,772 lines

Why this hurts AI:

- Large files reduce edit precision and increase regression risk.
- Agents spend more tokens rediscovering file structure before making a safe change.
- Multi-concern files blur boundaries between policy, orchestration, platform differences, and execution logic.

Conclusion:

This is not only a maintainability issue. It is an AI execution quality issue. Oversized files materially reduce change accuracy.

### 4. Task Inputs Are Often Under-Specified For One-Shot Execution

Observed pattern:

- High-level goals are usually clear.
- Constraints, target files, non-goals, and acceptance checks are often clarified over multiple turns instead of being provided up front.

Why this hurts AI:

- The agent must infer too much before acting.
- Re-planning cost increases across turns.
- Verification becomes ambiguous, especially when the task spans product planning, implementation, and validation.

Conclusion:

The project needs a standard task brief format for all non-trivial AI work.

### 5. Environment Semantics Are Not Predictable Enough

Observed pattern:

- The project runs on Windows, WSL, Node, Bun, sandbox, gateway, and worktree-based agent execution.
- Shell semantics differ across these environments.
- This already surfaced in agent failures where commands were valid in PowerShell but not in plain `cmd` execution.

Why this hurts AI:

- Tool reliability drops when environment assumptions are implicit.
- Agents waste effort on command adaptation instead of task completion.

Conclusion:

The repo needs one authoritative "AI-safe command surface" with OS-aware examples and fallbacks.

## What To Change First

### P0: Fix These Immediately

#### 1. Split root instructions into a thin bootstrap plus scoped rule files

Target state:

- Keep root `AGENTS.md` as a short bootstrap only.
- Move domain-specific instructions into files such as:
  - `.ai/rules/windows-agenting.md`
  - `.ai/rules/docs.md`
  - `.ai/rules/release.md`
  - `.ai/rules/mobile.md`
  - `.ai/rules/pr-review.md`
- Load or reference these only when the task is in scope.

Why:

- Matches Anthropic's guidance to keep persistent instructions concise and modular.
- Reduces truncation risk and improves adherence.

#### 2. Define an AI search exclusion policy

Default exclude set should include at least:

- `.openclaw/worktrees/`
- `node_modules/`
- `dist/`
- `docs/zh-CN/`
- generated caches and task logs

Why:

- This is the single fastest way to reduce low-value retrieval noise.

#### 3. Introduce an authoritative AI context index

Add one small file, for example `AI_CONTEXT_INDEX.md`, containing:

- Current product areas
- Source-of-truth docs by area
- Commands that are verified to work
- Directories that should usually be ignored
- Where task briefs live

Why:

- Agents need an index before they need a library.

#### 4. Standardize a task brief template

Every medium or large AI task should include:

- Goal
- Non-goals
- Relevant files or directories
- Constraints
- Expected output
- Verification commands
- Definition of done

Why:

- This directly implements OpenAI's advice to make instructions specific and explicit.

#### 5. Add an AI evaluation set

Create a small regression set of canonical agent tasks:

- Find and patch a Windows shell issue
- Update a CLI command and tests
- Add a UI setting and wire it through IPC
- Review a PR without changing code
- Produce a planning document from repository context

For each task, store:

- Prompt
- Expected touched files
- Expected verification
- Failure modes

Why:

- OpenAI explicitly recommends evals, datasets, and prompt optimization for agent quality.

### P1: Fix Next

#### 6. Refactor the worst high-churn large files

Prioritize files that are both large and frequently touched:

- `src/agents/bash-tools.exec.ts`
- `src/infra/exec-approvals.ts`
- `src/memory/manager.ts`
- Windows terminal and orchestration entry points

Refactor rule:

- Split by responsibility, not by arbitrary line count.
- Prefer "policy", "platform adapter", "parsing", and "execution" boundaries.

#### 7. Add document lifecycle metadata

For internal planning and engineering docs, add a simple header:

- `Status: authoritative | generated | draft | archive`
- `Audience: human | agent | both`
- `Scope: repo | windows-app | gateway | docs`

Why:

- Agents currently cannot distinguish source-of-truth docs from historical notes or generated mirrors.

#### 8. Create a verified command catalog

Add one file for commands agents can trust:

- install
- build
- lint
- test
- targeted test
- Windows-safe search commands
- repo-specific commit workflow

Why:

- The model should not have to infer shell conventions from scattered instructions.

#### 9. Separate human reference docs from agent bootstrap docs

Do not make agents ingest every good human document.

Instead:

- Human docs can remain broad and explanatory.
- Agent docs should be terse, operational, and scoped.

Why:

- Good human docs are often too verbose for agent startup context.

### P2: Structural Upgrades

#### 10. Add path-scoped AI rules

Examples:

- `apps/windows/**` -> Windows shell, IPC, Electron, smoke-test rules
- `docs/**` -> Mintlify and docs linking rules
- `src/agents/**` -> tool safety, approvals, shell semantics
- `extensions/**` -> plugin dependency and install rules

#### 11. Add reusable AI work packets

Store templates for:

- bug fix
- feature implementation
- code review
- refactor
- docs update
- smoke validation

#### 12. Add agent-readable ownership boundaries

Examples:

- "If touching routing, inspect all built-in and extension channels."
- "If touching Windows terminal IPC, review preload, renderer, main, and tests together."

This guidance exists today, but it is buried in a broad instruction file rather than structured as decision rules.

## AI Interaction Quality Standard

### A good task prompt in this repo should answer all seven questions

1. What exact outcome is wanted?
2. What is out of scope?
3. Where should the agent look first?
4. What constraints must not be violated?
5. What concrete artifact is expected?
6. How should the result be verified?
7. Should the agent stop at planning or continue through implementation and test?

### Minimum prompt quality bar

Bad:

```text
Fix Windows issues in the terminal.
```

Good:

```text
Goal: fix the Windows agent spawn failures caused by shell command mismatches.
Scope: apps/windows terminal orchestration and exec-related safety only.
Start here: apps/windows/src/main/windows-agent-manager.ts and related tests.
Do not change unrelated CyDeck Phase A UI files.
Output: code changes plus tests.
Verify with: targeted vitest tests for windows-agent-manager and a manual /spawn smoke path.
Definition of done: no bare PowerShell cmdlets are emitted into cmd-only paths; tests pass.
```

### Best prompt pattern for non-trivial tasks

Use this template:

```text
Goal:

Why:

Scope:

Non-goals:

Start files:

Constraints:

Expected output:

Verification:

Definition of done:
```

## Recommended Operating Model For This Project

### Before the task

- Start from a clean task brief.
- Point the agent to the smallest relevant file set.
- Name the validation command before coding starts.

### During the task

- Prefer one agent per worktree and one concern per task.
- Use subagents only for isolated or parallelizable work.
- Keep the main thread focused on one deliverable at a time.

### After the task

- Record the final validation steps.
- Capture any new stable rule into modular AI instructions, not chat memory.
- Add recurring failures to the eval set.

## Concrete Recommendations For CyDeck / OpenClaw

### Immediate repository changes

1. Replace the current root instruction strategy with a small bootstrap plus scoped rule files.
2. Exclude `.openclaw/worktrees`, `docs/zh-CN`, `dist`, and other generated directories from default AI retrieval.
3. Add `AI_CONTEXT_INDEX.md` as the first-stop map for agents.
4. Add `AI_TASK_TEMPLATE.md` and require it for medium and large tasks.
5. Create `AI_EVALS.md` plus a small prompt corpus for recurring CyDeck tasks.

### Immediate workflow changes

1. Stop giving large tasks as free-form conversation only; convert them into task briefs.
2. Stop relying on a single giant instruction file as the bootstrap context.
3. Stop making the agent infer command safety from the environment; provide verified commands.
4. Stop letting generated docs compete with source-of-truth docs in default search results.

### Immediate codebase changes

1. Start a rolling split of the top 10 largest high-churn files.
2. Add platform-specific command adapters where shell differences are known.
3. Add small smoke tests for the most common agent workflows, especially Windows task spawn and exec flows.

## Suggested Implementation Order

Week 1:

- Ship `AI_CONTEXT_INDEX.md`
- Ship `AI_TASK_TEMPLATE.md`
- Ship search exclusion rules for noisy directories
- Split `AGENTS.md` into bootstrap plus modular files

Week 2:

- Create first 10 AI eval tasks
- Refactor one large hotspot file
- Add document lifecycle metadata to planning and generated docs

Week 3:

- Add path-scoped AI rules for Windows, docs, and agent infrastructure
- Add verified command catalog
- Review results and cut more obsolete or duplicate guidance

## Source Notes

The recommendations above are based on repository inspection plus the following official sources:

- OpenAI Help Center, "Best practices for prompt engineering with the OpenAI API": instructions first, specificity, examples.
- OpenAI, "A practical guide to building agents": instruction quality, single-agent-first strategy, human intervention, orchestration guidance.
- OpenAI Agents guide: evals, datasets, prompt optimization.
- OpenAI agent safety guide: policy docs and examples for steering agent behavior.
- Anthropic, "How Claude remembers your project": concise project memory, modular rules, path-scoped loading, large-project guidance.
- Anthropic, "Prompting best practices": clear instructions, context, examples, explicit tool guidance.
- Anthropic, "Create custom subagents": use subagents when context can be isolated, avoid unnecessary delegation.
- Anthropic, "Building effective agents": simple composable systems, tool design quality, avoid unnecessary framework complexity.

## Source Links

- https://help.openai.com/en/articles/6654000-prompt-engineering-guide
- https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf
- https://developers.openai.com/api/docs/guides/agents
- https://developers.openai.com/api/docs/guides/agent-builder-safety
- https://code.claude.com/docs/en/memory
- https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
- https://code.claude.com/docs/en/sub-agents
- https://www.anthropic.com/engineering/building-effective-agents
