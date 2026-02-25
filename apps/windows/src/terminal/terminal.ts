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

const terminalDiv = document.getElementById("terminal")!;
const statusAgent = document.getElementById("status-agent");
const statusPing = document.getElementById("status-ping");
const statusMemory = document.getElementById("status-memory");
const statusTime = document.getElementById("status-time");

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

function createInputLine(): {
  container: HTMLElement;
  input: HTMLInputElement;
  ghost: HTMLSpanElement;
} {
  const container = document.createElement("div");
  container.className = "input-line";

  const prompt = createPrompt();
  const stack = document.createElement("div");
  stack.className = "input-stack";

  const ghost = document.createElement("span");
  ghost.className = "input-ghost";
  ghost.setAttribute("aria-hidden", "true");

  const input = document.createElement("input");
  input.id = "input";
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;

  stack.appendChild(ghost);
  stack.appendChild(input);
  container.appendChild(prompt);
  container.appendChild(stack);

  return { container, input, ghost };
}

function getCompletions(input: string): string[] {
  const trimmed = input.trim();

  if (!trimmed) {
    return commands.map((c) => `/${c}`);
  }

  if (trimmed.startsWith("/")) {
    const search = trimmed.toLowerCase();
    return commands
      .filter((c) => `/${c}`.startsWith(search))
      .map((c) => `/${c}`);
  }

  if (trimmed.startsWith("!")) {
    const search = trimmed.slice(1).toLowerCase();
    return shellCommands
      .filter((c) => c.startsWith(search))
      .map((c) => `!${c}`);
  }

  return [];
}

function updateGhostSuggestion(input: HTMLInputElement, ghost: HTMLSpanElement): void {
  const current = input.value;
  if (!(current.startsWith("/") || current.startsWith("!"))) {
    ghost.textContent = "";
    return;
  }

  const completions = getCompletions(current);
  const suggestion = completions[0];
  if (!suggestion || suggestion.length <= current.length) {
    ghost.textContent = "";
    return;
  }

  ghost.textContent = suggestion;
}

function appendBeforeInput(node: HTMLElement): void {
  const inputLine = terminalDiv.querySelector(".input-line");
  if (inputLine) {
    terminalDiv.insertBefore(node, inputLine);
  } else {
    terminalDiv.appendChild(node);
  }
  scrollToBottom();
}

function writeHtml(html: string, className = "line"): void {
  const line = document.createElement("div");
  line.className = className;
  line.innerHTML = html;
  appendBeforeInput(line);
}

function writeCommandEcho(command: string): void {
  writeHtml(
    `<span class="command-echo"><span class="prompt-composite">${USER_PROMPT_HTML}</span> <span class="command-text">${escapeHtml(command)}</span></span>`,
  );
}

function clearTerminal(): void {
  const inputLine = terminalDiv.querySelector(".input-line");
  terminalDiv.innerHTML = "";
  if (inputLine) {
    terminalDiv.appendChild(inputLine);
  }
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

function renderStatusBar(): void {
  const snapshot = getTerminalStateSnapshot();
  const mem = getMemoryUsageMb();
  const now = new Date().toLocaleTimeString();
  const pingText = latestPingMs === null ? "--ms" : `${latestPingMs}ms`;
  const memoryText = mem === null ? "--MB" : `${mem}MB`;

  if (statusAgent) {
    statusAgent.textContent = `[Agent: ${snapshot.agent}]`;
  }
  if (statusPing) {
    statusPing.textContent = `[Ping: ${pingText}]`;
  }
  if (statusMemory) {
    statusMemory.textContent = `[Memory: ${memoryText}]`;
  }
  if (statusTime) {
    statusTime.textContent = `[Current Time: ${now}]`;
  }
}

function startStatusBarLoop(): void {
  void probeGatewayPing();
  renderStatusBar();
  window.setInterval(renderStatusBar, 1000);
  window.setInterval(() => {
    void probeGatewayPing();
  }, 15_000);
}

function initTerminal(): void {
  terminalDiv.innerHTML = "";

  writeHtml(
    `
<span class="system-ok"><strong>
╔═══════════════════════════════════════════════════════════╗
║                    OPENCLAW TERMINAL                     ║
╠═══════════════════════════════════════════════════════════╣
║  /help for commands                                      ║
║  !cmd for local shell execution                          ║
║  /spawn /agents /tasks for orchestration                 ║
║  Ctrl+B toggles sidebar                                  ║
║  Use --no-code to skip VS Code auto-open                ║
╚═══════════════════════════════════════════════════════════╝
</strong></span>
<span class="system-info">Ctrl+Shift+T toggles this terminal window</span>
`.trim(),
  );

  const { container, input, ghost } = createInputLine();
  terminalDiv.appendChild(container);
  input.focus();

  const syncGhost = () => updateGhostSuggestion(input, ghost);
  input.addEventListener("input", syncGhost);
  syncGhost();

  input.addEventListener("keydown", async (event) => {
    if (isProcessing) {
      return;
    }

    switch (event.key) {
      case "Enter": {
        event.preventDefault();
        const command = input.value.trim();
        input.value = "";
        ghost.textContent = "";

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
        break;
      }

      case "ArrowUp": {
        event.preventDefault();
        if (commandHistory.length === 0) {
          return;
        }
        if (historyIndex === -1) {
          historyIndex = commandHistory.length - 1;
        } else if (historyIndex > 0) {
          historyIndex--;
        }
        input.value = commandHistory[commandHistory.length - 1 - historyIndex];
        syncGhost();
        break;
      }

      case "ArrowDown": {
        event.preventDefault();
        if (historyIndex === -1) {
          return;
        }
        historyIndex++;
        if (historyIndex >= commandHistory.length) {
          historyIndex = -1;
          input.value = "";
        } else {
          input.value = commandHistory[commandHistory.length - 1 - historyIndex];
        }
        syncGhost();
        break;
      }

      case "Tab": {
        event.preventDefault();
        const currentValue = input.value;
        const completions = getCompletions(currentValue);

        if (completions.length === 1) {
          input.value = completions[0];
        } else if (completions.length > 1) {
          writeCommandEcho(currentValue || "<empty>");
          writeHtml("<span class='system-info'>Available completions:</span>");
          writeHtml(`<span class="line">${escapeHtml(completions.join("  "))}</span>`);
        }
        syncGhost();
        break;
      }

      case "c": {
        if (!event.ctrlKey) {
          return;
        }
        event.preventDefault();
        writeHtml("<span class='system-warn'>^C</span>");
        isProcessing = false;
        break;
      }

      case "l": {
        if (!event.ctrlKey) {
          return;
        }
        event.preventDefault();
        clearTerminal();
        break;
      }

      case "b": {
        if (!event.ctrlKey) {
          return;
        }
        event.preventDefault();
        toggleSidebar();
        break;
      }
    }
  });

  terminalDiv.addEventListener("click", () => {
    if (!isProcessing) {
      input.focus();
    }
  });
}

// Initialize sidebar first, then terminal
initSidebar();
initTerminal();
startStatusBarLoop();
