import type { TerminalAPI } from "../preload/terminal-api";
import { handleCommand, parseCommand, getTerminalStateSnapshot } from "./command-handler.js";
import { initSidebar, toggleSidebar } from "./sidebar.js";

declare global {
  interface Window {
    terminalAPI: TerminalAPI;
  }
}

let commandHistory: string[] = [];
let historyIndex = -1;
let isProcessing = false;
let latestPingMs: number | null = null;

// Command Palette state
let paletteVisible = false;
let selectedIndex = 0;
let paletteItems: HTMLElement[] = [];

const terminalDiv = document.getElementById("terminal")!;
const commandInput = document.getElementById("command-input") as HTMLTextAreaElement;

// Global status bar elements
const statusAgent = document.getElementById("status-agent");
const statusPing = document.getElementById("status-ping");
const statusMem = document.getElementById("status-mem");
const statusTasks = document.getElementById("status-tasks");
const statusTime = document.getElementById("status-time");

// Context menu elements
const contextMenu = document.getElementById("context-menu");
const contextMenuItems = document.getElementById("context-menu-items");
let contextMenuVisible = false;
let contextMenuSelectedIndex = 0;
let contextMenuTriggerPos = -1; // Position of @ symbol

const commands = [
  "help",
  "clear",
  "cls",
  "status",
  "agent",
  "session",
  "whoami",
  "env",
  "echo",
  "date",
  "time",
  "history",
  "connect",
  "disconnect",
  "spawn",
  "agents",
  "tasks",
  "task",
  "orchestral",
  "orch",
  "context",
  "review",
  "pattern",
  "test-agent-output",
];

const shellCommandsWindows = [
  "dir", "ls", "cd", "pwd", "cls", "echo", "type", "cat", "del", "rm",
  "copy", "cp", "move", "mv", "mkdir", "md", "rmdir", "rd",
  "git", "npm", "pnpm", "node", "python", "python3", "pip",
];

const shellCommandsUnix = [
  "ls", "cd", "pwd", "clear", "echo", "cat", "less", "more", "head", "tail",
  "grep", "find", "rm", "cp", "mv", "mkdir", "rmdir", "chmod", "chown",
  "git", "npm", "pnpm", "node", "python", "python3", "pip", "curl", "wget",
  "ssh", "vim", "nano", "top", "htop", "ps", "kill", "df", "du",
];

const shellCommands = navigator.platform.includes("Win")
  ? shellCommandsWindows
  : shellCommandsUnix;

const USER_PROMPT_HTML =
  '<span class="prompt-host">[User@OpenClaw]</span> <span class="prompt-home">~</span> <span class="prompt-dollar">$</span>';

function createPrompt(): HTMLElement {
  const promptSpan = document.createElement("span");
  promptSpan.className = "prompt prompt-composite";
  promptSpan.innerHTML = USER_PROMPT_HTML;
  return promptSpan;
}

function writeHtml(html: string, className = "line"): void {
  const line = document.createElement("div");
  line.className = className;
  line.innerHTML = html;
  terminalDiv.appendChild(line);
  scrollToBottom();
}

function writeCommandEcho(command: string): void {
  writeHtml(
    `<span class="command-echo"><span class="prompt-composite">${USER_PROMPT_HTML}</span> <span class="command-text">${escapeHtml(command)}</span></span>`,
  );
}

function clearTerminal(): void {
  terminalDiv.innerHTML = "";
  scrollToBottom();
}

function scrollToBottom(): void {
  terminalDiv.scrollTop = terminalDiv.scrollHeight;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function getMemoryUsageMb(): number | null {
  const perf = performance as Performance & {
    memory?: { usedJSHeapSize?: number };
  };
  const used = perf.memory?.usedJSHeapSize;
  if (typeof used !== "number" || !Number.isFinite(used)) {
    return null;
  }
  return Math.max(1, Math.round(used / (1024 * 1024)));
}

async function probeGatewayPing(): Promise<void> {
  const start = performance.now();
  try {
    await window.terminalAPI.getGatewayInfo();
    latestPingMs = Math.max(1, Math.round(performance.now() - start));
  } catch {
    latestPingMs = null;
  }
}

/**
 * Generate ping visualization using Braille patterns
 */
function getPingGraph(): string {
  if (latestPingMs === null) return "";

  const waves = ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠒"];
  const waveIndex = Math.min(
    Math.floor((latestPingMs || 0) / 20),
    waves.length - 1
  );
  return waves[waveIndex] + "⢄" + waves[Math.max(0, waveIndex - 2)];
}

/**
 * Generate memory visualization using block elements
 */
function getMemoryGraph(memMb: number | null): string {
  if (memMb === null) return "";

  const maxMb = 200;
  const ratio = Math.min(memMb / maxMb, 1);
  const blocks = Math.ceil(ratio * 4);

  const blockChars = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  const blockIndex = Math.min(Math.floor(ratio * 8), blockChars.length - 1);

  return "▁" + blockChars[blockIndex] + "█";
}

/**
 * Get CSS class for memory level coloring
 */
function getMemoryLevelClass(memMb: number): string {
  if (memMb < 50) return "mem-low";
  if (memMb < 120) return "mem-med";
  return "mem-high";
}

function renderGlobalStatusBar(): void {
  const snapshot = getTerminalStateSnapshot();
  const mem = getMemoryUsageMb();
  const now = new Date().toLocaleTimeString();
  const pingText = latestPingMs === null ? "--ms" : `${latestPingMs}ms`;
  const memoryText = mem === null ? "--M" : `${mem}M`;

  if (statusAgent) {
    statusAgent.textContent = `[Agent: ${snapshot.agent}]`;
  }
  if (statusPing) {
    statusPing.innerHTML = `[Ping: ${pingText}]`;
  }
  if (statusMem) {
    statusMem.innerHTML = `[Mem: ${memoryText}]`;
  }
  if (statusTasks) {
    statusTasks.textContent = `[Tasks: ${snapshot.tasks}]`;
  }
  if (statusTime) {
    statusTime.textContent = `[${now}]`;
  }
}

function startStatusBarLoop(): void {
  void probeGatewayPing();
  renderGlobalStatusBar();
  window.setInterval(renderGlobalStatusBar, 1000);
  window.setInterval(() => {
    void probeGatewayPing();
  }, 15_000);
}

/**
 * Auto-resize textarea based on content
 */
function autoResizeTextarea(textarea: HTMLTextAreaElement): void {
  textarea.style.height = "auto";
  const newHeight = Math.min(Math.max(textarea.scrollHeight, 24), 200);
  textarea.style.height = `${newHeight}px`;
}

/**
 * Show @ context menu at cursor position
 */
function showContextMenu(triggerPos: number): void {
  if (!contextMenu || !contextMenuItems) return;

  contextMenuVisible = true;
  contextMenuTriggerPos = triggerPos;
  contextMenuSelectedIndex = 0;
  contextMenu.classList.add("visible");
  updateContextMenuSelection();
}

/**
 * Hide @ context menu
 */
function hideContextMenu(): void {
  if (!contextMenu) return;

  contextMenuVisible = false;
  contextMenuTriggerPos = -1;
  contextMenu.classList.remove("visible");
}

/**
 * Update context menu selection visual
 */
function updateContextMenuSelection(): void {
  if (!contextMenuItems) return;

  const items = contextMenuItems.querySelectorAll(".context-menu-item");
  items.forEach((item, index) => {
    const prefix = item.querySelector(".context-item-prefix");
    if (index === contextMenuSelectedIndex) {
      item.classList.add("selected");
      if (prefix) prefix.textContent = ">";
    } else {
      item.classList.remove("selected");
      if (prefix) prefix.textContent = " ";
    }
  });
}

/**
 * Get @ trigger position in current input
 */
function getAtTriggerPosition(value: string, cursorPos: number): number {
  // Search backwards from cursor for @ symbol
  for (let i = cursorPos - 1; i >= 0; i--) {
    if (value[i] === "@") {
      // Check if it's preceded by whitespace or start of line
      if (i === 0 || /\s/.test(value[i - 1])) {
        return i;
      }
    }
    // Stop if we hit whitespace (not preceded by @)
    if (/\s/.test(value[i])) {
      break;
    }
  }
  return -1;
}

/**
 * Get text after @ for filtering
 */
function getAtQuery(value: string, triggerPos: number, cursorPos: number): string {
  if (triggerPos < 0) return "";
  return value.slice(triggerPos + 1, cursorPos).toLowerCase();
}

/**
 * Handle command submission
 */
async function submitCommand(): Promise<void> {
  if (isProcessing) {
    return;
  }

  const command = commandInput.value.trim();
  commandInput.value = "";
  autoResizeTextarea(commandInput);

  if (!command) {
    return;
  }

  commandHistory.push(command);
  historyIndex = -1;

  const parsed = parseCommand(command);
  if (parsed.type !== "message") {
    writeCommandEcho(command);
  }

  isProcessing = true;
  try {
    await handleCommand(terminalDiv, command);
  } finally {
    isProcessing = false;
    scrollToBottom();
  }
}

/**
 * Navigate command history
 */
function navigateHistory(direction: "up" | "down"): void {
  if (commandHistory.length === 0) {
    return;
  }

  if (direction === "up") {
    if (historyIndex === -1) {
      historyIndex = commandHistory.length - 1;
    } else if (historyIndex > 0) {
      historyIndex--;
    }
    commandInput.value = commandHistory[commandHistory.length - 1 - historyIndex];
  } else {
    if (historyIndex === -1) {
      return;
    }
    historyIndex++;
    if (historyIndex >= commandHistory.length) {
      historyIndex = -1;
      commandInput.value = "";
    } else {
      commandInput.value = commandHistory[commandHistory.length - 1 - historyIndex];
    }
  }

  autoResizeTextarea(commandInput);
  commandInput.setSelectionRange(commandInput.value.length, commandInput.value.length);
}

function initTerminal(): void {
  terminalDiv.innerHTML = "";

  // Rigid ASCII block - 59 chars wide, perfectly aligned
  const bannerEl = document.createElement("pre");
  bannerEl.className = "tui-banner";
  bannerEl.textContent =
`╔═════════════════════════════════════════════════════════╗
║                    OPENCLAW TERMINAL                    ║
╠═════════════════════════════════════════════════════════╣
║ /help for commands                                      ║
║ !cmd for local shell execution                          ║
║ /spawn /agents /tasks for orchestration                 ║
║ Ctrl+B toggles sidebar                                  ║
║ Ctrl+Enter to send command                              ║
╚═════════════════════════════════════════════════════════╝`;

  terminalDiv.appendChild(bannerEl);

  const infoLine = document.createElement("div");
  infoLine.className = "system-info";
  infoLine.textContent = "Ctrl+Shift+T toggles this terminal window";
  terminalDiv.appendChild(infoLine);

  // ========== STRESS TEST: Mock Agent Response ==========
  // User command echo
  const userCmd = document.createElement("div");
  userCmd.className = "command-echo";
  userCmd.innerHTML = `<span class="prompt-composite">${USER_PROMPT_HTML}</span> <span class="command-text">/spawn coder --task "Write a fast fibonacci in C++"</span>`;
  terminalDiv.appendChild(userCmd);

  // System event
  const sysEvent = document.createElement("div");
  sysEvent.className = "system-event system-event-success";
  sysEvent.textContent = "[SYSTEM] Agent 'coder' (PID: 9942) spawned successfully.";
  terminalDiv.appendChild(sysEvent);

  // Agent thought stream
  const thoughtContainer = document.createElement("div");
  thoughtContainer.className = "agent-thought";

  const thoughts = [
    { type: "Thought", content: 'I need to write an optimized Fibonacci function in C++.' },
    { type: "Action", content: "[memory_search] C++ constexpr optimizations" },
    { type: "Observation", content: "Using constexpr allows compile-time evaluation for O(1) lookup." },
    { type: "Thought", content: "Will implement with template metaprogramming for maximum efficiency." }
  ];

  thoughts.forEach((t, i) => {
    const entry = document.createElement("div");
    entry.className = "thought-entry";
    entry.innerHTML = `<span class="thought-prefix">&gt;</span><span class="thought-type">${t.type}:</span> <span class="thought-content">${t.content}</span>`;
    thoughtContainer.appendChild(entry);
  });
  terminalDiv.appendChild(thoughtContainer);

  // Agent markdown output
  const mdContainer = document.createElement("div");
  mdContainer.className = "md-content";

  // Header
  const header = document.createElement("h3");
  header.textContent = "⚡ Optimized C++ Implementation";
  mdContainer.appendChild(header);

  // Paragraph with inline code
  const para = document.createElement("p");
  para.innerHTML = `Here's a <code>constexpr</code> Fibonacci implementation using template metaprogramming. This approach computes values at compile-time for O(1) runtime performance.`;
  mdContainer.appendChild(para);

  // Code block
  const codeBlock = document.createElement("div");
  codeBlock.className = "tui-code-block";

  const codeHeader = document.createElement("div");
  codeHeader.className = "tui-code-header";
  codeHeader.innerHTML = `<span class="tui-code-lang">cpp</span><span class="tui-code-copy">Copy</span>`;
  codeBlock.appendChild(codeHeader);

  const codeContent = document.createElement("div");
  codeContent.className = "tui-code-content";

  const pre = document.createElement("pre");
  pre.innerHTML = `<span class="syntax-comment">// Compile-time Fibonacci using template metaprogramming</span>
<span class="syntax-keyword">template</span>&lt;<span class="syntax-keyword">unsigned</span> <span class="syntax-keyword">int</span> N&gt;
<span class="syntax-keyword">struct</span> <span class="syntax-type">Fibonacci</span> {
    <span class="syntax-keyword">static constexpr</span> <span class="syntax-keyword">unsigned long long</span> <span class="syntax-function">value</span> =
        <span class="syntax-type">Fibonacci</span>&lt;N - <span class="syntax-number">1</span>&gt;::value +
        <span class="syntax-type">Fibonacci</span>&lt;N - <span class="syntax-number">2</span>&gt;::value;
};

<span class="syntax-comment">// Base cases</span>
<span class="syntax-keyword">template</span>&lt;&gt;
<span class="syntax-keyword">struct</span> <span class="syntax-type">Fibonacci</span>&lt;<span class="syntax-number">0</span>&gt; {
    <span class="syntax-keyword">static constexpr</span> <span class="syntax-keyword">unsigned long long</span> <span class="syntax-function">value</span> = <span class="syntax-number">0</span>;
};

<span class="syntax-keyword">template</span>&lt;&gt;
<span class="syntax-keyword">struct</span> <span class="syntax-type">Fibonacci</span>&lt;<span class="syntax-number">1</span>&gt; {
    <span class="syntax-keyword">static constexpr</span> <span class="syntax-keyword">unsigned long long</span> <span class="syntax-function">value</span> = <span class="syntax-number">1</span>;
};

<span class="syntax-comment">// Usage: computed entirely at compile-time</span>
<span class="syntax-keyword">int</span> <span class="syntax-function">main</span>() {
    <span class="syntax-keyword">constexpr auto</span> result = <span class="syntax-type">Fibonacci</span>&lt;<span class="syntax-number">50</span>&gt;::value;
    <span class="syntax-keyword">return</span> result &lt; <span class="syntax-number">1000000000</span> ? <span class="syntax-number">0</span> : <span class="syntax-number">1</span>;
}`;

  codeContent.appendChild(pre);
  codeBlock.appendChild(codeContent);
  mdContainer.appendChild(codeBlock);

  // Another paragraph
  const para2 = document.createElement("p");
  para2.innerHTML = `<strong>Benchmark results:</strong> The template version runs in <code>&lt;1ns</code> since all computation happens during compilation. Memory footprint is zero at runtime.`;
  mdContainer.appendChild(para2);

  terminalDiv.appendChild(mdContainer);

  // Turn separator
  const separator = document.createElement("div");
  separator.className = "turn-separator";
  terminalDiv.appendChild(separator);
  // ========== END STRESS TEST ==========

  scrollToBottom();

  // Focus the command input
  commandInput.focus();

  // Auto-resize on input
  commandInput.addEventListener("input", () => {
    autoResizeTextarea(commandInput);

    // Check for @ trigger
    const cursorPos = commandInput.selectionStart;
    const triggerPos = getAtTriggerPosition(commandInput.value, cursorPos);

    if (triggerPos >= 0) {
      showContextMenu(triggerPos);
    } else {
      hideContextMenu();
    }
  });

  // Handle keyboard events
  commandInput.addEventListener("keydown", async (event) => {
    // Context menu navigation
    if (contextMenuVisible) {
      if (event.key === "Escape") {
        event.preventDefault();
        hideContextMenu();
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        const items = contextMenuItems?.querySelectorAll(".context-menu-item");
        if (items) {
          contextMenuSelectedIndex = Math.min(contextMenuSelectedIndex + 1, items.length - 1);
          updateContextMenuSelection();
        }
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        contextMenuSelectedIndex = Math.max(contextMenuSelectedIndex - 1, 0);
        updateContextMenuSelection();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const items = contextMenuItems?.querySelectorAll(".context-menu-item");
        if (items && items[contextMenuSelectedIndex]) {
          const selectedItem = items[contextMenuSelectedIndex] as HTMLElement;
          const type = selectedItem.dataset.type || "";
          const value = selectedItem.dataset.value || "";

          // Replace @query with @{type:value}
          const beforeAt = commandInput.value.slice(0, contextMenuTriggerPos);
          const afterCursor = commandInput.value.slice(commandInput.selectionStart);
          const insertText = `@${type}:${value}`;

          commandInput.value = beforeAt + insertText + " " + afterCursor;
          const newCursorPos = beforeAt.length + insertText.length + 1;
          commandInput.setSelectionRange(newCursorPos, newCursorPos);
          autoResizeTextarea(commandInput);
        }
        hideContextMenu();
        return;
      }

      // Any other key hides the menu
      hideContextMenu();
    }

    // Ctrl+Enter or Ctrl+Shift+Enter to submit
    if (event.key === "Enter" && event.ctrlKey) {
      event.preventDefault();
      await submitCommand();
      return;
    }

    // Plain Enter: if shift is pressed, insert newline; otherwise submit
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      await submitCommand();
      return;
    }

    // Shift+Enter: insert newline (default behavior, just ensure we resize)
    if (event.key === "Enter" && event.shiftKey) {
      // Allow default newline behavior
      setTimeout(() => autoResizeTextarea(commandInput), 0);
      return;
    }

    // Escape: clear input (or hide context menu)
    if (event.key === "Escape") {
      event.preventDefault();
      commandInput.value = "";
      autoResizeTextarea(commandInput);
      return;
    }

    // Arrow Up/Down for history (only if not Ctrl+Up/Dn which some terminals use for scrolling)
    if (event.key === "ArrowUp" && !event.ctrlKey && !event.shiftKey) {
      // Don't navigate history if cursor is not at start
      if (commandInput.selectionStart !== 0 || commandInput.selectionEnd !== 0) {
        return;
      }
      event.preventDefault();
      navigateHistory("up");
      return;
    }

    if (event.key === "ArrowDown" && !event.ctrlKey && !event.shiftKey) {
      // Don't navigate history if cursor is not at end
      if (commandInput.selectionStart !== commandInput.value.length ||
          commandInput.selectionEnd !== commandInput.value.length) {
        return;
      }
      event.preventDefault();
      navigateHistory("down");
      return;
    }

    // Ctrl+L: clear terminal
    if (event.key === "l" && event.ctrlKey) {
      event.preventDefault();
      clearTerminal();
      return;
    }

    // Ctrl+B: toggle sidebar
    if (event.key === "b" && event.ctrlKey) {
      event.preventDefault();
      toggleSidebar();
      return;
    }

    // Ctrl+C: cancel processing
    if (event.key === "c" && event.ctrlKey) {
      event.preventDefault();
      writeHtml("<span class='system-warn'>^C</span>");
      isProcessing = false;
      return;
    }

    // Tab: simple completion (single word only)
    if (event.key === "Tab") {
      event.preventDefault();
      const currentValue = commandInput.value;
      const cursorPos = commandInput.selectionStart;

      // Get the word being typed
      const beforeCursor = currentValue.slice(0, cursorPos);
      const wordMatch = beforeCursor.match(/(\S+)$/);
      if (!wordMatch) return;

      const currentWord = wordMatch[1];
      let completion = "";

      if (currentWord.startsWith("/")) {
        const search = currentWord.toLowerCase();
        const match = commands.find((c) => `/${c}`.startsWith(search));
        if (match) completion = `/${match}`;
      } else if (currentWord.startsWith("!")) {
        const search = currentWord.slice(1).toLowerCase();
        const match = shellCommands.find((c) => c.startsWith(search));
        if (match) completion = `!${match}`;
      }

      if (completion && completion.length > currentWord.length) {
        const afterCursor = currentValue.slice(cursorPos);
        const beforeWord = beforeCursor.slice(0, -currentWord.length);
        commandInput.value = beforeWord + completion + afterCursor;
        const newCursorPos = beforeWord.length + completion.length;
        commandInput.setSelectionRange(newCursorPos, newCursorPos);
        autoResizeTextarea(commandInput);
      }
    }
  });

  // Click on terminal area focuses the input
  terminalDiv.addEventListener("click", () => {
    if (!isProcessing) {
      commandInput.focus();
    }
  });

  // Also focus when clicking on the command deck (outside textarea)
  document.getElementById("command-deck")?.addEventListener("click", (e) => {
    if (e.target !== commandInput && !isProcessing) {
      commandInput.focus();
    }
  });

  // Context menu item click handlers
  contextMenuItems?.querySelectorAll(".context-menu-item").forEach((item, index) => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const target = item as HTMLElement;
      const type = target.dataset.type || "";
      const value = target.dataset.value || "";

      if (contextMenuTriggerPos >= 0) {
        const beforeAt = commandInput.value.slice(0, contextMenuTriggerPos);
        const afterCursor = commandInput.value.slice(commandInput.selectionStart);
        const insertText = `@${type}:${value}`;

        commandInput.value = beforeAt + insertText + " " + afterCursor;
        const newCursorPos = beforeAt.length + insertText.length + 1;
        commandInput.setSelectionRange(newCursorPos, newCursorPos);
        autoResizeTextarea(commandInput);
      }
      hideContextMenu();
      commandInput.focus();
    });
  });

  // Set up agent output listener for real-time agent output
  if (window.terminalAPI?.onAgentOutput) {
    window.terminalAPI.onAgentOutput((data) => {
      writeHtml(`<span class="agent-output">${escapeHtml(data.data)}</span>`);
      scrollToBottom();
    });
  }
}

/**
 * Initialize Command Palette
 */
function initCommandPalette(): void {
  const palette = document.getElementById("command-palette");
  const paletteInput = document.getElementById("palette-input") as HTMLInputElement;
  const resultsContainer = document.getElementById("palette-results");

  if (!palette || !paletteInput || !resultsContainer) return;

  paletteItems = Array.from(resultsContainer.querySelectorAll(".palette-item"));

  function togglePalette(show?: boolean): void {
    const shouldShow = show ?? !paletteVisible;
    if (shouldShow) {
      palette.classList.remove("hidden");
      paletteInput.value = "";
      selectedIndex = 0;
      paletteInput.focus();
      updatePaletteSelection();
      paletteVisible = true;
    } else {
      palette.classList.add("hidden");
      paletteVisible = false;
      commandInput.focus();
    }
  }

  function updatePaletteSelection(): void {
    paletteItems.forEach((item, index) => {
      const checkbox = item.querySelector(".palette-checkbox");
      if (index === selectedIndex) {
        item.classList.add("selected");
        if (checkbox) checkbox.textContent = "[x]";
        item.scrollIntoView({ block: "nearest" });
      } else {
        item.classList.remove("selected");
        if (checkbox) checkbox.textContent = "[ ]";
      }
    });
  }

  function filterPaletteItems(query: string): void {
    const lowerQuery = query.toLowerCase();

    paletteItems.forEach((item) => {
      const command = item.dataset.command || "";
      const desc = item.querySelector(".palette-item-desc")?.textContent || "";
      const matches = command.includes(lowerQuery) || desc.toLowerCase().includes(lowerQuery);

      item.style.display = matches ? "flex" : "none";
    });

    const visibleItems = paletteItems.filter((item) => item.style.display !== "none");
    if (selectedIndex >= visibleItems.length) {
      selectedIndex = Math.max(0, visibleItems.length - 1);
    }

    updatePaletteSelection();
  }

  function executeSelectedCommand(): void {
    const visibleItems = paletteItems.filter((item) => item.style.display !== "none");
    const selectedItem = visibleItems[selectedIndex];

    if (selectedItem) {
      const command = selectedItem.dataset.command || "";
      togglePalette(false);
      commandInput.value = command + " ";
      commandInput.focus();
      autoResizeTextarea(commandInput);
    }
  }

  paletteInput.addEventListener("keydown", (event) => {
    const visibleItems = paletteItems.filter((item) => item.style.display !== "none");

    switch (event.key) {
      case "Escape":
        event.preventDefault();
        togglePalette(false);
        break;

      case "ArrowDown":
        event.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, visibleItems.length - 1);
        updatePaletteSelection();
        break;

      case "ArrowUp":
        event.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        updatePaletteSelection();
        break;

      case "Enter":
        event.preventDefault();
        executeSelectedCommand();
        break;

      case "Tab":
        event.preventDefault();
        selectedIndex = (selectedIndex + 1) % visibleItems.length;
        updatePaletteSelection();
        break;
    }
  });

  paletteInput.addEventListener("input", () => {
    selectedIndex = 0;
    filterPaletteItems(paletteInput.value);
  });

  paletteItems.forEach((item) => {
    item.addEventListener("click", () => {
      const index = paletteItems.indexOf(item);
      selectedIndex = index;
      executeSelectedCommand();
    });
  });

  palette.addEventListener("click", (event) => {
    if (event.target === palette) {
      togglePalette(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.altKey) && event.key === "p") {
      event.preventDefault();
      togglePalette(true);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.metaKey && event.key === "p") {
      event.preventDefault();
      togglePalette(true);
    }
  });
}

// Initialize
initSidebar();
initTerminal();
initCommandPalette();
startStatusBarLoop();
