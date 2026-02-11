# Product Requirement Document (PRD)
# OpenClaw: The Invisible Desktop AI Companion

> *"It should be like your second brain. It sits there, watching you work, learning your habits. And when you're stuck, it doesn't just hand you a screwdriver—it hands you the screw, already turned."*

---

## 1. Vision (愿景)

### 1.1 What is OpenClaw?

**OpenClaw** is an **invisible AI companion** that lives on your desktop — a second brain that observes your work, learns your patterns, and anticipates your needs before you even ask. It is not a chatbot you summon; it is a presence that becomes part of your workflow.

> **Project Neuro** is the codename for OpenClaw's desktop AI evolution — the journey from messaging-based assistant to true "Ghost in the Machine."

### 1.2 The Core Philosophy

> **"Context is Air. Execution is Breath. Delight is Life."**

- **Context as Air** — Context flows around you constantly, invisible until needed. The agent maintains a rolling buffer of everything happening on your machine.
- **Execution as Breath** — Actions happen naturally. **Safe Mode by default, Flow Mode opt-in**. Trust is earned through reversible actions.
- **Delight is Life** — Speed is not a metric; it's a prerequisite. UI responds instantly, AI follows asynchronously.

### 1.3 The Moment

```
┌─────────────────────────────────────────────────────────┐
│                                                           │
│   A programmer, 2 AM, exhausted.                          │
│   Screen full of red errors.                             │
│                                                           │
│   They press a key.                                      │
│                                                           │
│   Boom. Problem solved.                                  │
│   They smile.                                             │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

This is the only moment that matters. Everything else is just plumbing.

---

## 2. The Experience (用户体验)

### 2.1 First Encounter

**Day 1**: You install OpenClaw. A minimal menu bar icon appears. No setup wizard, no complex permissions dance.

You open VS Code. You copy some JSON. In the corner of your screen, a small card floats up:

```
┌────────────────────────────┐
│  Formatted JSON              │
│  [Click to copy]             │
└────────────────────────────┘
```

You ignore it. It fades away.

You don't remember installing anything special. But days later, you realize: OpenClaw has been learning.

### 2.2 The Alt+Space Moment

You're working. You hit a wall. You press `Alt+Space` (or your chosen hotkey).

**Not "Loading..."**. Not "Thinking...". **Instant.**

```
┌─────────────────────────────────────────────────────────┐
│  I've been watching you struggle with this API for 20 min │
│                                                           │
│  The auth token is expired. Here's the fix:            │
│  → Regenerate token (click)                              │
│  → Show me where to change it (click)                   │
│                                                           │
│  [Or just tell me what to do next]                        │
└─────────────────────────────────────────────────────────┘
```

Not "What can I help you with?" — It already knows what you need.

### 2.3 The Invisible Assistant

- **Clipboard**: Copy an error → Floating card appears with analysis
- **Screen**: Copy a curl command → Shows formatted version with placeholders
- **Project context**: It knows your project structure because it watched you build it
- **Terminal**: It sees your test failures and suggests fixes before you ask

**No buttons to click. No menus to navigate.**

**It appears. It delivers. It disappears.**

---

## 3. OpenClaw Foundation (Built, Not Imagined)

### 3.1 What Already Exists

OpenClaw is **not vaporware**. It is a production-ready system with:

- **Gateway Architecture**: Single daemon managing all AI operations via WebSocket protocol
- **Multi-Platform Desktop Apps**: Native macOS companion app (menu bar + gateway broker), Windows desktop app (in development)
- **Embedded Agent Runtime**: pi-mono-based embedded agent with tool execution
- **Workspace Context**: Automatic injection of project files (AGENTS.md, TOOLS.md, etc.)
- **Node Capabilities**: macOS app exposes Canvas, Camera, Screen Recording, System commands
- **Session Management**: Persistent conversation history with compaction and pruning
- **Security**: Device pairing, local trust, exec approvals (allowlist with "Always Allow")

### 3.2 The Missing Pieces (Project Neuro)

What we're building:

| Component | Status | Path |
|-----------|--------|------|
| Rolling context buffer | 🚧 In Progress | Desktop app → Agent streaming |
| Predictive action engine | 📋 Planned | Pattern recognition over sessions |
| Undo-centric execution | ✅ Partial | Exec approvals + sandbox |
| Floating UI cards | 📋 Planned | Desktop app overlay layer |
| Alt+Space instant invoke | ✅ Complete | `openclaw://agent` deep links |
| Silent, invisible learning | 📋 Planned | Session pattern mining |

---

## 4. Architecture (The Ghost Layer)

### 4.1 System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Your Desktop Environment                │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ User typing in VS Code                                   │  │
│  │ Copying JSON from browser                               │  │
│  │ Running tests in terminal                                │  │
│  └───────────────────────────────────────────────────────────┘  │
│                         ↓                                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ OpenClaw Desktop App (macOS/Windows)                      │  │
│  │ • Menu bar / system tray presence                         │  │
│  │ • Rolling context capture (clipboard, active window)      │  │
│  │ • Floating card UI layer                                  │  │
│  │ • WebSocket client to Gateway                             │  │
│  └───────────────────────────────────────────────────────────┘  │
│                         ↓                                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ OpenClaw Gateway (Daemon)                                 │  │
│  │ • WebSocket server (ws://127.0.0.1:18789)                 │  │
│  │ • Agent runtime (embedded pi-mono)                        │  │
│  │ • Session management + memory                             │  │
│  │ • Tool execution (read, write, exec, browser)             │  │
│  └───────────────────────────────────────────────────────────┘  │
│                         ↓                                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Model Provider (Anthropic, OpenAI, local, etc.)           │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 The Rolling Context Buffer

**Key Principle**: Context is **streaming**, not static. OpenClaw doesn't "capture" context when summoned — it maintains a **rolling buffer** of everything happening.

```typescript
interface ContextStream {
  // Active window state
  activeWindow: {
    title: string;
    app: string;
    url?: string;
  };

  // Clipboard (last 30s, volatile, size-capped)
  // Privacy: Sensitive patterns are redacted before storage
  clipboardRing: Array<{
    content: string;      // Max 10KB per entry, redacted
    timestamp: number;
    type: 'text' | 'image' | 'file';
    redacted: boolean;    // True if sensitive content detected
  }>;

  // Recent terminal output (via watching, last 100 lines)
  terminalOutput: string[];

  // File system events in workspace root (last 100 events)
  fileEvents: Array<{
    path: string;
    action: 'created' | 'modified' | 'deleted';
    timestamp: number;
  }>;

  // Active editor state (VS Code, Cursor, etc.)
  editorState?: {
    file: string;
    selection: string;
    diagnostics: Diagnostic[];
  };
}

// Privacy: Patterns that trigger redaction
const SENSITIVE_PATTERNS = [
  /api[_-]?key/i,
  /password/i,
  /secret/i,
  /token/i,
  /bearer/i,
  /sk-[a-zA-Z0-9]{32,}/,  // OpenAI keys
  /ghp_[a-zA-Z0-9]{36,}/,  // GitHub tokens
];
```

**Privacy & Performance Guarantees**:
- All buffer data is **volatile** (memory-only, never written to disk)
- Clipboard content is **redacted** for sensitive patterns
- Size caps: 10KB per clipboard entry, 100 terminal lines, 100 file events
- Buffer clears on app exit (no persistence)

### 4.3 The Prediction Engine

```
Trigger Threshold: User pauses for > 2s with clipboard containing pattern
                  ↓
┌───────────────────────────────────────────────────────────┐
│  Pattern Recognition:                                       │
│  │ • User has been debugging for 45 min                   │
│  │ • Same error occurred 3 times last week                 │
│  │ • Project uses TypeScript, strict mode                │
│  │ • User prefers auto-fix over manual explanation        │
│  └───────────────────────────────────────────────────────────┘
                  ↓
┌───────────────────────────────────────────────────────────┐
│  Predictive Action:                                        │
│  │ • Don't ask. Don't explain. Just show the diff.        │
│  │ • One-click to apply, one-click to dismiss.            │
│  └───────────────────────────────────────────────────────────┘
```

**Technical Implementation (Phase 3)**:

The prediction engine requires a **Behavioral Context Store** that sits alongside sessions:

```typescript
// Storage: ~/.openclaw/behavioral.db (SQLite)
interface BehaviorEvent {
  id: string;
  timestamp: number;
  type: 'clipboard' | 'error' | 'file_edit' | 'command_run' | 'suggestion';
  pattern: string;        // Hashed pattern for matching
  context: {              // Capture context at event time
    workspace: string;
    file?: string;
    app?: string;
  };
  userAction?: 'accept' | 'dismiss' | 'modify' | 'ignore';
  confidence?: number;    // ML model confidence (0-1)
}

// Query interface
interface PredictionEngine {
  // Find similar past events
  findSimilar(pattern: string, context: Context): BehaviorEvent[];

  // Get user preference for this pattern
  getUserPreference(pattern: string): 'auto_apply' | 'suggest' | 'ignore';

  // Record user feedback
  recordFeedback(eventId: string, action: string): void;
}
```

**Data Retention Policy**:
- Events retained for 30 days
- Aggregate preferences (patterns → actions) retained indefinitely
- User can export/delete behavioral data at any time

### 4.4 Execution Modes: Safe vs Flow

To resolve the "Trust by Default" tension with security, OpenClaw offers two distinct modes:

| Mode | Description | Use Case | Write Behavior |
|------|-------------|----------|----------------|
| **Safe Mode** (default) | Every write/action requires confirmation | New users, sensitive projects | Always prompt, show diff |
| **Flow Mode** (opt-in) | Allowlist actions execute automatically | Trusted workflows, repetitive tasks | Auto-apply allowlisted actions |

Users enter Flow Mode by explicitly adding commands to the allowlist via the "Always Allow" approval prompt.

### 4.5 Execution: Revertible by Design

| Action Type | Behavior | Fallback |
|-------------|----------|----------|
| **Read anything** | Silent, invisible | N/A |
| **Write temp files** | Silent, invisible | Auto-cleanup after 1h |
| **Write project files** | Apply to temp, show **live diff**, auto-apply after 10s | Undo in 1 click |
| **Run shell command** | Run in sandbox, show output, auto-confirm safe commands | Virtual terminal replay |
| **Delete files** | Move to holding area, auto-delete after 5min unless cancelled | 1-click restore |

**Existing OpenClaw Features**:
- ✅ `exec` tool with allowlist-based approvals
- ✅ `fs_read` / `fs_write` tools with workspace boundary checks
- ✅ Session history for undo/reference
- 🚧 Live diff preview for file edits (in progress)

---

## 5. The Interface (Organic, Not Mechanical)

### 5.1 No "States", Just "Pulse"

```
Traditional Agent:
[Loading...] → [Thinking...] → [Approving...] → [Running...]

OpenClaw:
• A subtle glow when active
• A "breathing" animation when processing
• Results fade in, they don't "appear"
```

### 5.2 The Spotlight (Instant Context)

```
┌─────────────────────────────────────────────────────────┐
│                                                           │
│                    I see you're stuck on:               │
│                    [No route found for /api/users]     │
│                                                           │
│                    In your Express app, line 42:          │
│                    The route is defined in              │
│                    `routes/api.ts` but the file has      │
│                    been moved to `routes/users.ts`       │
│                                                           │
│                    [Fix it now]     [Explain more]         │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

**No search bar. No "Type your question."** It already knows.

### 5.3 The Corner Card

```
┌──────────────────────┐
│  📋 Pasted JSON       │
│  ──────────────────  │
│  {                   │
│    "user": "..."    │
│  }                   │
│  ──────────────────  │
│  [Formatted] [Raw]    │
└──────────────────────┘
```

- Appears 2s after paste
- Auto-formats based on project conventions
- One click copies to clipboard
- Fades after 10s or user clicks away

### 5.4 Desktop Integration Points

| Platform | Entry Points | Floating UI | Status |
|----------|--------------|-------------|--------|
| **macOS** | Menu bar app, Alt+Space, `openclaw://agent` deep links | NSPanel (native) | ✅ Complete |
| **Windows** | System tray, hotkey, desktop app | Win32 overlay layer | 🚧 In Progress |
| **Linux** | CLI only | N/A | 📋 Future |
| **CLI** | `openclaw agent --message "..."` | N/A | ✅ Complete |
| **Web** | WebChat UI | Toast notifications | ✅ Complete |

**MVP Scope**: Floating cards target macOS + Windows only. Linux users get CLI-only experience.

---

## 6. The Learning Curve (Invisible)

### 6.1 Day 1: Invisible

- OpenClaw installs via npm or desktop installer
- Desktop app starts silently (menu bar / system tray icon)
- Gateway starts automatically (launchd / Windows service)
- Observes without interfering

### 6.2 Day 7: Helpful

- Starts recognizing common patterns
- Offers unobtrusive suggestions via floating cards
- Learns which suggestions you accept, which you dismiss
- Builds profile of your preferences

### 6.3 Day 30: Integrated

- Knows your project structure deeply
- Anticipates your next move based on historical patterns
- Becomes genuinely useful — the moment you say "Wow"

---

## 7. Technical Foundation

### 7.1 Built With OpenClaw

```bash
# Install
npm install -g openclaw@latest

# Onboarding (one-time)
openclaw onboard

# Start gateway (happens automatically on desktop)
openclaw gateway

# Talk to the assistant
openclaw agent --message "Hello"

# Deep link from desktop app
open 'openclaw://agent?message=Help%20me%20debug'
```

### 7.2 Configuration (Minimal)

```json5
// ~/.openclaw/openclaw.json
{
  gateway: {
    mode: "local",  // or "remote" for SSH/Tailscale
    bind: { host: "127.0.0.1", port: 18789 },
    auth: { token: "auto-generated" }
  },
  agents: {
    defaults: {
      workspace: "/Users/you/projects",
      model: "anthropic/claude-sonnet-4-20250514",
      sandbox: false
    }
  },
  tools: {
    exec: {
      approvals: "allowlist",  // or "ask" or "deny"
      allowlist: ["/usr/bin/git", "/opt/homebrew/bin/node"]
    }
  }
}
```

### 7.3 Workspace Bootstrap

OpenClaw automatically injects these files into context:

- `AGENTS.md` — Operating instructions + "memory"
- `SOUL.md` — Persona, boundaries, tone
- `TOOLS.md` — User-maintained tool notes
- `IDENTITY.md` — Agent name/vibe/emoji
- `USER.md` — User profile + preferred address
- `BOOTSTRAP.md` — One-time first-run ritual

### 7.4 Tech Stack

| Layer | Technology | Why |
|-------|------------|-----|
| Desktop wrapper (macOS) | SwiftUI | Native performance, TCC integration |
| Desktop wrapper (Windows) | React Native + WebView | Cross-platform consistency |
| Runtime | Node.js 22+ | Consistent with OpenClaw CLI/Gateway |
| Gateway | TypeScript + Express | WebSocket protocol, tool routing |
| Agent | pi-mono embedded | Proven AI agent runtime |
| LLM | Provider-agnostic | Anthropic, OpenAI, Ollama, etc. |

---

## 8. The Metrics (That Actually Matter)

### 8.1 Time to First Delight

**Definition**: From installation to the first moment the user says "Wow."

**Target**: < 7 days (because true learning takes time)

**Path**: Install → Silent observation → First helpful suggestion

### 8.2 Invisible Latency

**Definition**: Time from user intent to visible response.

**Breakdown**:
| Layer | Target | Status |
|-------|--------|--------|
| UI Response (card appears, skeleton loads) | < 100ms | ✅ Achieved |
| WebSocket round-trip | < 50ms | ✅ Achieved (~50-100ms) |
| LLM first token (Claude Sonnet) | 500-2000ms | ⚠️ External dependency |
| **Total (AI response)** | < 2500ms | 🚧 In progress |

**Strategy**:
- UI shows immediate feedback (pulse, skeleton) within 100ms
- AI content streams in asynchronously
- For local operations (JSON format, file reads): < 200ms total

### 8.3 Voluntary Usage

**Definition**: % of OpenClaw suggestions that user accepts.

**Target**: > 60% (if it's lower, we're being annoying)

---

## 9. Implementation Roadmap (Story-Driven)

### Phase 1: Foundation Exists ✅

**Complete**:
- [x] Gateway with WebSocket protocol
- [x] Embedded agent runtime (pi-mono)
- [x] macOS desktop app with menu bar
- [x] Windows desktop app (basic)
- [x] Workspace context injection
- [x] Session management
- [x] Tool execution (read, write, exec, browser)
- [x] Device pairing + security
- [x] Deep links (`openclaw://agent`)

### Phase 2: The Ghost Layer (In Progress) 🚧

**Desktop MVP Slim Branch**:
- [ ] Security hardening (auth, exec approvals, fs_read boundaries)
- [ ] Rolling context buffer (clipboard + active window)
- [ ] Floating card UI layer
- [ ] Alt+Space instant invoke on all platforms
- [ ] Silent, tokenless auth for local desktop

### Phase 3: Learning to Watch (Planned) 📋

**Prerequisite**: Complete Behavioral Context Store TDD

- [ ] Behavioral Context Store (SQLite schema, migration path)
- [ ] Pattern recognition engine (event → pattern matching)
- [ ] Project context deepening (.git root watching)
- [ ] Terminal output monitoring (pty integration)
- [ ] File system event watching (chokidar integration)
- [ ] User preference learning (accept/dismiss tracking)

### Phase 4: Reading Minds (Planned) 📋

**Prerequisite**: Phase 3 complete + 30 days of aggregated data

- [ ] Multi-app coordination (VS Code + Browser + Terminal)
- [ ] The "I knew you were going to do that" feature
- [ ] Predictive suggestions (ML model or heuristics)
- [ ] Auto-apply with 1-click undo
- [ ] Flow Mode (graduated from Safe Mode)

**Technical Design Documents Required**:
- Before Phase 3: `docs/prd/behavioral-context-store.md` — Data model, privacy, storage
- Before Phase 4: `docs/prd/prediction-engine.md` — ML vs heuristics, evaluation metrics

---

## 10. For the Developers (The Real PRD)

### 10.1 User Stories

> **As a深夜调试的程序员**
> I want OpenClaw to notice I'm stuck on the same error for the third time
> So it can just show me the solution without me asking

> **As a复制JSON的开发者**
> I want OpenClaw to silently format it in the background
> So I can just paste it where I need it

> **As a忘记API key的开发者**
> I want OpenClaw to remind me of the config file location
> Because it watched me set it up 3 weeks ago

### 10.2 Non-Functional Requirements

| Requirement | Why It Matters | Target | Status |
|-------------|----------------|--------|--------|
| **UI Response < 100ms** | Below human perception threshold | < 100ms | ✅ Achieved |
| **AI First Token < 2s** | User doesn't abandon flow | < 2000ms | 🚧 Optimizing |
| **Memory Budget** | Users won't tolerate resource hogs | < 200MB idle | 🚧 See breakdown |
| **No config required** | If it needs setup, 90% won't use it | Sensible defaults | ✅ Achieved |
| **Privacy-first** | All context stays local | Local-only by default | ✅ Enforced |

**Memory Budget Breakdown**:
| Component | Target | Notes |
|-----------|--------|-------|
| Desktop App (UI) | 80MB | SwiftUI / React Native |
| Gateway Daemon | 60MB | Node.js + Express |
| Rolling Context Buffer | 30MB | Size-capped, volatile |
| Agent Runtime | 30MB | pi-mono embedded |
| **Total** | **< 200MB** | Measured at idle |

### 10.3 Security Considerations

From the Desktop MVP Slim branch lessons learned:

1. **Local requests are not automatically trusted** — Use loopback IP verification, not spoofable headers
2. **Tool execution must be sandboxed** — `exec` uses allowlist with "Always Allow" persistence
3. **File reads must be bounded** — Prevent symlink escapes, cap bytes, keep output ASCII
4. **Logging must be metadata-only** — Never log message content, only lengths/ids

### 10.4 Offline Capabilities

| Feature | Online Required | Fallback |
|---------|-----------------|----------|
| Context capture (clipboard, files) | No | Works fully offline |
| Pattern matching (local) | No | Uses local behavioral.db |
| AI suggestions | Yes | Queue for later, show "waiting for connection" |
| File operations | No | Works fully offline |

**Strategy**: The "Ghost" (context capture, pattern recognition) works offline. The "Brain" (AI) requires connectivity but gracefully degrades.

### 10.5 Multi-Device Sync

Behavioral preferences sync across user devices via the gateway:

```
┌─────────────────┐     sync      ┌─────────────────┐
│   Mac (home)    │ ───────────→  │   Windows (work)│
│  learned:       │               │  inherits:      │
│  • JSON format  │   preferences  • JSON format    │
│  • npm patterns │               • npm patterns   │
└─────────────────┘               └─────────────────┘
        ↓                                 ↓
   Shared Gateway (remote mode or self-hosted)
```

**Implementation**: Preferences stored in `~/.openclaw/behavioral.db`, synced via:
- Option A: User's self-hosted gateway (recommended)
- Option B: Encrypted cloud storage (opt-in, future)

### 10.6 Graduated Rollout

To avoid overwhelming users with "sudden AI intelligence":

| Phase | Trigger | Capabilities Enabled |
|-------|---------|---------------------|
| **Silent** | Day 0-1 | Observation only, no UI |
| **Hint** | Day 2-7 | Small corner cards for obvious patterns (JSON format) |
| **Helpful** | Day 8-30 | Context-aware suggestions, user can dismiss |
| **Integrated** | Day 30+ | Full prediction, Flow Mode available |

Users can accelerate or pause this progression in settings.

---

## 11. The Closing Argument

**Why this matters:**

Because the future of AI assistants isn't better chatbots.

The future is **AI that becomes invisible**. AI that doesn't need to be summoned because it's already there. AI that doesn't ask for permissions because it earns trust through action.

**OpenClaw is not an app you use. It's an app that uses you.**

Or rather — it's an app that **watches** you use yourself, and gently, occasionally, invisibly... helps.

---

## 12. Links & References

- **Repository**: https://github.com/openclaw/openclaw
- **Documentation**: https://docs.openclaw.ai
- **Architecture**: [Gateway Architecture](/concepts/architecture)
- **Context**: [Context System](/concepts/context)
- **Agent Runtime**: [Agent Runtime](/concepts/agent)
- **macOS App**: [macOS Companion](/platforms/macos)
- **Session Management**: [Sessions](/concepts/sessions)

---

*"The best technology is invisible. It just works."*

— Someone who knew what they were talking about
