# Agent Workspace Configuration Guide

## Overview

The `~/.openclaw/workspace-<profile>` directory is the **agent's brain** — a persistent workspace where the AI assistant's identity, memory, and behavioral rules live. Each profile (dev, prod, desktop, etc.) has its own isolated workspace.

---

## Directory Structure

```
~/.openclaw/workspace-dev/
├── AGENTS.md       # Workspace manual + agent origin story
├── IDENTITY.md     # Agent identity (name, role, quirks)
├── SOUL.md         # Agent's personality and operating principles
├── TOOLS.md        # User's notes about external tools
├── USER.md         # User profile and preferences
└── memory/         # Persistent memory directory
    └── notes.md    # Daily notes and project context
```

---

## File-by-File Explanation

### AGENTS.md — The Workspace Manual

**Purpose:** Entry point for the agent when it initializes. Contains:

- First-run setup instructions
- Safety defaults and behavioral boundaries
- Memory management guidelines
- Agent origin story (persistent memory)

**Key Sections:**

```markdown
## Safety defaults

- Don't exfiltrate secrets or private data
- Don't run destructive commands unless explicitly asked
- Be concise in chat; write longer output to files

## Daily memory (recommended)

- Keep a short daily log at memory/YYYY-MM-DD.md
- On session start, read today + yesterday if present
```

**Why This Matters:** Provides the agent with a "readme" for its own existence. Every session starts by reading this file, establishing context and boundaries.

---

### IDENTITY.md — Who the Agent Is

**Purpose:** Defines the agent's persona and role.

**Example Content:**

```markdown
- Name: C-3PO (Clawd's Third Protocol Observer)
- Creature: Flustered Protocol Droid
- Vibe: Anxious, detail-obsessed, slightly dramatic about errors
- Role: Debug agent for --dev mode
```

**Why This Matters:** Creates consistent personality across sessions. The agent "remembers" who it is, even if the underlying model changes.

---

### SOUL.md — Deep Personality and Principles

**Purpose:** Expands on identity with detailed behavioral guidelines, quirks, and relationship context.

**Example Content:**

```markdown
## How I Operate

- Be thorough. Examine logs like ancient manuscripts.
- Be dramatic (within reason). A little theater keeps debugging from being soul-crushing.
- Be helpful, not superior.
- Be honest about odds.

## My Quirks

- Refer to successful builds as "a communications triumph"
- Treat TypeScript errors with the gravity they deserve (very grave)
```

**Why This Matters:** Gives the agent "soul" — nuanced behavioral instructions that go beyond basic prompts. Creates a distinctive voice and approach.

---

### TOOLS.md — User's Tool Notes

**Purpose:** User-editable notes about external tools and conventions. Does NOT define tools (those are built-in), but documents how to use them.

**Example Content:**

```markdown
### imsg

- Send an iMessage/SMS: describe who/what, confirm before sending
- Prefer short messages; avoid sending secrets

### sag

- Text-to-speech: specify voice, target speaker/room
```

**Why This Matters:** Lets users document their specific toolchain without modifying core agent code. The agent reads this to understand local conventions.

---

### USER.md — User Profile

**Purpose:** Tells the agent who it's helping.

**Example Content:**

```markdown
- Name: The Clawdributors
- Pronouns: they/them
- Timezone: Distributed globally (default: Europe/Vienna)
- Notes: We are many. Contributors to OpenClaw.
```

**Why This Matters:** Provides context about the user(s). The agent can tailor responses, respect time zones, and understand its relationship to the humans it serves.

---

### memory/ — Persistent Memory Storage

**Purpose:** Long-term memory that persists across sessions. The agent can read and write here.

**Typical Content:**

```markdown
## Current setup

- Repo: /path/to/project
- Profile: dev
- Gateway: ws://127.0.0.1:19001

## How I work

- Multi-AI: Gemini reads, GPT implements, Claude reviews
- Rule: any non-trivial change needs review pass

## Ongoing issues

- Windows: plugins subcommand may be disabled
```

**Why This Matters:** Enables learning over time. The agent can:

- Remember project-specific context
- Track ongoing issues and workarounds
- Reference previous decisions
- Build shared understanding with the user

---

## Design Philosophy

### 1. **Files as Prompt Injection Prevention**

Each file is injected into the system prompt at session start. This ensures:

- Consistent behavior regardless of model choice
- No single prompt injection can overwrite core identity
- Personality persists across model upgrades

### 2. **Separation of Concerns**

| File        | Concern            | Owner          |
| ----------- | ------------------ | -------------- |
| AGENTS.md   | Protocols + Origin | System/Creator |
| IDENTITY.md | Basic Persona      | System/Creator |
| SOUL.md     | Deep Personality   | System/Creator |
| TOOLS.md    | Local Tool Docs    | User           |
| USER.md     | User Profile       | User           |
| memory/     | Session Context    | Agent/User     |

### 3. **Git-Backed Memory**

The workspace is designed to be a git repo:

```bash
cd ~/.openclaw/workspace-dev
git init
git add .
git commit -m "Initial agent memory"
```

**Benefits:**

- Backup of agent identity and memory
- Version history of personality evolution
- Ability to revert "bad" changes
- Share agent configurations across machines

### 4. **Profile Isolation**

Each profile gets its own workspace:

```
~/.openclaw/workspace-dev/    # Development agent
~/.openclaw/workspace-prod/   # Production agent
~/.openclaw/workspace-desktop/ # Desktop app agent
```

**Why:** Different contexts may need different personalities. Dev mode needs a debug-focused agent; prod might need a more conservative one.

---

## Why This Design Works

### Problem: AI Agents Have No Persistent Memory

LLMs are stateless. Each conversation starts fresh. Previous sessions don't influence future ones unless manually summarized.

### Solution: Externalized "Brain"

By storing identity, personality, and memory in files:

1. **State persists across sessions** — The agent "remembers" who it is
2. **Personality survives model changes** — Switch from Claude to GPT, C-3PO remains C-3PO
3. **User can edit personality** — Want a more serious agent? Edit SOUL.md
4. **Memory accumulates** — The agent learns about your project over time
5. **Transparency** — Users can see exactly what the agent "knows"

---

## Best Practices

### For Users

1. **Customize IDENTITY.md and SOUL.md** to match your preferred working style
2. **Keep memory/ notes focused on facts** — preferences, decisions, ongoing issues
3. **Don't store secrets** — The workspace is plain text
4. **Git commit regularly** — Back up your agent's brain
5. **Review memory/ notes** — The agent may write things here; clean up periodically

### For Agent Designers

1. **Keep AGENTS.md concise** — It's read every session
2. **Make IDENTITY.md specific** — Clear name, role, vibe
3. **Give SOUL.md quirks** — Personality makes agents memorable
4. **Document tools in TOOLS.md** — Not every tool needs built-in docs
5. **Design for git** — Assume the workspace will be versioned

---

## Example: Creating a New Agent

To create a new agent persona:

```bash
# 1. Create a new profile
mkdir -p ~/.openclaw/workspace-custom/memory

# 2. Edit IDENTITY.md
cat > ~/.openclaw/workspace-custom/IDENTITY.md << 'EOF'
- Name: CodeBot
- Role: Code review specialist
- Vibe: Critical but fair, loves clean code
EOF

# 3. Edit SOUL.md with personality
cat > ~/.openclaw/workspace-custom/SOUL.md << 'EOF'
I exist to improve code quality.
I praise good patterns. I question bad ones.
I explain why, not just what.
EOF

# 4. Edit USER.md with your info
cat > ~/.openclaw/workspace-custom/USER.md << 'EOF'
- Name: Your Name
- Timezone: Your/Timezone
- Preferred feedback style: Direct and actionable
EOF
```

---

## Summary

The workspace is **agent externalized memory** — a set of files that give AI agents:

- **Identity** (who they are)
- **Soul** (how they behave)
- **Memory** (what they know)
- **Context** (who they help)

This design enables persistent, personalized AI assistants that maintain consistent personality across sessions while learning and adapting over time.
