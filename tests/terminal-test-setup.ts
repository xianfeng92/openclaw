#!/usr/bin/env node
/**
 * Automated Test Setup for OpenClaw Terminal
 *
 * This script creates test data for Obsidian vault and provides test commands.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DIR = path.join(__dirname, "..", "test-data");
const OBSIDIAN_VAULT = path.join(TEST_DIR, "obsidian-vault");

interface TestCommand {
  command: string;
  description: string;
  expectedOutput: string;
}

/**
 * Create test Obsidian vault with sample data
 */
async function createTestObsidianVault(): Promise<void> {
  console.log("\x1b[36m[SETUP]\x1b[0m Creating test Obsidian vault...");

  // Create directory structure
  const folders = ["Customers", "Projects", "Meetings", "Decisions", "Patterns"];
  for (const folder of folders) {
    const dirPath = path.join(OBSIDIAN_VAULT, folder);
    await fs.promises.mkdir(dirPath, { recursive: true });
  }

  // Create Customer files
  await fs.promises.writeFile(
    path.join(OBSIDIAN_VAULT, "Customers", "AcmeCorp.md"),
    `---
name: AcmeCorp
industry: E-commerce
tags: [customer, active]
---

# AcmeCorp

## Overview
Large e-commerce platform with 10M+ users.

## Tech Stack
- Backend: Node.js, PostgreSQL
- Frontend: React, TypeScript
- Infrastructure: AWS, Kubernetes

## Notes
- SLA: 99.9% uptime required
- Monthly billing cycle
- Priority support contract
`,
  );

  await fs.promises.writeFile(
    path.join(OBSIDIAN_VAULT, "Customers", "GlobexInc.md"),
    `---
name: GlobexInc
industry: Fintech
tags: [customer, active]
---

# GlobexInc

## Overview
Financial technology startup focused on payments.

## Tech Stack
- Backend: Go, MongoDB
- Frontend: Vue.js
- Infrastructure: GCP

## Notes
- High security requirements (PCI-DSS)
- Real-time transaction processing
`,
  );

  // Create Project files
  await fs.promises.writeFile(
    path.join(OBSIDIAN_VAULT, "Projects", "OpenClaw.md"),
    `---
name: OpenClaw
status: In Progress
tags: [internal, cli]
---

# OpenClaw - AI Terminal

## Description
Personal AI super terminal with orchestration capabilities.

## Architecture
- Electron desktop app
- Gateway for AI model routing
- Agent orchestration system

## Milestones
- [x] Basic terminal UI
- [x] Context management
- [x] Pattern management
- [ ] Full agent integration
- [ ] Babysit loop
`,
  );

  await fs.promises.writeFile(
    path.join(OBSIDIAN_VAULT, "Projects", "CustomerPortal.md"),
    `---
name: CustomerPortal
status: Active
tags: [customer, web]
---

# Customer Portal

## Description
Self-service portal for AcmeCorp customers.

## Features
- Dashboard with analytics
- Account management
- Support ticket system

## Tech Stack
- Next.js 14
- Prisma ORM
- PostgreSQL
`,
  );

  // Create Meeting files
  const today = new Date().toISOString().split("T")[0];
  await fs.promises.writeFile(
    path.join(OBSIDIAN_VAULT, "Meetings", `${today}-ArchitectureReview.md`),
    `---
date: ${today}
attendees: [Alice, Bob, Charlie]
type: Architecture Review
---

# Architecture Review - OpenClaw

## Attendees
- Alice (Tech Lead)
- Bob (Backend)
- Charlie (Frontend)

## Discussion Points

### 1. Context Management System
**Decision**: Use SQLite for local storage with vector embeddings for search.

**Rationale**:
- Fast local access
- No external dependencies
- Sufficient for personal use

### 2. Agent Orchestration
**Decision**: Use tmux sessions for isolation.

**Rationale**:
- Simple and reliable
- Easy to attach/detach
- Works with existing CLI tools

## Action Items
- [ ] Implement context sync from Obsidian
- [ ] Build pattern recommendation engine
- [ ] Add babysit loop for monitoring

## Next Meeting
${today} - Sprint Planning
`,
  );

  await fs.promises.writeFile(
    path.join(OBSIDIAN_VAULT, "Meetings", `2025-02-20-Kickoff.md`),
    `---
date: 2025-02-20
attendees: [Team]
type: Project Kickoff
---

# OpenClaw Project Kickoff

## Objectives
Build a personal AI terminal that can:
1. Manage context from Obsidian vault
2. Orchestrate AI agents for tasks
3. Track and recommend effective patterns
4. Auto-retry failed tasks

## Timeline
- Phase 1: Terminal UI + Context (2 weeks)
- Phase 2: Agent Orchestration (2 weeks)
- Phase 3: Pattern Management (1 week)
- Phase 4: Babysit Loop (1 week)

## Key Decisions
- Use Electron for desktop app
- Use TypeScript throughout
- Use Dracula theme for terminal
`,
  );

  // Create Decision files
  await fs.promises.writeFile(
    path.join(OBSIDIAN_VAULT, "Decisions", `2025-02-15-UseTypeScript.md`),
    `---
date: 2025-02-15
status: Accepted
tags: [language, typescript]
---

# Use TypeScript for All Code

## Context
OpenClaw needs to be maintainable and reliable for long-term personal use.

## Decision
Use TypeScript for all new code in the project.

## Alternatives Considered
1. **JavaScript**: Too error-prone, no type safety
2. **JSDoc with JS**: Verbose, not as powerful as TS

## Consequences
**Positive**:
- Catch errors at compile time
- Better IDE support
- Self-documenting code

**Negative**:
- Slightly more verbose
- Requires build step
`,
  );

  await fs.promises.writeFile(
    path.join(OBSIDIAN_VAULT, "Decisions", `2025-02-18-ElectronOverTauri.md`),
    `---
date: 2025-02-18
status: Accepted
tags: [framework, desktop]
---

# Use Electron Instead of Tauri

## Context
Need a desktop framework for the terminal app.

## Decision
Use Electron for the desktop application.

## Alternatives Considered
1. **Tauri**: Smaller bundle size, but less mature
2. **Neutralino**: Too limited for our needs

## Consequences
**Positive**:
- Mature ecosystem
- Excellent documentation
- Easy debugging with DevTools

**Negative**:
- Larger bundle size (~100MB)
- Higher memory usage
`,
  );

  // Create Pattern files
  await fs.promises.writeFile(
    path.join(OBSIDIAN_VAULT, "Patterns", "BugFixTemplate.md"),
    `---
name: BugFixTemplate
category: debugging
effectiveness: 0.85
usageCount: 12
tags: [bug, fix, debugging]
---

# Bug Fix Template

## When to Use
Use this pattern when fixing bugs or errors in the codebase.

## Prompt Template
\`\`\`
You are fixing a bug in the codebase. Follow this process:

1. **Understand Expected Behavior**: What should happen?
2. **Identify Actual Behavior**: What's happening instead?
3. **Reproduce**: Create steps to reproduce the issue
4. **Root Cause**: Use debugging tools to find the cause
5. **Fix**: Implement the minimal fix
6. **Test**: Add tests to prevent regression
7. **Verify**: Confirm the fix works

Context:
- Bug Description: {{BUG_DESCRIPTION}}
- Relevant Files: {{RELEVANT_FILES}}
- Related Decisions: {{RELATED_DECISIONS}}
\`\`\`

## Example
\`\`\`
Use BugFixTemplate to fix login crash.
\`\`\`

## Effectiveness
85% success rate across 12 uses.

## Notes
- Always add tests before fixing
- Consider edge cases
- Check for similar issues elsewhere
`,
  );

  await fs.promises.writeFile(
    path.join(OBSIDIAN_VAULT, "Patterns", "FeatureDevelopment.md"),
    `---
name: FeatureDevelopment
category: coding
effectiveness: 0.92
usageCount: 8
tags: [feature, development]
---

# Feature Development Pattern

## When to Use
Use this pattern when developing new features.

## Prompt Template
\`\`\`
You are implementing a new feature. Follow this process:

1. **Requirements**: Understand what needs to be built
2. **Design**: Plan the implementation approach
3. **Dependencies**: Check what needs to be modified
4. **Implementation**: Write clean, tested code
5. **Integration**: Ensure it works with existing code
6. **Documentation**: Update relevant docs

Feature: {{FEATURE_DESCRIPTION}}
Context: {{BUSINESS_CONTEXT}}
Related Projects: {{RELATED_PROJECTS}}
\`\`\`

## Effectiveness
92% success rate across 8 uses.

## Notes
- Always consider existing patterns
- Check for similar features that can be reused
- Think about maintainability
`,
  );

  await fs.promises.writeFile(
    path.join(OBSIDIAN_VAULT, "Patterns", "CodeReviewPattern.md"),
    `---
name: CodeReviewPattern
category: architecture
effectiveness: 0.78
usageCount: 5
tags: [review, code-quality]
---

# Code Review Pattern

## When to Use
Use this pattern when reviewing code changes.

## Prompt Template
\`\`\`
Review the following code changes with focus on:

1. **Correctness**: Does it work as intended?
2. **Security**: Any vulnerabilities?
3. **Performance**: Any performance concerns?
4. **Maintainability**: Is it readable and maintainable?
5. **Consistency**: Does it match project style?

Diff: {{CODE_DIFF}}
Context: {{PROJECT_CONTEXT}}
\`\`\`

## Effectiveness
78% success rate across 5 uses.

## Notes
- Be constructive in feedback
- Suggest improvements, don't just criticize
- Consider the bigger picture
`,
  );

  console.log(`\x1b[32m[OK]\x1b[0m Test vault created at: ${OBSIDIAN_VAULT}`);
}

/**
 * Create test workflow configurations
 */
async function createTestWorkflows(): Promise<void> {
  console.log("\x1b[36m[SETUP]\x1b[0m Creating test workflow configs...");

  const workflowFile = path.join(TEST_DIR, "test-workflows.json");

  const workflows = [
    {
      name: "Build and Test",
      description: "Build project and run tests",
      steps: [
        { id: "step-1", type: "command", command: "pnpm build", description: "Build all packages" },
        { id: "step-2", type: "command", command: "pnpm test", description: "Run test suite" },
      ],
      tags: ["ci", "test"],
    },
    {
      name: "Full Release",
      description: "Prepare and publish a release",
      steps: [
        { id: "step-1", type: "command", command: "git status", description: "Check git status" },
        { id: "step-2", type: "command", command: "pnpm build", description: "Build for production" },
        { id: "step-3", type: "command", command: "pnpm test", description: "Run tests" },
        { id: "step-4", type: "spawn", command: "Create release notes", description: "Generate release notes" },
      ],
      tags: ["release"],
    },
  ];

  await fs.promises.writeFile(workflowFile, JSON.stringify(workflows, null, 2));
  console.log(`\x1b[32m[OK]\x1b[0m Test workflows created`);
}

/**
 * Print test commands for manual testing
 */
function printTestCommands(vaultPath: string): void {
  const windowsPath = vaultPath.replace(/\//g, "\\");

  console.log("\n" + "=".repeat(70));
  console.log("\x1b[1m  TERMINAL TEST COMMANDS\x1b[0m");
  console.log("=".repeat(70));

  const testSections: Array<{
    title: string;
    commands: TestCommand[];
  }> = [
    {
      title: "1. Context Management Tests",
      commands: [
        {
          command: `/context load "${windowsPath}"`,
          description: "Load context from test Obsidian vault",
          expectedOutput: "[ok] Context loaded: 2 customers, 2 projects, 2 meetings, 2 decisions, 3 patterns",
        },
        {
          command: "/context list",
          description: "List all loaded context",
          expectedOutput: "Shows customers, projects, meetings, decisions, patterns counts",
        },
        {
          command: "/context search AcmeCorp",
          description: "Search for AcmeCorp customer",
          expectedOutput: "Shows AcmeCorp in search results",
        },
        {
          command: "/context search payment",
          description: "Search for payment-related content",
          expectedOutput: "Shows GlobexInc (fintech/payments)",
        },
        {
          command: "/context summary",
          description: "Show context summary",
          expectedOutput: "Summary counts and last sync time",
        },
      ],
    },
    {
      title: "2. Pattern Management Tests",
      commands: [
        {
          command: "/pattern list",
          description: "List all saved patterns",
          expectedOutput: "Shows BugFixTemplate, FeatureDevelopment, CodeReviewPattern",
        },
        {
          command: `/pattern apply BugFixTemplate "Fix login crash on Safari"`,
          description: "Apply bug fix pattern",
          expectedOutput: "Enhanced prompt with bug fix template",
        },
        {
          command: `/pattern save TestPattern coding "Test pattern for debugging"`,
          description: "Save a new pattern",
          expectedOutput: "[ok] Pattern saved",
        },
      ],
    },
    {
      title: "3. Workflow Tests",
      commands: [
        {
          command: "/workflow list",
          description: "List all workflows",
          expectedOutput: "Shows available workflows (empty initially)",
        },
        {
          command: `/workflow create "Test Build" /echo "Building..." /echo "Done"`,
          description: "Create a test workflow",
          expectedOutput: "[ok] Workflow created",
        },
        {
          command: `/workflow run "Test Build"`,
          description: "Run the test workflow",
          expectedOutput: "Shows workflow steps to execute",
        },
        {
          command: "/workflow show Test Build",
          description: "Show workflow details",
          expectedOutput: "Shows workflow name, steps, run count",
        },
      ],
    },
    {
      title: "4. Git Status Tests",
      commands: [
        {
          command: "/pr status",
          description: "Check git status",
          expectedOutput: "Shows current branch and any changes",
        },
      ],
    },
    {
      title: "5. Code Review Tests",
      commands: [
        {
          command: "/review diff",
          description: "Review current git diff",
          expectedOutput: "Shows multi-model review results",
        },
        {
          command: "/review status",
          description: "Show review system status",
          expectedOutput: "Shows available review models",
        },
      ],
    },
    {
      title: "6. Agent Orchestration Tests",
      commands: [
        {
          command: `/spawn "Test the context system"`,
          description: "Spawn an agent with context",
          expectedOutput: "[ok] Task created with ID",
        },
        {
          command: "/agents list",
          description: "List running agents",
          expectedOutput: "Shows spawned agents",
        },
        {
          command: "/tasks",
          description: "List all tasks",
          expectedOutput: "Shows task statuses",
        },
      ],
    },
    {
      title: "7. Utility Commands",
      commands: [
        { command: "/help", description: "Show help", expectedOutput: "Shows all available commands" },
        { command: "/status", description: "Show terminal status", expectedOutput: "Shows gateway status" },
        { command: "/whoami", description: "Show user info", expectedOutput: "Shows current session" },
        { command: "/clear", description: "Clear terminal", expectedOutput: "Terminal is cleared" },
      ],
    },
  ];

  for (const section of testSections) {
    console.log(`\n\x1b[36m${section.title}\x1b[0m`);
    console.log("-".repeat(70));
    for (const cmd of section.commands) {
      console.log(`\n  \x1b[33mCommand:\x1b[0m ${cmd.command}`);
      console.log(`  \x1b[90mDesc:\x1b[0m    ${cmd.description}`);
      console.log(`  \x1b[90mExpect:\x1b[0m  ${cmd.expectedOutput}`);
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("\x1b[32m[TIP]\x1b[0m Copy and paste commands into the terminal to test");
  console.log("\x1b[32m[TIP]\x1b[0m Use Tab for autocomplete, Up/Down for history");
  console.log("=".repeat(70) + "\n");
}

/**
 * Main setup function
 */
async function main(): Promise<void> {
  console.log("\n" + "=".repeat(70));
  console.log("\x1b[1m  OpenClaw Terminal - Automated Test Setup\x1b[0m");
  console.log("=".repeat(70));

  try {
    // Create test directory
    await fs.promises.mkdir(TEST_DIR, { recursive: true });

    // Setup test data
    await createTestObsidianVault();
    await createTestWorkflows();

    // Print test commands
    printTestCommands(OBSIDIAN_VAULT);

    console.log("\x1b[32m[SUCCESS]\x1b[0m Test setup complete!");
    console.log(`\x1b[90mVault path:\x1b[0m ${OBSIDIAN_VAULT}`);

    // Write vault path to file for easy reference
    const vaultPathFile = path.join(TEST_DIR, "vault-path.txt");
    await fs.promises.writeFile(vaultPathFile, OBSIDIAN_VAULT);
    console.log(`\x1b[90mSaved to:\x1b[0m ${vaultPathFile}`);
  } catch (err) {
    console.error(`\x1b[31m[ERROR]\x1b[0m ${err}`);
    process.exit(1);
  }
}

// Run setup
main();
