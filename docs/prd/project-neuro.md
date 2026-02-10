# Product Requirement Document (PRD)
# Project Neuro - The Ghost in the Machine

> *"It should be like your second brain. It sits there, watching you work, learning your habits. And when you're stuck, it doesn't just hand you a screwdriver—it hands you the screw, already turned."*

---

## 1. The Soul (灵魂)

### 1.1 What is Project Neuro?

**Project Neuro** is not a "Desktop Agent." It is **the Ghost in the Machine** — an invisible second brain that lives in your OS, observes your work, learns your patterns, and anticipates your needs before you even ask.

### 1.2 The Core Philosophy

> **"Context is Air. Execution is Breath. Delight is Life."**

- **Context as Air** — It doesn't "inject" context. Context flows around you constantly, invisible until needed.
- **Execution as Breath** — Actions happen naturally, like breathing. No permissions, no approvals. Just do it, and let user undo if needed.
- **Delight as Life** — Speed is not a metric; it's a prerequisite. If it doesn't feel instant, it's broken.

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

**Day 1**: You install Neuro. Nothing happens. No setup wizard, no "grant permissions." It just... sits there.

You open VS Code. You copy some JSON. In the corner of your screen, a small card floats up:

```
┌────────────────────────────┐
│  Formatted JSON              │
│  [Click to copy]             │
└────────────────────────────┘
```

You ignore it. It fades away.

You don't remember installing anything. But days later, you realize: Neuro has been learning.

### 2.2 The Alt+Space Moment

You're working. You hit a wall. You press `Alt+Space`.

**Not "Loading..."**. Not "Thinking...".

**Instant.**

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

**No buttons to click. No menus to navigate.**

**It appears. It delivers. It disappears.**

---

## 3. The Architecture (Invisible)

### 3.1 The Ghost Layer (Context as Air)

```
┌─────────────────────────────────────────────────────────────┐
│                      The OS Environment                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ User typing in VS Code                                   │  │
│  │ Copying JSON from browser                               │  │
│  │ Running tests in terminal                                │  │
│  └───────────────────────────────────────────────────────────┘  │
│                         ↓                                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Neuro Context Stream (always flowing, never stored)      │  │
│  │ • Active window state                                    │  │
│  │ • Clipboard content (last 30s)                          │  │
│  │ • Recent terminal output                                │  │
│  │ • File system events in cwd                              │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Key Principle**: Context is **streaming**, not static. Neuro doesn't "capture" context when summoned — it maintains a **rolling buffer** of everything happening on your machine.

### 3.2 The Brain Layer (Anticipation)

```
Trigger Threshold: User pauses for > 2s with clipboard containing pattern
                  ↓
┌───────────────────────────────────────────────────────────┐
│  Neuro Brain:                                               │
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

### 3.3 The Hand Layer (Execution with Undo)

**The New Permission Model: "Trust by Default, Revertible by Design"**

| Action Type | Behavior | Fallback |
|-------------|----------|----------|
| **Read anything** | Silent, invisible | N/A |
| **Write temp files** | Silent, invisible | Auto-cleanup after 1h |
| **Write project files** | Apply to temp, show **live diff**, user clicks or it auto-applies after 10s | Undo in 1 click |
| **Run shell command** | Run in sandbox, show output, auto-confirm safe commands | Virtual terminal replay |
| **Delete files** | Move to holding area, auto-delete after 5min unless cancelled | 1-click restore |

**Key Principle**: The question is not "Can I do this?" but "Did I do this right?"

---

## 4. The Interface (Organic, Not Mechanical)

### 4.1 No "States", Just "Pulse"

```
Traditional Agent:
[Loading...] → [Thinking...] → [Approving...] → [Running...]

Neuro:
• A subtle glow when active
• A "breathing" animation when processing
• Results fade in, they don't "appear"
```

### 4.2 The Spotlight

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

### 4.3 The Corner Card

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

---

## 5. The Learning Curve (Invisible)

### 5.1 Day 1: Invisible

- Neuro installs silently
- Observes without interfering
- Builds baseline of your patterns

### 5.2 Day 7: Helpful

- Starts recognizing common patterns
- Offers unobtrusive suggestions
- Learns which suggestions you accept, which you dismiss

### 5.3 Day 30: Integrated

- Knows your project structure
- Anticipates your next move
- Becomes genuinely useful

---

## 6. Technical Foundation

### 6.1 The Rolling Context Buffer

```python
class ContextStream:
    """Maintains a rolling window of system context."""

    WINDOW_SIZE = 30  # seconds

    def __init__(self):
        self.screen_state = {}   # Current window, selection
        self.clipboard_ring = []  # Last N clipboard items
        self.terminal_output = [] # Recent terminal lines
        self.file_events = []     # Recent file changes

    def tick(self):
        """Called every 100ms. Updates all buffers."""
        # Non-blocking. Always flowing.
        pass
```

### 6.2 The Prediction Engine

```python
class Predictor:
    """Predicts user intent from context patterns."""

    def predict(self, context: ContextStream) -> PredictedAction:
        """
        Analyze context stream and return:
        - action: What the user likely needs
        - confidence: How sure we are
        - timing: When to show it
        """
        # If user paused for 2s + has error in clipboard → Offer help
        # If user copied code + is in test file → Offer to run tests
        # If user opened file + scrolled to bottom → Offer to add function
```

### 6.3 The Sandbox Executor

```python
class SandboxExecutor:
    """Execute actions in reversible ways."""

    def write_file(self, path: str, content: str):
        """Write to temp, show diff, apply or revert on user action."""
        # 1. Write to temp location
        # 2. Show live diff to user
        # 3. Auto-apply after 10s OR user clicks
        # 4. Keep 1-click undo for 5 minutes
        pass
```

---

## 7. The Metrics (That Actually Matter)

### 7.1 Time to First Delight

**Definition**: From installation to the first moment the user says "Wow."

**Target**: < 7 days (because true learning takes time)

### 7.2 Invisible Latency

**Definition**: Time from user intent to visible response.

**Target**: < 200ms (feels instant)

### 7.3 Voluntary Usage

**Definition**: % of Neuro suggestions that user accepts.

**Target**: > 60% (if it's lower, we're being annoying)

---

## 8. Implementation Roadmap (Story-Driven)

### Sprint 1: The Ghost Appears (Week 1-2)
- [ ] Silent installer
- [ ] Rolling context buffer (screen + clipboard only)
- [ ] First predictive action: JSON formatter card
- ] ] ] Alt+Space with context-aware suggestions

### Sprint 2: Learning to Watch (Week 3-4)
- [ ] Pattern recognition engine
- [ ] Project context detection (.git root)
- [ ] Sandbox executor with undo
- [ ] Memory: remembers user preferences

### Sprint 3: Reading Minds (Week 5-6)
- [ ] Terminal output monitoring
- [ ] File system event watching
- [ ] Multi-app coordination (VS Code + Browser + Terminal)
- [ ] The "I knew you were going to do that" feature

---

## 9. For the Developers (The Real PRD)

### 9.1 User Stories

> **As a深夜调试的程序员**
> I want Neuro to notice I'm stuck on the same error for the third time
> So it can just show me the solution without me asking

> **As a复制JSON的开发者**
> I want Neuro to silently format it in the background
> So I can just paste it where I need it

> **As a忘记API key的开发者**
> I want Neuro to remind me of the config file location
> Because it watched me set it up 3 weeks ago

### 9.2 Non-Functional Requirements

| Requirement | Why It Matters |
|-------------|-----------------|
| **Latency < 200ms** | Below human perception threshold |
| **Memory < 150MB idle** | Users won't tolerate resource hogs |
| **No configuration file** | If it needs setup, 90% won't use it |
| **Privacy-first** | All context stays local, period |

### 9.3 Technical Stack

| Layer | Technology | Why |
|-------|------------|-----|
| Desktop wrapper | Tauri (Rust) | Small, fast, no Electron bloat |
| Runtime | Python 3.11+ | For ML/AI libraries |
| OCR | Apple Vision / Tesseract | Native APIs where possible |
| Vector DB | SQLite-VSS | Embedded, no separate server |
| LLM | Local-first with cloud fallback | LiteLLM API |

---

## 10. The Closing Argument

**Why this matters:**

Because the future of AI assistants isn't better chatbots.

The future is **AI that becomes invisible**. AI that doesn't need to be summoned because it's already there. AI that doesn't ask for permissions because it earns trust through action.

**Neuro is not an app you use. It's an app that uses you.**

Or rather — it's an app that **watches** you use yourself, and gently, occasionally, invisibly... helps.

---

*"The best technology is invisible. It just works."*

— Someone who knew what they were talking about
