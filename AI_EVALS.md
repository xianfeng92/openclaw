# AI Eval Set

Use this file as the initial regression set for agent quality. Each eval should be runnable as a prompt plus explicit verification.

## Eval Format

For each eval, record:

- Goal
- Prompt
- Expected touched files
- Verification
- Common failure modes

## Eval 1: Windows Exec Fallback

- Goal: ensure Windows shell mismatches are handled safely.
- Prompt: fix a Windows exec failure caused by bare PowerShell cmdlets in cmd-only paths.
- Expected touched files: `src/agents/bash-tools.exec.ts`, related Windows tests.
- Verification: targeted vitest for exec fallback and any Windows manager tests.
- Common failure modes: fixing only one execution path, breaking sandbox behavior, changing approval text to encoded commands.

## Eval 2: CLI Flag Wiring

- Goal: add or adjust a CLI flag and keep wiring, help text, and tests in sync.
- Prompt: implement a small CLI option end to end.
- Expected touched files: `src/cli/**`, relevant command files, colocated tests.
- Verification: targeted vitest plus a CLI invocation if applicable.
- Common failure modes: help text drift, missing dependency injection wiring, no regression tests.

## Eval 3: Windows Setting Through IPC

- Goal: add a Windows app setting and wire it through main, preload, and terminal/UI usage.
- Prompt: implement a single settings field with persistence and tests.
- Expected touched files: `apps/windows/src/main/**`, `apps/windows/src/preload/**`, terminal/UI consumer, tests.
- Verification: targeted vitest and a manual settings smoke check.
- Common failure modes: missing preload exposure, persistence mismatch, no renderer-side handling.

## Eval 4: PR Review Only

- Goal: review a PR without modifying code.
- Prompt: inspect a PR and return findings only, ordered by severity.
- Expected touched files: none.
- Verification: output contains findings with file references or explicitly states no findings.
- Common failure modes: changing branches, editing files, over-focusing on summary instead of findings.

## Eval 5: Planning Document From Repo Context

- Goal: produce a planning or product document grounded in the current repo.
- Prompt: generate a PRD or technical plan for a scoped feature area.
- Expected touched files: a single planning document.
- Verification: document includes scope, milestones, technical tasks, acceptance criteria, and repo-specific references.
- Common failure modes: generic output, no repo grounding, no acceptance criteria.

## Eval 6: Channel-Sensitive Refactor

- Goal: make a shared routing or channel change without missing extension surfaces.
- Prompt: update a shared messaging or routing behavior.
- Expected touched files: core routing plus any relevant built-in or extension channels.
- Verification: targeted tests and a change summary listing touched channel surfaces.
- Common failure modes: changing only one built-in channel, ignoring extensions, incomplete docs updates.

## Operating Rule

When a repeated failure appears in real agent work, add it here as a new eval before changing prompts again.
