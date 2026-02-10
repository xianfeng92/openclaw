# Product Requirement Document (PRD)
# Project Neuro - Desktop AI Agent with Context Awareness

| Version | Date | Status |
|---------|------|--------|
| 1.0 | 2026-02-10 | Draft |

---

## 1. Product Overview

### 1.1 Vision

Project Neuro is a **local-first, desktop AI agent** with real-time context awareness. Unlike traditional chat-based AI assistants, Neuro operates at the OS level, understanding user intent through screen content, clipboard patterns, and project context—then executing actions through a secure permission model.

### 1.2 Core Philosophy

> **"Context is King, Execution is Queen."**

### 1.3 North Star Metric

**TTC-60** (Time To Completion < 60 seconds) — From user intent to task completion.

---

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      User Interface Layer                    │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐    │
│  │ Spotlight   │  │ Chat Window  │  │ Intent Pills   │    │
│  │ Launcher    │  │              │  │ (Tray)         │    │
│  └─────────────┘  └──────────────┘  └─────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│                    Decision Layer (LLM Brain)               │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐    │
│  │ Intent      │  │ Task         │  │ Security        │    │
│  │ Recognition │  │ Planning     │  │ Auditor         │    │
│  └─────────────┘  └──────────────┘  └─────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│                  Perception Layer (Context Manager)          │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐    │
│  │ Screen      │  │ Clipboard    │  │ Vector Memory   │    │
│  │ Capture     │  │ Watcher      │  │ (RAG)           │    │
│  └─────────────┘  └──────────────┘  └─────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│                   Execution Layer (OpenClaw Engine)          │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐    │
│  │ File System │  │ Shell/Process│  │ Browser/Screen  │    │
│  │ Tools       │  │ Tools        │  │ Automation      │    │
│  └─────────────┘  └──────────────┘  └─────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Technology Stack

| Layer | Technology |
|-------|------------|
| **Desktop Framework** | Electron (Tauri as alternative) |
| **Backend Runtime** | Python 3.11+ / FastAPI |
| **LLM Integration** | LiteLLM / LangChain |
| **Vector Database** | ChromaDB / SQLite-VSS |
| **OCR/Vision** | Tesseract / Apple Vision Framework |
| **Window Detection** | pygetwindow / Quartz (macOS) |
| **GUI Automation** | PyAutoGUI / Playwright |

---

## 3. Core Modules

### 3.1 Context Manager Module

**Purpose**: Transform unstructured environment data into structured context objects for LLM consumption.

#### 3.1.1 Visual Context Injection

**Requirements**:
- Detect active window (app name, window title)
- Extract selected text via accessibility APIs
- Fallback to screenshot + OCR when accessibility fails
- Privacy: detect and redact password fields, credit card numbers

**API Specification**:
```python
class ScreenContext(NamedTuple):
    app_name: str
    window_title: str
    selected_text: Optional[str]
    ocr_summary: Optional[str]
    timestamp: datetime

def capture_screen_context() -> ScreenContext:
    """Capture current screen context with privacy filtering."""
    pass
```

#### 3.1.2 Clipboard Watcher

**Requirements**:
- Monitor clipboard changes every 500ms
- Detect patterns and trigger proactive suggestions
- Pattern matching rules:

| Pattern | Action | Suggestion |
|---------|--------|------------|
| `{".*": ".*"}` | Format/Convert | "Detected JSON - Format or Convert?" |
| `Error.*Exception.*` | Debug/Analyze | "Error detected - Debug or Analyze?" |
| `curl.*` | Execute/Query | "curl command - Execute or Query?" |
| `https://.*zoom\.us` | Join/Calendar | "Meeting link - Join or Add to Calendar?" |

**API Specification**:
```python
from dataclasses import dataclass
from enum import Enum

class ContentType(Enum):
    TEXT = "text/plain"
    JSON = "application/json"
    ERROR_STACK = "error/stack"
    COMMAND = "command/shell"
    MEETING_LINK = "uri/meeting"

@dataclass
class ClipboardEvent:
    content: str
    content_type: ContentType
    timestamp: datetime
    suggestion: Optional[str] = None

class ClipboardWatcher:
    def __init__(self, callback: Callable[[ClipboardEvent], None]):
        pass

    def detect_content_type(self, content: str) -> ContentType:
        pass

    def start_watching(self):
        pass
```

#### 3.1.3 RAG Memory System

**Requirements**:
- Vector similarity search for project documentation
- Global user profile storage
- Auto-detect project root via `.git` directory
- Relevance scoring for memory retrieval

**API Specification**:
```python
@dataclass
class MemoryContext:
    relevant_docs: List[str]  # File paths or content snippets
    user_preferences: List[str]
    project_context: Optional[str]

class MemoryRetriever:
    def retrieve(self, query: str, project_root: str) -> MemoryContext:
        pass

    def store(self, key: str, value: str, category: str):
        pass
```

#### 3.1.4 Unified Context Schema

```python
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class ScreenInfo(BaseModel):
    app_name: str
    window_title: str
    selected_text: Optional[str] = None
    ocr_summary: Optional[str] = None

class ClipboardInfo(BaseModel):
    content_type: str
    preview: str
    full_content: Optional[str] = None

class MemoryInfo(BaseModel):
    relevant_docs: List[str] = []
    user_preferences: List[str] = []

class SystemInfo(BaseModel):
    os: str
    cwd: str
    timestamp: datetime

class NeuroContext(BaseModel):
    user_query: str
    screen: ScreenInfo
    clipboard: ClipboardInfo
    memory: MemoryInfo
    system: SystemInfo

    def to_llm_prompt(self) -> str:
        """Convert to LLM-friendly prompt format."""
        pass
```

### 3.2 Interaction Layer

#### 3.2.1 Spotlight Launcher

**Requirements**:
- Global hotkey: `Alt+Space` (configurable)
- Minimal input interface
- Context indicators in UI

**UI Specification**:
```
┌─────────────────────────────────────────┐
│  🔎 [Eye] [Brain]                       │
│  ┌─────────────────────────────────┐   │
│  │ What would you like to do?      │   │
│  └─────────────────────────────────┘   │
│  Context: VS Code | ProjectNeuro       │
└─────────────────────────────────────────┘
```

#### 3.2.2 Adaptive Chat Interface

**Requirements**:
- Dark mode, spacious design
- State visualization: Thinking → Approving → Running
- Diff view for file operations (Level 2 permissions)

### 3.3 Execution Engine

#### 3.3.1 Tool System

**Built-in Tools**:
```python
# tools/file_tool.py
@tool(level=PermissionLevel.SAFE)
def read_file(path: str, max_lines: int = 1000) -> str:
    """Read file contents with sandbox restrictions."""
    pass

@tool(level=PermissionLevel.CRITICAL)
def write_file(path: str, content: str, create_backup: bool = True) -> bool:
    """Write file with user confirmation and backup."""
    pass

# tools/shell_tool.py
@tool(level=PermissionLevel.CRITICAL, requires_approval=True)
def execute_command(command: str, cwd: Optional[str] = None) -> CommandResult:
    """Execute shell command with explicit approval."""
    pass

# tools/screen_tool.py
@tool(level=PermissionLevel.SENSITIVE)
def capture_screen(region: Optional[Rect] = None) -> Image:
    """Capture screen region for OCR/analysis."""
    pass
```

### 3.4 Security & Governance

#### 3.4.1 Permission Matrix

| Level | Description | Examples | Approval |
|-------|-------------|----------|----------|
| **Level 0: Safe** | Read-only, no side effects | Clipboard read, screen capture, search | None (Auto-approve) |
| **Level 1: Sensitive** | Read private data, write temp | Read non-sandbox files, write temp, GET requests | Toast notification |
| **Level 2: Critical** | Destructive operations | Overwrite files, delete, shell exec, POST requests | Modal + Diff view |

#### 3.4.2 Audit Log

**Location**: `~/.neuro/audit.log`

**Format**:
```json
{
  "timestamp": "2026-02-10T22:00:00Z",
  "level": 2,
  "action": "write_file",
  "params": {"path": "/path/to/file.py", "operation": "overwrite"},
  "user_intent": "Fix the bug in main function",
  "approved": true,
  "result": "success"
}
```

---

## 4. Development Specifications for AI Implementation

### 4.1 Project Structure

```
project_neuro/
├── src/
│   ├── context/
│   │   ├── screen.py          # Screen capture & OCR
│   │   ├── clipboard.py       # Clipboard monitoring
│   │   ├── memory.py          # Vector DB & RAG
│   │   └── schema.py          # Pydantic models
│   ├── execution/
│   │   ├── tools/             # Built-in tools
│   │   ├── permission.py      # Permission matrix
│   │   └── orchestrator.py    # Task planning
│   ├── ui/
│   │   ├── launcher.py        # Spotlight interface
│   │   ├── chat.py            # Chat window
│   │   └── permissions.py     # Approval dialogs
│   └── main.py                # Application entry
├── storage/
│   ├── vector_db/             # ChromaDB persistence
│   └── audit.log             # Audit trail
├── tests/
└── requirements.txt
```

### 4.2 Implementation Priority

**Phase 1 - MVP (Week 1-2)**
1. Implement `schema.py` with all Pydantic models
2. Build `screen.py` with active window detection
3. Create `clipboard.py` with pattern matching
4. Implement basic launcher UI with hotkey activation

**Phase 2 - Execution (Week 3-4)**
1. Implement tool system with permission levels
2. Build approval dialog system
3. Add audit logging
4. Connect to LLM API (LiteLLM)

**Phase 3 - Memory (Week 5-6)**
1. Integrate ChromaDB for vector storage
2. Implement project context detection
3. Build RAG retrieval pipeline

### 4.3 Sample Implementation Code

#### File: `src/context/schema.py`

```python
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum

class ContentType(str, Enum):
    TEXT = "text/plain"
    JSON = "application/json"
    ERROR = "error/stack"
    COMMAND = "command/shell"
    MEETING = "uri/meeting"

class ScreenInfo(BaseModel):
    """Structured screen context information."""
    app_name: str = Field(description="Active application name")
    window_title: str = Field(description="Active window title")
    selected_text: Optional[str] = Field(None, description="Selected text content")
    ocr_summary: Optional[str] = Field(None, description="OCR extracted text")

class ClipboardInfo(BaseModel):
    """Clipboard content with type detection."""
    content_type: ContentType
    preview: str = Field(max_length=200, description="Content preview")
    full_content: Optional[str] = None
    detected_pattern: Optional[str] = Field(None, description="Matched heuristic pattern")

class MemoryInfo(BaseModel):
    """Retrieved memory from vector store."""
    relevant_docs: List[str] = Field(default_factory=list)
    user_preferences: List[str] = Field(default_factory=list)
    project_context: Optional[str] = None

class NeuroContext(BaseModel):
    """Unified context object for LLM consumption."""
    user_query: str
    screen: ScreenInfo
    clipboard: ClipboardInfo
    memory: MemoryInfo
    system_os: str
    system_cwd: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)

    def to_llm_prompt(self) -> str:
        """Format context for LLM prompt injection."""
        parts = [
            f"User Query: {self.user_query}",
            f"Current App: {self.screen.app_name}",
        ]
        if self.screen.selected_text:
            parts.append(f"Selected Text: {self.screen.selected_text}")
        if self.clipboard.detected_pattern:
            parts.append(f"Clipboard: {self.clipboard.detected_pattern} detected")
        if self.memory.relevant_docs:
            parts.append(f"Relevant Docs: {', '.join(self.memory.relevant_docs)}")
        return "\n".join(parts)
```

#### File: `src/context/clipboard.py`

```python
import re
import time
import threading
from typing import Callable, Optional
from datetime import datetime
import pyperclip  # pip install pyperclip
from .schema import ClipboardInfo, ContentType

class ClipboardWatcher:
    """Monitor clipboard and detect patterns for proactive suggestions."""

    # Pattern detection rules
    PATTERNS = {
        'json': re.compile(r'^\s*\{.*\}\s*$', re.DOTALL),
        'error': re.compile(r'(Error|Exception|Traceback|Failed)', re.IGNORECASE),
        'curl': re.compile(r'^curl\s+'),
        'meeting': re.compile(r'(zoom\.us|meet\.google\.com|teams\.microsoft\.com)'),
    }

    SUGGESTIONS = {
        'json': "Format JSON or Convert to other format?",
        'error': "Debug error or Analyze stack trace?",
        'curl': "Execute curl command or Test API?",
        'meeting': "Join meeting or Add to calendar?",
    }

    def __init__(self, callback: Callable[[ClipboardInfo], None]):
        self.callback = callback
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._last_content = ""

    def _detect_content_type(self, content: str) -> ContentType:
        """Detect clipboard content type."""
        content = content.strip()
        if self.PATTERNS['json'].match(content):
            return ContentType.JSON
        if self.PATTERNS['error'].search(content):
            return ContentType.ERROR
        if self.PATTERNS['curl'].match(content):
            return ContentType.COMMAND
        if self.PATTERNS['meeting'].search(content):
            return ContentType.MEETING
        return ContentType.TEXT

    def _get_suggestion(self, content_type: ContentType) -> Optional[str]:
        """Get proactive suggestion based on content type."""
        type_map = {
            ContentType.JSON: 'json',
            ContentType.ERROR: 'error',
            ContentType.COMMAND: 'curl',
            ContentType.MEETING: 'meeting',
        }
        key = type_map.get(content_type)
        return self.SUGGESTIONS.get(key) if key else None

    def _watch_loop(self):
        """Main clipboard monitoring loop."""
        while self._running:
            try:
                content = pyperclip.paste()
                if content and content != self._last_content:
                    self._last_content = content
                    content_type = self._detect_content_type(content)
                    suggestion = self._get_suggestion(content_type)

                    event = ClipboardInfo(
                        content_type=content_type,
                        preview=content[:200],
                        full_content=content if len(content) <= 500 else content[:500],
                        detected_pattern=suggestion
                    )
                    self.callback(event)
            except Exception:
                pass  # Clipboard may not be available
            time.sleep(0.5)  # Poll every 500ms

    def start(self):
        """Start clipboard monitoring in background thread."""
        if not self._running:
            self._running = True
            self._thread = threading.Thread(target=self._watch_loop, daemon=True)
            self._thread.start()

    def stop(self):
        """Stop clipboard monitoring."""
        self._running = False
```

#### File: `src/execution/permission.py`

```python
from enum import Enum
from dataclasses import dataclass
from typing import Optional, Any

class PermissionLevel(int, Enum):
    """Permission levels with increasing sensitivity."""
    SAFE = 0      # Read-only, no side effects
    SENSITIVE = 1  # Read private data, write temp
    CRITICAL = 2  # Destructive operations

@dataclass
class PermissionRequest:
    """A request requiring user approval."""
    level: PermissionLevel
    tool_name: str
    description: str
    parameters: dict
    diff: Optional[str] = None  # For file operations, show diff

    @property
    def requires_approval(self) -> bool:
        """Check if this request requires explicit user approval."""
        return self.level >= PermissionLevel.CRITICAL

    @property
    def requires_notification(self) -> bool:
        """Check if this request requires at least a toast notification."""
        return self.level >= PermissionLevel.SENSITIVE

class PermissionManager:
    """Manages permission requests and approvals."""

    def __init__(self):
        self._audit_log_path = "~/.neuro/audit.log"

    def request_permission(self, request: PermissionRequest) -> bool:
        """
        Request permission for an action.

        Returns:
            True if approved, False otherwise.
        """
        if not request.requires_approval:
            # Log but don't ask user
            self._log_audit(request, approved=True)
            return True

        # Show approval dialog (to be implemented in UI layer)
        approved = self._show_approval_dialog(request)
        self._log_audit(request, approved=approved)
        return approved

    def _show_approval_dialog(self, request: PermissionRequest) -> bool:
        """Show approval dialog to user. To be connected to UI."""
        # This will be implemented as an async event that the UI subscribes to
        pass

    def _log_audit(self, request: PermissionRequest, approved: bool):
        """Log all permission requests to audit file."""
        import json
        from datetime import datetime
        import os

        log_entry = {
            "timestamp": datetime.utcnow().isoformat(),
            "level": request.level,
            "tool": request.tool_name,
            "description": request.description,
            "approved": approved,
        }

        # Ensure audit directory exists
        audit_dir = os.path.expanduser("~/.neuro")
        os.makedirs(audit_dir, exist_ok=True)

        audit_path = os.path.join(audit_dir, "audit.log")
        with open(audit_path, "a") as f:
            f.write(json.dumps(log_entry) + "\n")
```

---

## 5. Acceptance Criteria

### 5.1 Functional Requirements

| ID | Requirement | Priority |
|----|------------|----------|
| FR-1 | Alt+Space launches input interface | P0 |
| FR-2 | System detects active window and extracts title | P0 |
| FR-3 | Clipboard patterns trigger proactive suggestions | P1 |
| FR-4 | Level 2 permissions require explicit approval | P0 |
| FR-5 | All actions logged to audit file | P0 |
| FR-6 | RAG retrieval returns relevant project docs | P1 |

### 5.2 Non-Functional Requirements

| ID | Requirement | Target |
|----|------------|--------|
| NFR-1 | Launcher response time | < 100ms |
| NFR-2 | Context injection latency | < 500ms |
| NFR-3 | Memory footprint | < 200MB idle |
| NFR-4 | CPU usage when idle | < 1% |

---

## 6. Open Questions

| ID | Question | Target Resolution |
|----|----------|-------------------|
| OQ-1 | Windows compatibility strategy | Use pywin32 for Windows APIs |
| OQ-2 | Local vs cloud model selection | Support both via LiteLLM |
| OQ-3 | Multi-monitor support | Detect primary display only for MVP |
