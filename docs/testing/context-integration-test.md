# Context Integration Test Plan

## Test Environment
- OpenClaw Windows App
- Terminal with Ctrl+Shift+T

## Test Setup

### 1. Create Test Context Data

Create a test Obsidian vault or add test data to `.openclaw/business-context.json`:

```json
{
  "customers": [
    {
      "id": "test-customer-1",
      "name": "Acme Corp",
      "notes": "Enterprise client, prefers TypeScript",
      "email": "tech@acme.com",
      "tags": ["enterprise", "typescript"],
      "sourceFile": "test"
    }
  ],
  "projects": [
    {
      "id": "test-project-1",
      "name": "E-commerce Platform",
      "description": "Multi-vendor marketplace",
      "customer": "Acme Corp",
      "status": "active",
      "tags": ["ecommerce", "marketplace"],
      "sourceFile": "test"
    }
  ],
  "decisions": [
    {
      "id": "test-decision-1",
      "date": "2025-02-25T00:00:00.000Z",
      "title": "Use PostgreSQL for primary database",
      "context": "Scalability requirements",
      "decision": "Use PostgreSQL with read replicas",
      "consequences": ["Better query performance", "Requires migration"],
      "status": "accepted",
      "sourceFile": "test"
    }
  ],
  "meetings": [],
  "patterns": [],
  "lastSyncAt": 1740456000000
}
```

## Test Cases

### TC1: Context Summary Display
**Command:** `/context summary`

**Expected Output:**
```
Context Summary
Customers: 1
Projects: 1
Meetings: 0
Decisions: 1
Patterns: 0
Last Sync: 2025-02-25T...
```

### TC2: Context List Display
**Command:** `/context list`

**Expected Output:**
```
Loaded Context
👤 Customers: 1
📁 Projects: 1
🔀 Decisions: 1
```

### TC3: Context Search
**Command:** `/context search Acme`

**Expected Output:**
```
Search Results: "Acme"
👤 Customers
  • Acme Corp (10)

📁 Projects
  • E-commerce Platform (4)
```

### TC4: Spawn with Context
**Command:** `/spawn Add user authentication for Acme Corp`

**Expected Behavior:**
1. Shows "Searching for relevant context..."
2. Displays matched customers/projects
3. Shows "Context will be injected into agent prompt"
4. Task created includes context summary

**Expected Output Snippet:**
```
[spawn] Creating Task
Description: Add user authentication for Acme Corp
[context] Searching for relevant context...
  👤 Customers:
     - Acme Corp
  📁 Projects:
     - E-commerce Platform
  Context will be injected into agent prompt
✓ Task task-xxx created
Context: 1 customer(s), 1 project(s)
```

### TC5: Spawn without Context
**Command:** `/spawn Fix login bug --no-context`

**Expected Behavior:**
- No context search performed
- No context displayed
- Task created normally

### TC6: Context Clear
**Command:** `/context clear` followed by `/context summary`

**Expected Output:**
```
[ok] Context cache cleared
Context Summary
Customers: 0
Projects: 0
...
```

## Manual Verification Checklist

- [ ] `/context summary` shows correct counts
- [ ] `/context list` displays items correctly
- [ ] `/context search <query>` finds matching items
- [ ] `/spawn` with context keywords shows relevant context
- [ ] `/spawn --no-context` skips context search
- [ ] `/context clear` clears cached context
- [ ] Sidebar Context panel updates after context load

## Automation Notes

To automate these tests, the app would need:
1. Headless mode for terminal commands
2. IPC event mocking for context operations
3. File system fixture for test context data

## Known Limitations

1. **Obsidian Sync**: The current `context load` implementation is a placeholder. Full Obsidian vault parsing is implemented in `src/orchestration/obsidian-sync.ts` but not yet wired to the IPC handler.

2. **Context Injection**: Context is searched and displayed, but actual injection into agent prompts requires integration with the agent spawning mechanism in the backend.

3. **VS Code Auto-open**: The `--no-code` flag works, but VS Code detection could be improved.

## Next Steps for Full Implementation

1. Wire up `obsidian-sync.ts` to the IPC handler
2. Implement actual prompt building with context injection
3. Add context to the agent's system prompt
4. Test end-to-end with real agents
