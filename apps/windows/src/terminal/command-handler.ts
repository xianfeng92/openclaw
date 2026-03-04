import type {
  TerminalConfigIssue,
  TerminalConfigValidation,
  TerminalLandingFileStatus,
} from "../preload/terminal-api";
import { TerminalGatewayClient, type GatewayChatState } from "./gateway-client.js";
import {
  handleSpawnCommand,
  handleAgentsCommand,
  handleTasksCommand,
  showOrchestralHelp,
} from "./orchestral-commands.js";

const SPINNER_FRAMES = ["[ / ]", "[ - ]", "[ \\ ]", "[ | ]"] as const;
const TYPEWRITER_MIN_DELAY_MS = 10;
const TYPEWRITER_MAX_DELAY_MS = 30;
const CHAT_TIMEOUT_MS = 180_000;
const CHAT_TIMEOUT_SECONDS = Math.round(CHAT_TIMEOUT_MS / 1000);
const USER_PROMPT_HTML =
  '<span class="prompt-host">[User@CyDeck]</span> <span class="prompt-home">~</span> <span class="prompt-dollar">$</span>';

export type ParsedCommand =
  | { type: "shell"; command: string }
  | { type: "slash"; command: string; args: string[] }
  | { type: "message"; content: string }
  | { type: "empty" };

type TerminalCommandRuntimeHooks = {
  clearHistory?: () => number;
  listHistory?: () => string[];
};

// Terminal state
let gatewayClient: TerminalGatewayClient | null = null;
let currentSessionKey = "default";
const knownSessionKeys = new Set<string>([currentSessionKey]);
let currentAgent = "main";
let runtimeHooks: TerminalCommandRuntimeHooks = {};

export function registerTerminalCommandRuntimeHooks(hooks: TerminalCommandRuntimeHooks): void {
  runtimeHooks = hooks;
}

export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim();

  if (!trimmed) {
    return { type: "empty" };
  }

  if (trimmed.startsWith("!") && trimmed !== "!") {
    return { type: "shell", command: trimmed.slice(1) };
  }

  if (trimmed.startsWith("/")) {
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);
    return { type: "slash", command: cmd, args };
  }

  return { type: "message", content: trimmed };
}

export function getTerminalStateSnapshot(): {
  agent: string;
  sessionKey: string;
  connected: boolean;
} {
  return {
    agent: currentAgent,
    sessionKey: currentSessionKey,
    connected: gatewayClient?.isConnected() ?? false,
  };
}

function appendBeforeInput(terminal: HTMLElement, node: HTMLElement): void {
  const inputLine = terminal.querySelector(".input-line");
  if (inputLine) {
    terminal.insertBefore(node, inputLine);
  } else {
    terminal.appendChild(node);
  }
  terminal.scrollTop = terminal.scrollHeight;
}

// Helper to write plain text to terminal
function writeLine(terminal: HTMLElement, text: string, className = "system-info"): void {
  const line = document.createElement("div");
  line.className = `line ${className}`;
  line.textContent = text;
  appendBeforeInput(terminal, line);
}

// Helper to write HTML (with colors) to terminal
function writeHtml(terminal: HTMLElement, html: string, className = "line"): void {
  const line = document.createElement("div");
  line.className = className;
  line.innerHTML = html;
  appendBeforeInput(terminal, line);
}

function startAsciiSpinner(container: HTMLElement, label: string): () => void {
  let frame = 0;
  container.textContent = `${SPINNER_FRAMES[frame]} ${label}`;
  const timer = window.setInterval(() => {
    frame = (frame + 1) % SPINNER_FRAMES.length;
    container.textContent = `${SPINNER_FRAMES[frame]} ${label}`;
  }, 95);

  return () => {
    window.clearInterval(timer);
  };
}

function randomTypeDelayMs(): number {
  const span = TYPEWRITER_MAX_DELAY_MS - TYPEWRITER_MIN_DELAY_MS + 1;
  return TYPEWRITER_MIN_DELAY_MS + Math.floor(Math.random() * span);
}

function createClientRunId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `run-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export async function handleCommand(terminal: HTMLElement, input: string): Promise<void> {
  const parsed = parseCommand(input);

  switch (parsed.type) {
    case "empty":
      return;
    case "shell":
      await handleShellCommand(terminal, parsed.command);
      break;
    case "slash":
      await handleSlashCommand(terminal, parsed.command, parsed.args);
      break;
    case "message":
      await handleMessage(terminal, parsed.content);
      break;
  }
}

async function handleShellCommand(terminal: HTMLElement, command: string): Promise<void> {
  writeLine(terminal, `$ ${command}`);

  try {
    const result = await window.terminalAPI.execShell(command);
    const runId = result.runId;

    const unsubscribe = window.terminalAPI.onShellOutput((data) => {
      if (data.runId !== runId) {
        return;
      }

      if (data.type === "stdout") {
        writeLine(terminal, data.data, "line");
      } else if (data.type === "stderr") {
        writeHtml(terminal, `<span class="system-error">${escapeHtml(data.data)}</span>`);
      } else if (data.type === "exit") {
        unsubscribe();
        const exitCode = data.exitCode ?? 0;
        if (exitCode !== 0) {
          writeHtml(terminal, `<span class="system-info">Exit code: ${exitCode}</span>`);
        }
      }
    });
  } catch (err) {
    writeHtml(terminal, `<span class="system-error">Error: ${escapeHtml(String(err))}</span>`);
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function escapeHtmlAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

function formatInlineMarkdown(text: string): string {
  let html = escapeHtml(text);
  const codeTokens: string[] = [];

  html = html.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    const token = `@@CODE_${codeTokens.length}@@`;
    codeTokens.push(`<code>${code}</code>`);
    return token;
  });

  html = html.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_match, label: string, url: string) => {
      const safeUrl = escapeHtmlAttr(url);
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    },
  );

  html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  html = html.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  html = html.replace(/(^|[^\w])\*([^*\n]+)\*(?=[^\w]|$)/g, "$1<em>$2</em>");
  html = html.replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, "$1<em>$2</em>");

  return html.replace(/@@CODE_(\d+)@@/g, (_match, index: string) => {
    const tokenIndex = Number(index);
    return Number.isFinite(tokenIndex) ? (codeTokens[tokenIndex] ?? "") : "";
  });
}

function renderAssistantMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  const paragraphLines: string[] = [];
  const quoteLines: string[] = [];
  let listType: "ul" | "ol" | null = null;
  const listItems: string[] = [];
  let codeFence:
    | {
        lang: string;
        lines: string[];
      }
    | null = null;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }
    const html = paragraphLines.map((line) => formatInlineMarkdown(line)).join("<br>");
    blocks.push(`<p>${html}</p>`);
    paragraphLines.length = 0;
  };

  const flushQuote = () => {
    if (quoteLines.length === 0) {
      return;
    }
    const html = quoteLines.map((line) => formatInlineMarkdown(line)).join("<br>");
    blocks.push(`<blockquote>${html}</blockquote>`);
    quoteLines.length = 0;
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) {
      listType = null;
      listItems.length = 0;
      return;
    }
    blocks.push(`<${listType}>${listItems.join("")}</${listType}>`);
    listType = null;
    listItems.length = 0;
  };

  const flushCodeFence = () => {
    if (!codeFence) {
      return;
    }
    const langClass = codeFence.lang
      ? ` class="language-${escapeHtmlAttr(codeFence.lang.toLowerCase())}"`
      : "";
    blocks.push(
      `<pre class="assistant-code"><code${langClass}>${escapeHtml(codeFence.lines.join("\n"))}</code></pre>`,
    );
    codeFence = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, "  ");

    if (codeFence) {
      if (/^```/.test(line.trim())) {
        flushCodeFence();
      } else {
        codeFence.lines.push(rawLine);
      }
      continue;
    }

    const fenceStart = line.trim().match(/^```([\w-]+)?\s*$/);
    if (fenceStart) {
      flushParagraph();
      flushQuote();
      flushList();
      codeFence = { lang: fenceStart[1] ?? "", lines: [] };
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      flushQuote();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushQuote();
      flushList();
      const level = headingMatch[1].length;
      blocks.push(
        `<h${level} class="md-heading md-h${level}">${formatInlineMarkdown(headingMatch[2])}</h${level}>`,
      );
      continue;
    }

    const quoteMatch = line.match(/^\s*>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      quoteLines.push(quoteMatch[1]);
      continue;
    }

    const ulMatch = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ulMatch) {
      flushParagraph();
      flushQuote();
      if (listType !== "ul") {
        flushList();
        listType = "ul";
      }
      listItems.push(`<li>${formatInlineMarkdown(ulMatch[1])}</li>`);
      continue;
    }

    const olMatch = line.match(/^\s*\d+\.\s+(.*)$/);
    if (olMatch) {
      flushParagraph();
      flushQuote();
      if (listType !== "ol") {
        flushList();
        listType = "ol";
      }
      listItems.push(`<li>${formatInlineMarkdown(olMatch[1])}</li>`);
      continue;
    }

    flushQuote();
    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushQuote();
  flushList();
  flushCodeFence();

  return blocks.join("");
}

async function handleSlashCommand(
  terminal: HTMLElement,
  command: string,
  args: string[],
): Promise<void> {
  switch (command) {
    case "/help":
    case "/?": {
      showHelp(terminal);
      return;
    }

    case "/clear":
    case "/cls": {
      const inputLine = terminal.querySelector(".input-line");
      terminal.innerHTML = "";
      if (inputLine) {
        terminal.appendChild(inputLine);
      }
      return;
    }

    case "/status": {
      await showStatus(terminal);
      return;
    }

    case "/agent": {
      if (args.length === 0) {
        writeLine(terminal, `Current agent: ${currentAgent}`);
        writeLine(terminal, "Usage: /agent <agent-name>");
        writeLine(terminal, "Available agents: main, claude, gpt, local");
      } else {
        currentAgent = args[0];
        writeHtml(terminal, `<span class="system-ok">[ok] Switched to agent: ${escapeHtml(currentAgent)}</span>`);
      }
      return;
    }

    case "/session": {
      const rotateSessionIfNeeded = async (nextSessionKey: string): Promise<void> => {
        if (!gatewayClient || !gatewayClient.isConnected()) {
          return;
        }
        if (nextSessionKey === currentSessionKey) {
          return;
        }
        try {
          const rotated = await gatewayClient.rotateSession(currentSessionKey);
          if (rotated.saved) {
            const savedPath = rotated.relativePath ?? "memory/<date>-<session>.md";
            writeHtml(
              terminal,
              `<span class="system-info">[memory] Saved session snapshot: ${escapeHtml(savedPath)}</span>`,
            );
          }
        } catch {
          // Best-effort housekeeping; don't block session switches.
        }
      };

      if (args.length === 0) {
        writeLine(terminal, `Current session: ${currentSessionKey}`);
        writeLine(terminal, "Usage: /session <session-key> | new | list");
      } else if (args[0] === "new") {
        const nextSessionKey = `session-${Date.now()}`;
        await rotateSessionIfNeeded(nextSessionKey);
        currentSessionKey = nextSessionKey;
        knownSessionKeys.add(currentSessionKey);
        writeHtml(
          terminal,
          `<span class="system-ok">[ok] Created new session: ${escapeHtml(currentSessionKey)}</span>`,
        );
      } else if (args[0] === "list") {
        const sessions = Array.from(knownSessionKeys).sort((a, b) => a.localeCompare(b));
        if (sessions.length === 0) {
          writeLine(terminal, "No known sessions.");
          return;
        }
        writeLine(terminal, "Known sessions:");
        for (const sessionKey of sessions) {
          const marker = sessionKey === currentSessionKey ? "*" : "-";
          writeLine(terminal, `${marker} ${sessionKey}`);
        }
      } else {
        const nextSessionKey = args[0];
        await rotateSessionIfNeeded(nextSessionKey);
        currentSessionKey = nextSessionKey;
        knownSessionKeys.add(currentSessionKey);
        writeHtml(
          terminal,
          `<span class="system-ok">[ok] Switched to session: ${escapeHtml(currentSessionKey)}</span>`,
        );
      }
      return;
    }

    case "/whoami": {
      const gatewayInfo = await window.terminalAPI.getGatewayInfo();
      writeHtml(
        terminal,
        `
<span class="system-ok"><strong>User Information</strong></span>
Agent: ${escapeHtml(currentAgent)}
Session: ${escapeHtml(currentSessionKey)}
Gateway Port: ${gatewayInfo.port ?? "unknown"}
Platform: ${escapeHtml(navigator.platform)}
`.trim(),
      );
      return;
    }

    case "/env":
    case "/environment": {
      writeHtml(
        terminal,
        `
<span class="system-ok"><strong>Environment</strong></span>
Terminal: CyDeck Terminal
Mode: Desktop (Electron)
Platform: ${escapeHtml(navigator.platform)}
Language: ${escapeHtml(navigator.language)}
`.trim(),
      );
      return;
    }

    case "/echo": {
      writeLine(terminal, args.join(" "), "line");
      return;
    }

    case "/date": {
      writeLine(terminal, new Date().toString(), "line");
      return;
    }

    case "/time": {
      writeLine(terminal, new Date().toLocaleTimeString(), "line");
      return;
    }

    case "/history": {
      if (args.length > 0 && args[0] === "clear") {
        const cleared = runtimeHooks.clearHistory?.() ?? 0;
        const suffix = cleared === 1 ? "entry" : "entries";
        writeLine(terminal, `History cleared (${cleared} ${suffix}).`);
        return;
      }
      const entries = runtimeHooks.listHistory?.() ?? [];
      if (entries.length === 0) {
        writeLine(terminal, "Command History: (empty)");
        return;
      }
      const tail = entries.slice(-20);
      writeLine(terminal, `Command History (last ${tail.length}):`);
      tail.forEach((entry, index) => {
        writeLine(terminal, `${index + 1}. ${entry}`);
      });
      return;
    }

    case "/connect": {
      await connectGateway(terminal);
      return;
    }

    case "/disconnect": {
      if (gatewayClient) {
        gatewayClient.disconnect();
        gatewayClient = null;
        writeHtml(terminal, "<span class='system-warn'>[!] Disconnected from gateway</span>");
      } else {
        writeLine(terminal, "Not connected to gateway");
      }
      return;
    }

    case "/spawn": {
      await handleSpawnCommand(terminal, args, writeLine, writeHtml);
      return;
    }

    case "/agents": {
      await handleAgentsCommand(terminal, args, writeLine, writeHtml);
      return;
    }

    case "/tasks": {
      await handleTasksCommand(terminal, args, writeLine, writeHtml);
      return;
    }

    case "/orchestral":
    case "/orch": {
      showOrchestralHelp(terminal, writeHtml);
      return;
    }

    case "/context": {
      await handleContextCommand(terminal, args, writeLine, writeHtml);
      return;
    }

    case "/review": {
      await handleReviewCommand(terminal, args, writeLine, writeHtml);
      return;
    }

    case "/pattern": {
      await handlePatternCommand(terminal, args, writeLine, writeHtml);
      return;
    }

    case "/task": {
      await handleTaskCommand(terminal, args, writeLine, writeHtml);
      return;
    }

    case "/pr": {
      await handlePRCommand(terminal, args, writeLine, writeHtml);
      return;
    }

    case "/workflow": {
      await handleWorkflowCommand(terminal, args, writeLine, writeHtml);
      return;
    }

    case "/config": {
      await handleConfigCommand(terminal, args, writeLine, writeHtml);
      return;
    }

    case "/landing": {
      await handleLandingCommand(terminal, args, writeLine, writeHtml);
      return;
    }

    case "/test-agent-output": {
      await showMockAgentOutput(terminal, writeLine, writeHtml);
      return;
    }

    default: {
      writeHtml(
        terminal,
        `<span class="system-warn">Unknown command: ${escapeHtml(command)}</span>`,
      );
      writeLine(terminal, "Type /help for available commands");
    }
  }
}

function showHelp(terminal: HTMLElement): void {
  writeHtml(
    terminal,
    `
<span class="system-ok"><strong>
╔═══════════════════════════════════════════════════════════╗
║                    CyDeck Terminal Help                   ║
╚═══════════════════════════════════════════════════════════╝
</strong></span>

<span class="system-info"><strong>Terminal Commands:</strong></span>
  /help          - Show this help message
  /clear         - Clear the terminal screen
  /status        - Show terminal and gateway status
  /config        - Show config command usage
  /landing       - Guided setup for SOUL/IDENTITY/USER/AGENTS/MEMORY
  /history       - Show command history
  /whoami        - Display current user/session info
  /env           - Show environment information
  /echo &lt;text&gt;   - Echo the input text
  /date          - Show current date
  /time          - Show current time

<span class="system-info"><strong>Session Commands:</strong></span>
  /agent &lt;name&gt;   - Switch agent (main, claude, gpt, local)
  /session &lt;key&gt;  - Switch session key
  /session new    - Create a new session

<span class="system-info"><strong>Orchestral Commands:</strong></span>
  /spawn &lt;desc&gt;  - Spawn a new agent task
  /agents list    - List running agents
  /agents kill    - Terminate an agent
  /agents kill --all - Terminate all agents
  /tasks          - List all tasks (running by default)
  /tasks clear    - Hide completed tasks from sidebar
  /tasks show --all - Show all tasks including completed
  /orchestral     - Show orchestral command help

<span class="system-info"><strong>Context Commands:</strong></span>
  /context list   - List all loaded context
  /context search &lt;query&gt; - Search context
  /context load   - Load context from Obsidian
  /context clear  - Clear context cache
  /context summary - Show context summary

<span class="system-info"><strong>Review Commands:</strong></span>
  /review diff    - Review git diff
  /review status  - Show review status

<span class="system-info"><strong>Pattern Commands:</strong></span>
  /pattern list   - List all saved patterns
  /pattern save   - Save a new pattern
  /pattern apply   - Apply pattern to task
  /pattern rate    - Rate pattern effectiveness

<span class="system-info"><strong>Task Lifecycle:</strong></span>
  /task complete - Mark task complete with pattern tracking
  /task list      - Show all tasks with patterns

<span class="system-info"><strong>Testing:</strong></span>
  /test-agent-output - Show mock AI agent output for visual testing

<span class="system-info"><strong>Gateway Commands:</strong></span>
  /connect        - Connect to gateway
  /disconnect     - Disconnect from gateway

<span class="system-info"><strong>Shell Commands:</strong></span>
  !&lt;command&gt;      - Execute shell command
  Example: !ls, !pwd, !git status

<span class="system-info"><strong>Agent Messages:</strong></span>
  Type a message to send it to the current agent

<span class="system-info"><strong>Keyboard Shortcuts:</strong></span>
  Enter          - Execute command
  Tab            - Autocomplete command
  Ctrl+C         - Abort current input
  Ctrl+L         - Clear screen
  Up/Down        - Browse command history
  Ctrl+Shift+T   - Toggle terminal window
`.trim(),
  );
}

async function showStatus(terminal: HTMLElement): Promise<void> {
  const gatewayInfo = await window.terminalAPI.getGatewayInfo();
  const connected = gatewayClient?.isConnected() ?? false;

  writeHtml(
    terminal,
    `
<span class="system-ok"><strong>CyDeck Terminal Status</strong></span>

<span class="system-info"><strong>Session:</strong></span>
  Agent: ${escapeHtml(currentAgent)}
  Session: ${escapeHtml(currentSessionKey)}

<span class="system-info"><strong>Gateway:</strong></span>
  Status: ${connected ? "<span class='system-ok'>Connected</span>" : "<span class='system-error'>Disconnected</span>"}
  Port: ${gatewayInfo.port ?? "unknown"}

<span class="system-info"><strong>Terminal:</strong></span>
  Platform: ${escapeHtml(navigator.platform)}
  Mode: Desktop
`.trim(),
  );
}

async function connectGateway(terminal: HTMLElement): Promise<void> {
  writeLine(terminal, "Connecting to gateway...");

  try {
    const gatewayInfo = await window.terminalAPI.getGatewayInfo();
    if (!gatewayInfo.port) {
      writeHtml(
        terminal,
        "<span class='system-error'>Error: Gateway port not found. Is gateway running?</span>",
      );
      return;
    }

    const auth = window.terminalAPI.getGatewayAuthSync();
    if (!auth?.token) {
      writeHtml(terminal, "<span class='system-error'>Error: Gateway auth token not found</span>");
      return;
    }

    const url = `ws://127.0.0.1:${auth.port}`;
    gatewayClient = new TerminalGatewayClient(url, auth.token);
    await gatewayClient.connect();
    writeHtml(terminal, "<span class='system-ok'>[ok] Connected to gateway</span>");
  } catch (err) {
    writeHtml(
      terminal,
      `<span class='system-error'>[err] Failed to connect: ${escapeHtml(String(err))}</span>`,
    );
  }
}

async function handleMessage(terminal: HTMLElement, content: string): Promise<void> {
  if (!gatewayClient || !gatewayClient.isConnected()) {
    await connectGateway(terminal);
    if (!gatewayClient?.isConnected()) {
      writeHtml(terminal, "<span class='system-error'>Cannot send message: gateway offline</span>");
      return;
    }
  }

  const userLine = document.createElement("div");
  userLine.className = "line user-line";
  userLine.innerHTML = `<span class="user-prefix prompt-composite">${USER_PROMPT_HTML}</span> <span class="user-text">${escapeHtml(content)}</span>`;
  appendBeforeInput(terminal, userLine);

  const assistantBody = document.createElement("div");
  assistantBody.className = "assistant-output";
  appendBeforeInput(terminal, assistantBody);

  const spinnerNode = document.createElement("div");
  spinnerNode.className = "spinner-line";
  assistantBody.appendChild(spinnerNode);

  const outputNode = document.createElement("div");
  outputNode.className = "assistant-body";
  assistantBody.appendChild(outputNode);

  const stopSpinner = startAsciiSpinner(spinnerNode, "thinking");
  let spinnerVisible = true;
  const hideSpinner = () => {
    if (!spinnerVisible) {
      return;
    }
    spinnerVisible = false;
    stopSpinner();
    spinnerNode.remove();
  };

  const runId = createClientRunId();
  let closed = false;
  let seq = -1;
  let targetText = "";
  let renderedLength = 0;
  let typingTimer: number | null = null;
  let timeoutTimer: number | null = null;
  let terminalState: "pending" | GatewayChatState = "pending";

  const renderOutput = (text: string) => {
    outputNode.innerHTML = renderAssistantMarkdown(text);
    terminal.scrollTop = terminal.scrollHeight;
  };

  const maybeFinalize = () => {
    if (closed || terminalState === "pending" || typingTimer !== null) {
      return;
    }
    closed = true;
    hideSpinner();
    if (!targetText) {
      if (terminalState === "aborted") {
        renderOutput("[aborted]");
      } else if (terminalState === "error") {
        renderOutput("[error] request failed");
      } else {
        renderOutput("[no output]");
      }
    }
    if (timeoutTimer !== null) {
      window.clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
    const separator = document.createElement("div");
    separator.className = "turn-separator";
    appendBeforeInput(terminal, separator);
    unsubscribe();
  };

  const pumpTypewriter = () => {
    if (typingTimer !== null) {
      return;
    }
    const tick = () => {
      if (renderedLength < targetText.length) {
        renderedLength += 1;
        renderOutput(targetText.slice(0, renderedLength));
        typingTimer = window.setTimeout(tick, randomTypeDelayMs());
        return;
      }
      typingTimer = null;
      maybeFinalize();
    };
    tick();
  };

  const mergeIncomingText = (incoming: string, state: "delta" | "final") => {
    if (!incoming) {
      return;
    }

    if (!targetText) {
      targetText = incoming;
    } else if (incoming === targetText) {
      // Ignore exact duplicate payloads.
    } else if (incoming.startsWith(targetText)) {
      targetText = incoming;
    } else if (state === "delta" && !targetText.startsWith(incoming)) {
      // Some streams send chunk deltas instead of cumulative text.
      targetText += incoming;
    } else if (state === "final" && targetText.startsWith(incoming)) {
      // Keep the longer already-streamed body.
    } else {
      targetText = incoming;
    }

    if (renderedLength > targetText.length) {
      renderedLength = targetText.length;
    }
    hideSpinner();
    pumpTypewriter();
  };

  const unsubscribe = gatewayClient.onEvent((event) => {
    if (closed || event.runId !== runId) {
      return;
    }
    if (typeof event.seq === "number") {
      if (event.seq <= seq) {
        return;
      }
      seq = event.seq;
    }

    if (event.state === "delta") {
      mergeIncomingText(event.text, "delta");
      return;
    }

    terminalState = event.state;
    mergeIncomingText(event.text, "final");
    maybeFinalize();
  });

  timeoutTimer = window.setTimeout(() => {
    if (closed) {
      return;
    }
    terminalState = "error";
    mergeIncomingText(
      `[timeout] no response received within ${CHAT_TIMEOUT_SECONDS}s`,
      "final",
    );
    maybeFinalize();
  }, CHAT_TIMEOUT_MS);

  try {
    await gatewayClient.sendMessage(currentSessionKey, content, { idempotencyKey: runId });
  } catch (err) {
    terminalState = "error";
    mergeIncomingText(`[error] ${String(err)}`, "final");
    maybeFinalize();
  }
}

/**
 * Handle context commands.
 */
async function handleContextCommand(
  terminal: HTMLElement,
  args: string[],
  writeLine: (terminal: HTMLElement, text: string, className?: string) => void,
  writeHtml: (terminal: HTMLElement, html: string, className?: string) => void,
): Promise<void> {
  const action = args[0] || "summary";

  switch (action) {
    case "list": {
      await handleContextList(terminal, writeLine, writeHtml);
      break;
    }
    case "search": {
      if (args.length < 2) {
        writeLine(terminal, "Usage: /context search <query>");
      } else {
        await handleContextSearch(terminal, args.slice(1).join(" "), writeLine, writeHtml);
      }
      break;
    }
    case "load": {
      await handleContextLoad(terminal, args.slice(1), writeLine, writeHtml);
      break;
    }
    case "clear": {
      try {
        await window.terminalAPI.contextClear();
        writeHtml(terminal, "<span class='system-ok'>[ok] Context cache cleared</span>");
      } catch (err) {
        writeHtml(terminal, `<span class='system-error'>Error: ${escapeHtml(String(err))}</span>`);
      }
      break;
    }
    case "summary": {
      await handleContextSummary(terminal, writeLine, writeHtml);
      break;
    }
    default: {
      writeHtml(
        terminal,
        `<span class="system-warn">Unknown context action: ${escapeHtml(action)}</span>`,
      );
      writeLine(terminal, "Available actions: list, search, load, clear, summary");
    }
  }
}

/**
 * Handle context list command.
 */
async function handleContextList(
  terminal: HTMLElement,
  writeLine: (terminal: HTMLElement, text: string, className?: string) => void,
  writeHtml: (terminal: HTMLElement, html: string, className?: string) => void,
): Promise<void> {
  try {
    const result = await window.terminalAPI.contextList();

    if (!result || typeof result !== "object") {
      writeHtml(terminal, "<span class='system-error'>Failed to load context</span>");
      return;
    }

    writeHtml(terminal, "<span class='system-ok'><strong>Loaded Context</strong></span>");
    writeLine(terminal, "");

    const sections = [
      { key: "customers", label: "Customers", icon: "👤" },
      { key: "projects", label: "Projects", icon: "📁" },
      { key: "meetings", label: "Meetings", icon: "📅" },
      { key: "decisions", label: "Decisions", icon: "🔀" },
      { key: "patterns", label: "Patterns", icon: "🧩" },
    ];

    for (const section of sections) {
      const items = result[section.key as keyof typeof result];
      const count = Array.isArray(items) ? items.length : 0;

      if (count > 0) {
        writeHtml(terminal, `<span class="system-info">${section.icon} ${section.label}: ${count}</span>`);
      }
    }

    writeLine(terminal, "");
    writeHtml(
      terminal,
      `<span class="system-muted">Use /context search <query> to find specific items</span>`,
    );
  } catch (err) {
    writeHtml(terminal, `<span class='system-error'>Error: ${escapeHtml(String(err))}</span>`);
  }
}

/**
 * Handle context search command.
 */
async function handleContextSearch(
  terminal: HTMLElement,
  query: string,
  writeLine: (terminal: HTMLElement, text: string, className?: string) => void,
  writeHtml: (terminal: HTMLElement, html: string, className?: string) => void,
): Promise<void> {
  try {
    const result = await window.terminalAPI.contextSearch(query);

    if (!result || typeof result !== "object") {
      writeHtml(terminal, "<span class='system-error'>Search failed</span>");
      return;
    }

    writeHtml(terminal, `<span class='system-ok'><strong>Search Results: "${escapeHtml(query)}"</strong></span>`);
    writeLine(terminal, "");

    let totalResults = 0;

    const sections = [
      { key: "customers", label: "Customers", icon: "👤" },
      { key: "projects", label: "Projects", icon: "📁" },
      { key: "meetings", label: "Meetings", icon: "📅" },
      { key: "decisions", label: "Decisions", icon: "🔀" },
      { key: "patterns", label: "Patterns", icon: "🧩" },
    ];

    for (const section of sections) {
      const items = result[section.key as keyof typeof result];
      if (Array.isArray(items) && items.length > 0) {
        writeHtml(terminal, `<span class="system-info">${section.icon} ${section.label}</span>`);
        for (const item of items.slice(0, 5)) {
          const itemRecord = item as Record<string, unknown>;
          const name =
            (typeof itemRecord.name === "string" && itemRecord.name) ||
            (typeof itemRecord.title === "string" && itemRecord.title) ||
            (typeof itemRecord.description === "string" && itemRecord.description) ||
            "Unknown";
          const scoreValue =
            typeof itemRecord.score === "number" && Number.isFinite(itemRecord.score)
              ? itemRecord.score
              : null;
          const score = scoreValue === null ? "" : ` (${Math.round(scoreValue * 10) / 10})`;
          writeHtml(terminal, `  <span class="system-muted">•</span> ${escapeHtml(name)}${score}`);
        }
        if (items.length > 5) {
          writeLine(terminal, `  ... and ${items.length - 5} more`);
        }
        writeLine(terminal, "");
        totalResults += items.length;
      }
    }

    if (totalResults === 0) {
      writeHtml(terminal, `<span class="system-muted">No results found</span>`);
    }
  } catch (err) {
    writeHtml(terminal, `<span class='system-error'>Error: ${escapeHtml(String(err))}</span>`);
  }
}

/**
 * Handle context load command.
 */
async function handleContextLoad(
  terminal: HTMLElement,
  args: string[],
  writeLine: (terminal: HTMLElement, text: string, className?: string) => void,
  writeHtml: (terminal: HTMLElement, html: string, className?: string) => void,
): Promise<void> {
  const vaultPath = args[0];

  writeLine(terminal, "Loading context from Obsidian...");

  try {
    const result = await window.terminalAPI.contextLoad(vaultPath || "");

    if (result.success) {
      writeHtml(
        terminal,
        `<span class='system-ok'>[ok] Context loaded: ${result.summary || "Unknown"}</span>`,
      );
    } else {
      writeHtml(
        terminal,
        `<span class='system-error'>Failed to load context: ${escapeHtml(result.error || "Unknown error")}</span>`,
      );
    }
  } catch (err) {
    writeHtml(terminal, `<span class='system-error'>Error: ${escapeHtml(String(err))}</span>`);
  }
}

/**
 * Handle context summary command.
 */
async function handleContextSummary(
  terminal: HTMLElement,
  writeLine: (terminal: HTMLElement, text: string, className?: string) => void,
  writeHtml: (terminal: HTMLElement, html: string, className?: string) => void,
): Promise<void> {
  try {
    const summary = await window.terminalAPI.contextSummary();

    if (!summary || typeof summary !== "object") {
      writeHtml(terminal, "<span class='system-error'>Failed to get summary</span>");
      return;
    }

    writeHtml(terminal, "<span class='system-ok'><strong>Context Summary</strong></span>");
    writeLine(terminal, "");

    const lines = [
      `Customers: ${summary.customers ?? 0}`,
      `Projects: ${summary.projects ?? 0}`,
      `Meetings: ${summary.meetings ?? 0}`,
      `Decisions: ${summary.decisions ?? 0}`,
      `Patterns: ${summary.patterns ?? 0}`,
    ];

    for (const line of lines) {
      writeLine(terminal, line);
    }

    if (summary.lastSyncAt) {
      writeLine(terminal, "");
      writeLine(terminal, `Last Sync: ${summary.lastSyncAt}`);
    }
  } catch (err) {
    writeHtml(terminal, `<span class='system-error'>Error: ${escapeHtml(String(err))}</span>`);
  }
}

/**
 * Handle review commands.
 */
async function handleReviewCommand(
  terminal: HTMLElement,
  args: string[],
  writeLine: (terminal: HTMLElement, text: string) => void,
  writeHtml: (terminal: HTMLElement, html: string) => void,
): Promise<void> {
  const action = args[0] || "help";

  switch (action) {
    case "help": {
      writeHtml(terminal, `
<span class="system-ok"><strong>Code Review Commands</strong></span>

<span class="system-info">Usage:</span>
  /review diff [--branch <name>] - Review current git diff
  /review status               - Show review system status

<span class="system-info">Options:</span>
  --branch <name>   Compare against specific branch (default: main)

<span class="system-info">Examples:</span>
  /review diff
  /review diff --branch develop
      `.trim());
      break;
    }

    case "diff": {
      // Parse options
      const options: { branch?: string } = {};
      for (let i = 1; i < args.length; i++) {
        if (args[i] === "--branch" && i + 1 < args.length) {
          options.branch = args[++i];
        }
      }

      writeSection(terminal, "Code Review", "[review]", writeHtml);
      writeLine(terminal, `Analyzing changes${options.branch ? ` against ${options.branch}` : ""}...`);

      if (!hasOrchestralAPI()) {
        writeHtml(terminal, `<span class="system-error">[err] Review API not available</span>`);
        break;
      }

      try {
        const result = await window.terminalAPI.reviewDiff?.(options);

        if (result?.success && result.review) {
          writeLine(terminal, "");

          // Show summary
          const { review } = result;
          const statusIcon = review.allPassed ? "✓" : "✗";
          const statusClass = review.allPassed ? "system-ok" : "system-error";

          writeHtml(
            terminal,
            `<span class="${statusClass}">${statusIcon} ${review.summary}</span>`,
          );

          // Show model results
          for (const modelResult of review.results) {
            const passedIcon = modelResult.passed ? "✓" : "✗";
            const passedClass = modelResult.passed ? "system-ok" : "system-error";

            writeLine(terminal, "");
            writeHtml(
              terminal,
              `<span style="color: var(--accent-cyan);">${passedIcon} ${modelResult.model.toUpperCase()} (${modelResult.duration}ms)</span>`,
            );
            writeLine(terminal, `  ${modelResult.summary}`);

            // Show comments (limited)
            if (modelResult.comments.length > 0) {
              for (const comment of modelResult.comments.slice(0, 3)) {
                const severityIcon = {
                  error: "🔴",
                  warning: "🟡",
                  info: "🔵",
                  suggestion: "💡",
                }[comment.severity] || "•";

                writeHtml(
                  terminal,
                  `<span style="color: var(--text-muted);">  ${severityIcon} ${comment.file}:${comment.line || "?"} - ${escapeHtml(comment.message)}</span>`,
                );
                if (comment.suggestion) {
                  writeHtml(
                    terminal,
                    `<span style="color: var(--text-muted);">     → ${escapeHtml(comment.suggestion)}</span>`,
                  );
                }
              }
              if (modelResult.comments.length > 3) {
                writeHtml(
                  terminal,
                  `<span style="color: var(--text-muted);">  ... and ${modelResult.comments.length - 3} more</span>`,
                );
              }
            }
          }

          writeLine(terminal, "");
          writeHtml(
            terminal,
            `<span class="${statusClass}">Status: ${review.allPassed ? "PASSED" : "NEEDS CHANGES"}</span>`,
          );
        } else {
          writeHtml(
            terminal,
            `<span class="system-error">[err] ${result?.error || "Review failed"}</span>`,
          );
        }
      } catch (err) {
        console.error("[Review] Error:", err);
        writeHtml(
          terminal,
          `<span class="system-error">[err] Error: ${escapeHtml(String(err))}</span>`,
        );
      }
      break;
    }

    case "status": {
      writeHtml(terminal, `<span class="system-ok"><strong>Code Review Status</strong></span>`);
      writeLine(terminal, "");
      writeHtml(terminal, `<span class="system-info">Review Models:</span>`);
      writeLine(terminal, "  ✓ Codex - Edge cases, logic errors");
      writeLine(terminal, "  ✓ Gemini - Security, performance");
      writeLine(terminal, "  ✓ Claude - Architecture, maintainability");
      writeLine(terminal, "");
      writeHtml(terminal, `<span class="system-ok">Status: Ready</span>`);
      writeHtml(terminal, `<span class="system-info">Use /review diff to review current changes</span>`);
      break;
    }

    default: {
      writeHtml(terminal, `<span class="system-info">Usage: /review [help|diff|status]</span>`);
    }
  }
}

/**
 * Handle PR commands.
 */
async function handlePRCommand(
  terminal: HTMLElement,
  args: string[],
  writeLine: (terminal: HTMLElement, text: string) => void,
  writeHtml: (terminal: HTMLElement, html: string) => void,
): Promise<void> {
  const action = args[0] || "help";

  switch (action) {
    case "help": {
      writeHtml(terminal, `
<span class="system-ok"><strong>PR Commands</strong></span>

<span class="system-info">Usage:</span>
  /pr create <title> [--draft] [--base <branch>] - Create a PR
  /pr list - List open PRs
  /pr status - Show current branch status
  /pr view <number> - View PR details

<span class="system-info">Options:</span>
  --draft      Create as draft PR
  --base <name> Target branch (default: main)

<span class="system-info">Examples:</span>
  /pr create "Fix login bug"
  /pr create "Add feature" --draft --base develop
  /pr list
      `.trim());
      break;
    }

    case "create": {
      const title = args[1];
      if (!title) {
        writeHtml(terminal, `<span class="system-info">Usage: /pr create &lt;title&gt; [--draft] [--base &lt;branch&gt;]</span>`);
        break;
      }

      const options: { draft?: boolean; baseBranch?: string } = {};
      for (let i = 2; i < args.length; i++) {
        if (args[i] === "--draft") options.draft = true;
        if (args[i] === "--base" && i + 1 < args.length) options.baseBranch = args[++i];
      }

      writeSection(terminal, "Creating PR", "[pr]", writeHtml);
      writeLine(terminal, `Title: ${title}`);
      writeLine(terminal, `Base: ${options.baseBranch || "main"}`);
      if (options.draft) writeLine(terminal, `Mode: draft`);
      writeLine(terminal, "");

      if (!hasOrchestralAPI()) {
        writeHtml(terminal, `<span class="system-error">[err] PR API not available</span>`);
        break;
      }

      try {
        writeHtml(terminal, `<span style="color: var(--text-muted);">Checking git status...</span>`);

        const result = await window.terminalAPI.prCreate?.({
          title,
          description: `## Summary\n\n${title}\n\n---\n\n*Created via CyDeck Terminal*`,
          draft: options.draft,
          baseBranch: options.baseBranch,
        });

        if (result?.success && result.prUrl) {
          writeHtml(terminal, `<span class="system-ok">[ok] PR created successfully!</span>`);
          writeLine(terminal, "");
          writeHtml(terminal, `<span style="color: var(--accent-cyan);">PR #${result.prNumber}: ${escapeHtml(title)}</span>`);
          writeHtml(terminal, `<span style="color: var(--text-primary);">  ${result.prUrl}</span>`);
        } else {
          writeHtml(terminal, `<span class="system-error">[err] ${result?.error || "Failed to create PR"}</span>`);
        }
      } catch (err) {
        console.error("[PR] Error:", err);
        writeHtml(terminal, `<span class="system-error">[err] Error: ${escapeHtml(String(err))}</span>`);
      }
      break;
    }

    case "list": {
      writeSection(terminal, "Open PRs", "[pr]", writeHtml);

      if (!hasOrchestralAPI()) {
        writeHtml(terminal, `<span class="system-error">[err] PR API not available</span>`);
        break;
      }

      try {
        const result = await window.terminalAPI.prList?.();

        if (result?.prs && result.prs.length > 0) {
          for (const pr of result.prs) {
            writeLine(terminal, "");
            const statusIcon = pr.state === "OPEN" ? "🟢" : "⚪";
            writeHtml(terminal, `<span style="color: var(--accent-cyan);">${statusIcon} #${pr.number} ${escapeHtml(pr.title)}</span>`);
            writeHtml(terminal, `<span style="color: var(--text-muted);">  by ${pr.author}</span>`);
            writeHtml(terminal, `<span style="color: var(--text-muted);">  ${pr.url}</span>`);
          }
          writeLine(terminal, "");
          writeHtml(terminal, `<span class="system-info">Total: ${result.prs.length} open PR(s)</span>`);
        } else {
          writeLine(terminal, "No open PRs found.");
        }
      } catch (err) {
        console.error("[PR] Error:", err);
        writeHtml(terminal, `<span class="system-error">[err] Error: ${escapeHtml(String(err))}</span>`);
      }
      break;
    }

    case "status": {
      writeSection(terminal, "Git Status", "[git]", writeHtml);

      if (!hasOrchestralAPI()) {
        writeHtml(terminal, `<span class="system-error">[err] Git API not available</span>`);
        break;
      }

      try {
        const result = await window.terminalAPI.gitStatus?.();

        if (result?.branch) {
          writeLine(terminal, `Branch: ${result.branch}`);
        }

        if (result?.hasChanges) {
          writeLine(terminal, "");
          writeHtml(terminal, `<span style="color: var(--accent-warn);">Changes detected:</span>`);

          if (result.staged && result.staged.length > 0) {
            writeHtml(terminal, `<span style="color: var(--accent-green);">  Staged (${result.staged.length}):</span>`);
            for (const file of result.staged.slice(0, 5)) {
              writeHtml(terminal, `<span style="color: var(--text-muted);">    + ${escapeHtml(file)}</span>`);
            }
            if (result.staged.length > 5) {
              writeHtml(terminal, `<span style="color: var(--text-muted);">    ... and ${result.staged.length - 5} more</span>`);
            }
          }

          if (result.modified && result.modified.length > 0) {
            writeHtml(terminal, `<span style="color: var(--accent-yellow);">  Modified (${result.modified.length}):</span>`);
            for (const file of result.modified.slice(0, 5)) {
              writeHtml(terminal, `<span style="color: var(--text-muted);">    ~ ${escapeHtml(file)}</span>`);
            }
            if (result.modified.length > 5) {
              writeHtml(terminal, `<span style="color: var(--text-muted);">    ... and ${result.modified.length - 5} more</span>`);
            }
          }

          if (result.untracked && result.untracked.length > 0) {
            writeHtml(terminal, `<span style="color: var(--accent-cyan);">  Untracked (${result.untracked.length}):</span>`);
            for (const file of result.untracked.slice(0, 5)) {
              writeHtml(terminal, `<span style="color: var(--text-muted);">    ? ${escapeHtml(file)}</span>`);
            }
            if (result.untracked.length > 5) {
              writeHtml(terminal, `<span style="color: var(--text-muted);">    ... and ${result.untracked.length - 5} more</span>`);
            }
          }

          writeLine(terminal, "");
          writeHtml(terminal, `<span class="system-info">Use /pr create to create a PR after committing</span>`);
        } else {
          writeHtml(terminal, `<span class="system-ok">[ok] Working directory clean</span>`);
        }
      } catch (err) {
        console.error("[Git] Error:", err);
        writeHtml(terminal, `<span class="system-error">[err] Error: ${escapeHtml(String(err))}</span>`);
      }
      break;
    }

    case "view": {
      const prNumber = parseInt(args[1], 10);
      if (!prNumber) {
        writeHtml(terminal, `<span class="system-info">Usage: /pr view &lt;number&gt;</span>`);
        break;
      }

      writeSection(terminal, `PR #${prNumber}`, "[pr]", writeHtml);

      if (!hasOrchestralAPI()) {
        writeHtml(terminal, `<span class="system-error">[err] PR API not available</span>`);
        break;
      }

      try {
        const result = await window.terminalAPI.prView?.(prNumber);

        if (result?.pr) {
          const { pr } = result;
          writeLine(terminal, "");
          writeHtml(terminal, `<span style="color: var(--accent-cyan);">${escapeHtml(pr.title)}</span>`);
          writeLine(terminal, "");
          writeHtml(terminal, `<span style="color: var(--text-muted);">${escapeHtml(pr.body?.slice(0, 500) || "")}${pr.body?.length > 500 ? "..." : ""}</span>`);
          writeLine(terminal, "");
          writeHtml(terminal, `<span style="color: var(--text-muted);">State: ${pr.state}</span>`);
          writeHtml(terminal, `<span style="color: var(--text-muted);">Mergeable: ${pr.mergeable ? "Yes" : "No"}</span>`);
          writeHtml(terminal, `<span style="color: var(--accent-cyan);">${pr.url}</span>`);
        } else {
          writeHtml(terminal, `<span class="system-error">[err] PR not found</span>`);
        }
      } catch (err) {
        console.error("[PR] Error:", err);
        writeHtml(terminal, `<span class="system-error">[err] Error: ${escapeHtml(String(err))}</span>`);
      }
      break;
    }

    default: {
      writeHtml(terminal, `<span class="system-info">Usage: /pr [help|create|list|status|view]</span>`);
    }
  }
}

/**
 * Handle pattern commands.
 */
async function handlePatternCommand(
  terminal: HTMLElement,
  args: string[],
  writeLine: (terminal: HTMLElement, text: string) => void,
  writeHtml: (terminal: HTMLElement, html: string) => void,
): Promise<void> {
  const action = args[0] || "list";

  switch (action) {
    case "list": {
      writeSection(terminal, "Patterns", "[pattern]", writeHtml);
      writeLine(terminal, "Fetching patterns...");

      try {
        const result = await window.terminalAPI.patternList?.();

        if (result?.patterns && result.patterns.length > 0) {
          for (const pattern of result.patterns) {
            writeLine(terminal, "");
            const categoryIcon = getCategoryIcon(pattern.category);
            writeHtml(terminal, `<span class="system-ok">${categoryIcon} ${pattern.name}</span>`);
            writeLine(terminal, `  Category: ${pattern.category}`);
            if (pattern.description) {
              writeHtml(terminal, `<span style="color: var(--text-muted);">  ${escapeHtml(pattern.description)}</span>`);
            }
            if (pattern.effectiveness !== undefined) {
              const effPercent = Math.round(pattern.effectiveness * 100);
              const effColor = pattern.effectiveness > 0.7 ? "var(--accent-prompt)" : "var(--text-muted)";
              writeHtml(terminal, `<span style="color: ${effColor};">  Effectiveness: ${effPercent}%</span>`);
            }
            if (pattern.usageCount !== undefined) {
              writeLine(terminal, `  Used: ${pattern.usageCount} time(s)`);
            }
          }
          writeLine(terminal, "");
          writeHtml(terminal, `<span class="system-info">Total: ${result.patterns.length} pattern(s)</span>`);
        } else {
          writeHtml(terminal, `<span class="system-muted">No patterns found. Use /pattern save to create one.</span>`);
        }
      } catch (err) {
        writeHtml(terminal, `<span class='system-error'>Error: ${escapeHtml(String(err))}</span>`);
      }
      break;
    }

    case "save": {
      if (args.length < 2) {
        writeHtml(terminal, `<span class="system-info">Usage: /pattern save &lt;name&gt; &lt;category&gt; &lt;prompt&gt;</span>`);
        writeLine(terminal, "");
        writeHtml(terminal, `<span class="system-muted">Categories: coding, debugging, architecture, communication, other</span>`);
        break;
      }

      const name = args[1];
      const category = args[2] || "other";
      const validCategories = ["coding", "debugging", "architecture", "communication", "other"];

      if (!validCategories.includes(category)) {
        writeHtml(terminal, `<span class="system-error">Invalid category: ${escapeHtml(category)}</span>`);
        writeHtml(terminal, `<span class="system-muted">Valid categories: ${validCategories.join(", ")}</span>`);
        break;
      }

      // Check if user is providing a multi-word prompt
      const promptParts = args.slice(3);
      if (promptParts.length === 0) {
        writeHtml(terminal, `<span class="system-error">Error: Prompt text is required</span>`);
        break;
      }

      const prompt = promptParts.join(" ");
      const description = await promptForDescription(terminal);

      writeLine(terminal, "");
      writeSection(terminal, "Saving Pattern", "[pattern]", writeHtml);
      writeLine(terminal, `Name: ${name}`);
      writeLine(terminal, `Category: ${category}`);
      writeLine(terminal, `Prompt: ${prompt.slice(0, 100)}${prompt.length > 100 ? "..." : ""}`);

      try {
        const result = await window.terminalAPI.patternSave?.({
          name,
          category,
          description: description || "",
          prompt,
        });

        if (result?.success) {
          writeHtml(terminal, `<span class="system-ok">[ok] Pattern saved with ID: ${result.id || "unknown"}</span>`);
        } else {
          writeHtml(terminal, `<span class='system-error'>[err] Failed: ${result.error || "Unknown error"}</span>`);
        }
      } catch (err) {
        writeHtml(terminal, `<span class='system-error'>Error: ${escapeHtml(String(err))}</span>`);
      }
      break;
    }

    case "apply": {
      if (args.length < 2) {
        writeHtml(terminal, `<span class="system-info">Usage: /pattern apply &lt;pattern-id-or-name&gt; &lt;task-description&gt;</span>`);
        break;
      }

      const patternRef = args[1];
      const taskDesc = args.slice(2).join(" ");

      if (!taskDesc) {
        writeHtml(terminal, `<span class="system-error">Error: Task description is required</span>`);
        break;
      }

      writeLine(terminal, "");
      writeSection(terminal, "Applying Pattern", "[pattern]", writeHtml);
      writeLine(terminal, `Pattern: ${patternRef}`);
      writeLine(terminal, `Task: ${taskDesc}`);

      try {
        const result = await window.terminalAPI.patternApply?.(patternRef, taskDesc);

        if (result?.success) {
          writeHtml(terminal, `<span class="system-ok">[ok] Pattern applied</span>`);
          if (result.enhancedPrompt) {
            writeLine(terminal, "");
            writeHtml(terminal, `<span class="system-info">Enhanced Prompt:</span>`);
            writeHtml(terminal, `<span style="color: var(--text-primary);">${escapeHtml(result.enhancedPrompt.slice(0, 500))}</span>`);
          }
        } else {
          writeHtml(terminal, `<span class='system-error'>[err] Failed: ${result.error || "Pattern not found"}</span>`);
        }
      } catch (err) {
        writeHtml(terminal, `<span class='system-error'>Error: ${escapeHtml(String(err))}</span>`);
      }
      break;
    }

    case "rate": {
      if (args.length < 2) {
        writeHtml(terminal, `<span class="system-info">Usage: /pattern rate &lt;pattern-id&gt; &lt;success|fail&gt;</span>`);
        break;
      }

      const patternId = args[1];
      const success = args[2]?.toLowerCase() === "success";

      writeLine(terminal, `Rating pattern ${patternId} as ${success ? "successful" : "failed"}...`);

      try {
        const result = await window.terminalAPI.patternRate?.(patternId, success);

        if (result?.success) {
          writeHtml(terminal, `<span class="system-ok">[ok] Pattern effectiveness updated</span>`);
        } else {
          writeHtml(terminal, `<span class='system-error'>[err] Failed: ${result.error || "Unknown error"}</span>`);
        }
      } catch (err) {
        writeHtml(terminal, `<span class='system-error'>Error: ${escapeHtml(String(err))}</span>`);
      }
      break;
    }

    case "help": {
      writeHtml(terminal, `
<span class="system-ok"><strong>Pattern Commands</strong></span>

<span class="system-info">Usage:</span>
  /pattern list                    - List all saved patterns
  /pattern save &lt;name&gt; &lt;cat&gt;    - Save a new pattern
  /pattern apply &lt;id&gt; &lt;task&gt;    - Apply pattern to task
  /pattern rate &lt;id&gt; &lt;success|fail&gt; - Rate pattern effectiveness

<span class="system-info">Categories:</span>
  coding, debugging, architecture, communication, other

<span class="system-info">Examples:</span>
  /pattern save BugFixTemplate coding "First understand expected behavior..."
  /pattern apply BugFixTemplate "Fix login crash"
  /pattern rate pattern-123 success

<span class="system-info">About:</span>
Patterns are reusable prompt templates that have proven effective.
Track effectiveness to build your personal prompt library.
      `.trim());
      break;
    }

    default:
      writeHtml(terminal, `<span class="system-info">Usage: /pattern [list|save|apply|rate|help]</span>`);
      break;
  }
}

function getCategoryIcon(category: string): string {
  const icons: Record<string, string> = {
    coding: "💻",
    debugging: "🐛",
    architecture: "🏗️",
    communication: "💬",
    other: "📝",
  };
  return icons[category] || "📝";
}

async function promptForDescription(terminal: HTMLElement): Promise<string> {
  // For now, return empty - in a full implementation this could prompt user interactively
  return "";
}

type WriteHtmlFn = (terminal: HTMLElement, html: string, className?: string) => void;

function writeSection(terminal: HTMLElement, title: string, icon: string, writeHtml: WriteHtmlFn): void {
  writeHtml(
    terminal,
    `<span style="color: var(--accent-cyan); font-weight: bold;">${icon} ${title}</span>`,
  );
}

// Check if orchestral API is available
function hasOrchestralAPI(): boolean {
  return typeof window.terminalAPI?.reviewDiff === "function" ||
         typeof window.terminalAPI?.patternList === "function" ||
         typeof window.terminalAPI?.orchestralSpawn === "function";
}

/**
 * Handle workflow commands.
 */
async function handleWorkflowCommand(
  terminal: HTMLElement,
  args: string[],
  writeLine: (terminal: HTMLElement, text: string) => void,
  writeHtml: (terminal: HTMLElement, html: string) => void,
): Promise<void> {
  const action = args[0] || "list";

  switch (action) {
    case "help": {
      writeHtml(terminal, `
<span class="system-ok"><strong>Workflow Commands</strong></span>

<span class="system-info">Usage:</span>
  /workflow list - List all workflows
  /workflow create <name> - Create a new workflow (interactive)
  /workflow run <name> - Execute a workflow
  /workflow show <name> - Show workflow details
  /workflow delete <name> - Delete a workflow

<span class="system-info">Examples:</span>
  /workflow create "Build and Test"
  /workflow run "Build and Test"
  /workflow show "Build and Test"
      `.trim());
      break;
    }

    case "list": {
      writeSection(terminal, "Workflows", "[workflow]", writeHtml);

      if (!hasOrchestralAPI()) {
        writeHtml(terminal, `<span class="system-error">[err] Workflow API not available</span>`);
        break;
      }

      try {
        const result = await window.terminalAPI.workflowList?.();

        if (result?.workflows && result.workflows.length > 0) {
          for (const wf of result.workflows) {
            writeLine(terminal, "");
            writeHtml(terminal, `<span style="color: var(--accent-cyan);">${escapeHtml(wf.name)}</span>`);
            if (wf.description) {
              writeHtml(terminal, `<span style="color: var(--text-muted);">  ${escapeHtml(wf.description)}</span>`);
            }
            writeHtml(terminal, `<span style="color: var(--text-muted);">  Steps: ${wf.steps.length} | Runs: ${wf.runCount}</span>`);
          }
          writeLine(terminal, "");
          writeHtml(terminal, `<span class="system-info">Total: ${result.workflows.length} workflow(s)</span>`);
        } else {
          writeLine(terminal, "No workflows found.");
          writeHtml(terminal, `<span class="system-info">Use /workflow create to create one</span>`);
        }
      } catch (err) {
        console.error("[Workflow] Error:", err);
        writeHtml(terminal, `<span class="system-error">[err] Error: ${escapeHtml(String(err))}</span>`);
      }
      break;
    }

    case "create": {
      const name = args[1];
      if (!name) {
        writeHtml(terminal, `<span class="system-info">Usage: /workflow create &lt;name&gt; &lt;step1&gt; [&lt;step2&gt; ...]</span>`);
        writeLine(terminal, "");
        writeHtml(terminal, `<span class="system-muted">Steps format:</span>`);
        writeHtml(terminal, `<span style="color: var(--text-muted);">  /command - terminal command</span>`);
        writeHtml(terminal, `<span style="color: var(--text-muted);">  /spawn &lt;desc&gt; - spawn agent</span>`);
        writeHtml(terminal, `<span style="color: var(--text-muted);">  /delay &lt;ms&gt; - wait before next step</span>`);
        break;
      }

      const steps = args.slice(2);
      if (steps.length === 0) {
        writeHtml(terminal, `<span class="system-warn">[warn] No steps provided. Workflow will be empty.</span>`);
      }

      writeSection(terminal, "Creating Workflow", "[workflow]", writeHtml);
      writeLine(terminal, `Name: ${name}`);
      writeLine(terminal, `Steps: ${steps.length}`);

      if (!hasOrchestralAPI()) {
        writeHtml(terminal, `<span class="system-error">[err] Workflow API not available</span>`);
        break;
      }

      try {
        // Parse steps
        const workflowSteps = steps.map((step, i) => {
          if (step.startsWith("/spawn ")) {
            return {
              id: `step-${i}`,
              type: "spawn" as const,
              command: step.slice(7),
              description: `Spawn: ${step.slice(7)}`,
            };
          } else if (step.startsWith("/delay ")) {
            const ms = parseInt(step.slice(7), 10);
            return {
              id: `step-${i}`,
              type: "delay" as const,
              command: ms.toString(),
              description: `Delay: ${ms}ms`,
              timeout: ms,
            };
          } else {
            return {
              id: `step-${i}`,
              type: "command" as const,
              command: step.startsWith("/") ? step.slice(1) : step,
              description: `Command: ${step}`,
            };
          }
        });

        const result = await window.terminalAPI.workflowCreate?.({
          name,
          description: `Auto-created workflow`,
          steps: workflowSteps,
          tags: ["user-created"],
        });

        if (result?.success) {
          writeHtml(terminal, `<span class="system-ok">[ok] Workflow created: ${result.id}</span>`);
          writeHtml(terminal, `<span class="system-info">Use /workflow run "${name}" to execute</span>`);
        } else {
          writeHtml(terminal, `<span class="system-error">[err] ${result?.error || "Failed to create workflow"}</span>`);
        }
      } catch (err) {
        console.error("[Workflow] Error:", err);
        writeHtml(terminal, `<span class="system-error">[err] Error: ${escapeHtml(String(err))}</span>`);
      }
      break;
    }

    case "run": {
      const name = args[1];
      if (!name) {
        writeHtml(terminal, `<span class="system-info">Usage: /workflow run &lt;name&gt;</span>`);
        break;
      }

      writeSection(terminal, `Running Workflow: ${name}`, "[workflow]", writeHtml);

      if (!hasOrchestralAPI()) {
        writeHtml(terminal, `<span class="system-error">[err] Workflow API not available</span>`);
        break;
      }

      try {
        const result = await window.terminalAPI.workflowRun?.(name);

        if (result?.success && result.result) {
          writeLine(terminal, "");
          for (const stepResult of result.result) {
            const commandText =
              stepResult.step?.description || stepResult.step?.command || stepResult.step?.id || "step";
            writeHtml(terminal, `<span style="color: var(--text-muted);">  ${escapeHtml(commandText)}</span>`);
            if (stepResult.error) {
              writeHtml(
                terminal,
                `<span class="system-error">    failed: ${escapeHtml(stepResult.error)}</span>`,
              );
            }
          }
          writeLine(terminal, "");
          writeHtml(terminal, `<span class="system-info">Execute the steps above to complete the workflow</span>`);
        } else {
          writeHtml(terminal, `<span class="system-error">[err] ${result?.error || "Workflow not found"}</span>`);
        }
      } catch (err) {
        console.error("[Workflow] Error:", err);
        writeHtml(terminal, `<span class="system-error">[err] Error: ${escapeHtml(String(err))}</span>`);
      }
      break;
    }

    case "show": {
      const name = args[1];
      if (!name) {
        writeHtml(terminal, `<span class="system-info">Usage: /workflow show &lt;name&gt;</span>`);
        break;
      }

      writeSection(terminal, `Workflow: ${name}`, "[workflow]", writeHtml);

      if (!hasOrchestralAPI()) {
        writeHtml(terminal, `<span class="system-error">[err] Workflow API not available</span>`);
        break;
      }

      try {
        const result = await window.terminalAPI.workflowShow?.(name);

        if (result?.workflow) {
          const { workflow } = result;
          writeLine(terminal, "");
          if (workflow.description) {
            writeLine(terminal, workflow.description);
          }
          writeLine(terminal, "");
          writeHtml(terminal, `<span style="color: var(--accent-cyan);">Steps:</span>`);
          for (const step of workflow.steps) {
            writeHtml(terminal, `<span style="color: var(--text-primary);">  ${step.id}: ${escapeHtml(step.description || step.command)}</span>`);
          }
          writeLine(terminal, "");
          writeHtml(terminal, `<span style="color: var(--text-muted);">Runs: ${workflow.runCount} | Created: ${new Date(workflow.createdAt).toLocaleDateString()}</span>`);
        } else {
          writeHtml(terminal, `<span class="system-error">[err] Workflow not found</span>`);
        }
      } catch (err) {
        console.error("[Workflow] Error:", err);
        writeHtml(terminal, `<span class="system-error">[err] Error: ${escapeHtml(String(err))}</span>`);
      }
      break;
    }

    case "delete": {
      const name = args[1];
      if (!name) {
        writeHtml(terminal, `<span class="system-info">Usage: /workflow delete &lt;name&gt;</span>`);
        break;
      }

      if (!hasOrchestralAPI()) {
        writeHtml(terminal, `<span class="system-error">[err] Workflow API not available</span>`);
        break;
      }

      try {
        const result = await window.terminalAPI.workflowDelete?.(name);

        if (result?.success) {
          writeHtml(terminal, `<span class="system-ok">[ok] Workflow deleted: ${name}</span>`);
        } else {
          writeHtml(terminal, `<span class="system-error">[err] ${result?.error || "Failed to delete workflow"}</span>`);
        }
      } catch (err) {
        console.error("[Workflow] Error:", err);
        writeHtml(terminal, `<span class="system-error">[err] Error: ${escapeHtml(String(err))}</span>`);
      }
      break;
    }

    default: {
      writeHtml(terminal, `<span class="system-info">Usage: /workflow [help|list|create|run|show|delete]</span>`);
    }
  }
}

/**
 * Handle task commands.
 */
async function handleTaskCommand(
  terminal: HTMLElement,
  args: string[],
  writeLine: (terminal: HTMLElement, text: string) => void,
  writeHtml: (terminal: HTMLElement, html: string) => void,
): Promise<void> {
  const action = args[0] || "list";

  switch (action) {
    case "complete": {
      const taskId = args[1];
      const success = args[2]?.toLowerCase() === "success";
      const patternId = args[3];

      if (!taskId) {
        writeHtml(terminal, `<span class="system-info">Usage: /task complete &lt;task-id&gt; [success|fail] [pattern-id]</span>`);
        writeLine(terminal, "");
        writeHtml(terminal, `<span class="system-muted">Marks task as completed and updates pattern effectiveness</span>`);
        return;
      }

      writeLine(terminal, `Completing task ${taskId} as ${success ? "successful" : "failed"}...`);

      try {
        // If pattern was used, rate it
        if (patternId) {
          const rateResult = await window.terminalAPI.patternRate?.(patternId, success);
          if (rateResult?.success) {
            writeHtml(terminal, `<span class="system-ok">[ok] Pattern effectiveness updated</span>`);
          } else {
            writeHtml(terminal, `<span class="system-warn">[warn] Could not rate pattern: ${rateResult.error || "Unknown"}</span>`);
          }
        }

        const result = await window.terminalAPI.orchestralTasks?.(
          {
            taskId,
            success: success ? "true" : "false",
          },
          "complete",
        );

        if (!result?.success) {
          writeHtml(
            terminal,
            `<span class="system-error">[err] Failed to update task: ${escapeHtml(result?.error || "Unknown error")}</span>`,
          );
          return;
        }

        const status = success ? "completed" : "failed";
        writeHtml(terminal, `<span class="system-ok">[ok] Task ${taskId} marked as ${status}</span>`);
      } catch (err) {
        writeHtml(terminal, `<span class='system-error'>Error: ${escapeHtml(String(err))}</span>`);
      }
      break;
    }

    case "list": {
      await handleTasksCommand(terminal, [], writeLine, writeHtml);
      break;
    }

    case "status": {
      const taskId = args[1];
      if (!taskId) {
        writeHtml(terminal, `<span class="system-info">Usage: /task status &lt;task-id&gt;</span>`);
        return;
      }

      try {
        const result = await window.terminalAPI.orchestralTasks?.({});
        if (!result?.success || !Array.isArray(result.tasks)) {
          writeHtml(
            terminal,
            `<span class="system-error">[err] Failed to load tasks: ${escapeHtml(result?.error || "Unknown error")}</span>`,
          );
          return;
        }

        const task = result.tasks.find((entry: { id?: string }) => entry.id === taskId) as
          | {
              id: string;
              status: string;
              description?: string;
              agent?: string;
              startedAt?: number;
              completedAt?: number;
              exitCode?: number | null;
              failureReason?: string;
            }
          | undefined;

        if (!task) {
          writeHtml(terminal, `<span class="system-warn">[warn] Task not found: ${escapeHtml(taskId)}</span>`);
          return;
        }

        writeHtml(terminal, `<span class="system-ok"><strong>Task ${escapeHtml(task.id)}</strong></span>`);
        writeHtml(terminal, `<span class="system-info">Status: ${escapeHtml(task.status)}</span>`);
        if (task.description) {
          writeHtml(terminal, `<span class="system-info">Description: ${escapeHtml(task.description)}</span>`);
        }
        if (task.agent) {
          writeHtml(terminal, `<span class="system-info">Agent: ${escapeHtml(task.agent)}</span>`);
        }
        if (typeof task.startedAt === "number") {
          writeHtml(
            terminal,
            `<span class="system-info">Started: ${escapeHtml(new Date(task.startedAt).toLocaleString())}</span>`,
          );
        }
        if (typeof task.completedAt === "number") {
          writeHtml(
            terminal,
            `<span class="system-info">Completed: ${escapeHtml(new Date(task.completedAt).toLocaleString())}</span>`,
          );
        }
        if (typeof task.exitCode === "number") {
          writeHtml(terminal, `<span class="system-info">Exit Code: ${task.exitCode}</span>`);
        }
        if (task.failureReason) {
          writeHtml(terminal, `<span class="system-warn">Reason: ${escapeHtml(task.failureReason)}</span>`);
        }
      } catch (err) {
        writeHtml(terminal, `<span class='system-error'>Error: ${escapeHtml(String(err))}</span>`);
      }
      break;
    }

    case "help": {
      writeHtml(terminal, `
<span class="system-ok"><strong>Task Commands</strong></span>

<span class="system-info">Usage:</span>
  /task complete &lt;task-id&gt; [success|fail] [pattern-id]
      Mark task as complete and update pattern effectiveness
  /task list                   - Show all tasks
  /task status &lt;task-id&gt;       - Show task status

<span class="system-info">Examples:</span>
  /task complete task-123 success
  /task complete task-123 success pattern-456
      `.trim());
      break;
    }

    default:
      writeHtml(terminal, `<span class="system-info">Usage: /task [complete|list|status|help]</span>`);
      break;
  }
}

async function handleLandingCommand(
  terminal: HTMLElement,
  args: string[],
  _writeLine: (terminal: HTMLElement, text: string) => void,
  writeHtml: (terminal: HTMLElement, html: string) => void,
): Promise<void> {
  const action = (args[0] || "help").toLowerCase();

  const renderFiles = (files?: TerminalLandingFileStatus[]) => {
    if (!files || files.length === 0) {
      return;
    }
    for (const file of files) {
      const existsTag = file.exists ? "<span class=\"system-ok\">exists</span>" : "<span class=\"system-warn\">missing</span>";
      const configuredTag = file.configured
        ? "<span class=\"system-ok\">configured</span>"
        : "<span class=\"system-warn\">template</span>";
      writeHtml(
        terminal,
        `<span class="system-info">- ${escapeHtml(file.fileName)}: ${existsTag}, ${configuredTag}, ${file.bytes} bytes</span>`,
      );
    }
  };

  switch (action) {
    case "help": {
      writeHtml(
        terminal,
        `
<span class="system-ok"><strong>Landing Commands</strong></span>

<span class="system-info">Goal:</span>
  Bootstrap and configure SOUL.md / IDENTITY.md / USER.md / AGENTS.md / MEMORY.md

<span class="system-info">Usage:</span>
  /landing status
  /landing init
  /landing start
  /landing set &lt;key&gt; &lt;value&gt;
  /landing add &lt;agents|soul|memory&gt; &lt;text&gt;

<span class="system-info">Set keys:</span>
  identity.name
  identity.creature
  identity.vibe
  identity.emoji
  identity.avatar
  user.name
  user.preferredName
  user.pronouns
  user.timezone
  user.language

<span class="system-info">Examples:</span>
  /landing init
  /landing set identity.name Cydec
  /landing set user.timezone Asia/Shanghai
  /landing add soul Be direct and evidence-driven
  /landing add agents Ask before external side effects
  /landing add memory User prefers concise replies in Chinese
        `.trim(),
      );
      return;
    }

    case "status": {
      const result = await window.terminalAPI.landingStatus();
      if (!result.success) {
        writeHtml(terminal, `<span class="system-error">[err] ${escapeHtml(result.error || "Failed to load landing status")}</span>`);
        return;
      }
      writeSection(terminal, "Landing Status", "[landing]", writeHtml);
      writeHtml(terminal, `<span class="system-info">Workspace: ${escapeHtml(result.workspacePath)}</span>`);
      renderFiles(result.files);
      if (result.completed) {
        writeHtml(terminal, `<span class="system-ok">[ok] Landing is complete</span>`);
      } else {
        writeHtml(terminal, `<span class="system-warn">[warn] Landing is not complete. Run /landing start</span>`);
      }
      return;
    }

    case "init": {
      const result = await window.terminalAPI.landingInit();
      if (!result.success) {
        writeHtml(terminal, `<span class="system-error">[err] ${escapeHtml(result.error || "Failed to init landing files")}</span>`);
        return;
      }
      writeSection(terminal, "Landing Init", "[landing]", writeHtml);
      writeHtml(terminal, `<span class="system-info">Workspace: ${escapeHtml(result.workspacePath)}</span>`);
      const created = result.created ?? [];
      const existing = result.existing ?? [];
      writeHtml(terminal, `<span class="system-info">Created: ${escapeHtml(String(created.length))}</span>`);
      if (created.length > 0) {
        writeHtml(terminal, `<span class="system-info">  ${escapeHtml(created.join(", "))}</span>`);
      }
      writeHtml(terminal, `<span class="system-info">Existing: ${escapeHtml(String(existing.length))}</span>`);
      renderFiles(result.files);
      return;
    }

    case "start": {
      const result = await window.terminalAPI.landingInit();
      if (!result.success) {
        writeHtml(terminal, `<span class="system-error">[err] ${escapeHtml(result.error || "Failed to start landing setup")}</span>`);
        return;
      }
      writeSection(terminal, "Landing Wizard", "[landing]", writeHtml);
      writeHtml(terminal, `<span class="system-info">Workspace: ${escapeHtml(result.workspacePath)}</span>`);
      writeHtml(terminal, `<span class="system-info">Step 1: /landing set identity.name &lt;name&gt;</span>`);
      writeHtml(terminal, `<span class="system-info">Step 2: /landing set user.name &lt;name&gt;</span>`);
      writeHtml(terminal, `<span class="system-info">Step 3: /landing set user.timezone &lt;tz&gt;</span>`);
      writeHtml(terminal, `<span class="system-info">Step 4: /landing add soul &lt;principle&gt;</span>`);
      writeHtml(terminal, `<span class="system-info">Step 5: /landing add agents &lt;rule&gt;</span>`);
      writeHtml(terminal, `<span class="system-info">Step 6: /landing add memory &lt;long-term fact&gt;</span>`);
      writeHtml(terminal, `<span class="system-info">Then run: /landing status</span>`);
      return;
    }

    case "set": {
      const key = args[1];
      const value = args.slice(2).join(" ");
      if (!key || !value.trim()) {
        writeHtml(terminal, `<span class="system-info">Usage: /landing set &lt;key&gt; &lt;value&gt;</span>`);
        return;
      }
      const result = await window.terminalAPI.landingSet(key, value);
      if (!result.success) {
        writeHtml(terminal, `<span class="system-error">[err] ${escapeHtml(result.error || "Failed to set landing value")}</span>`);
        return;
      }
      writeHtml(
        terminal,
        `<span class="system-ok">[ok] ${escapeHtml(result.key || key)} = ${escapeHtml(result.value || value)}</span>`,
      );
      if (result.fileName) {
        writeHtml(terminal, `<span class="system-info">Updated: ${escapeHtml(result.fileName)}</span>`);
      }
      return;
    }

    case "add": {
      const target = args[1];
      const note = args.slice(2).join(" ");
      if (!target || !note.trim()) {
        writeHtml(terminal, `<span class="system-info">Usage: /landing add &lt;agents|soul|memory&gt; &lt;text&gt;</span>`);
        return;
      }
      const result = await window.terminalAPI.landingAdd(target, note);
      if (!result.success) {
        writeHtml(terminal, `<span class="system-error">[err] ${escapeHtml(result.error || "Failed to append landing note")}</span>`);
        return;
      }
      writeHtml(
        terminal,
        `<span class="system-ok">[ok] Added note to ${escapeHtml(result.fileName || target)}</span>`,
      );
      return;
    }

    default: {
      writeHtml(
        terminal,
        `<span class="system-warn">[warn] Unknown /landing action: ${escapeHtml(action)}</span>`,
      );
      writeHtml(terminal, `<span class="system-info">Use /landing help for usage.</span>`);
    }
  }
}

async function handleConfigCommand(
  terminal: HTMLElement,
  args: string[],
  writeLine: (terminal: HTMLElement, text: string) => void,
  writeHtml: (terminal: HTMLElement, html: string) => void,
): Promise<void> {
  const action = (args[0] || "show").toLowerCase();

  const asRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  };

  const redactSecret = (value: string): string => {
    if (!value.trim()) {
      return value;
    }
    if (value.includes("${")) {
      return value;
    }
    if (value.length <= 8) {
      return "********";
    }
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
  };

  const redactConfig = (value: unknown, keyHint = ""): unknown => {
    if (Array.isArray(value)) {
      return value.map((item) => redactConfig(item, keyHint));
    }
    const record = asRecord(value);
    if (record) {
      const next: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(record)) {
        next[key] = redactConfig(child, key);
      }
      return next;
    }
    if (typeof value === "string" && /(api[_-]?key|token|secret)/i.test(keyHint)) {
      return redactSecret(value);
    }
    return value;
  };

  const renderValidation = (validation?: TerminalConfigValidation, issues?: TerminalConfigIssue[]) => {
    if (!validation) {
      return;
    }

    if (validation.valid) {
      writeHtml(terminal, `<span class="system-ok">[ok] Config validation passed</span>`);
    } else {
      writeHtml(
        terminal,
        `<span class="system-error">[err] Config validation failed (${validation.errors.length} error(s))</span>`,
      );
    }

    const effectiveIssues = issues ?? validation.issues;
    for (const issue of effectiveIssues) {
      const cssClass = issue.severity === "error" ? "system-error" : "system-warn";
      const pathSuffix = issue.path ? ` (${issue.path})` : "";
      writeHtml(
        terminal,
        `<span class="${cssClass}">[${issue.severity}] ${escapeHtml(issue.message)}${escapeHtml(pathSuffix)}</span>`,
      );
    }
  };

  switch (action) {
    case "help": {
      writeHtml(
        terminal,
        `
<span class="system-ok"><strong>Config Commands</strong></span>

<span class="system-info">Usage:</span>
  /config show
  /config set &lt;key&gt; &lt;value&gt;
  /config apply
  /config validate
  /config reset
  /config path

<span class="system-info">Common keys:</span>
  ai.defaultProvider
  ai.providers.openai.apiKey
  ai.providers.openai.baseUrl
  ai.providers.openai.model
  ai.providers.openai.maxTokens
  ai.providers.google.apiKey
  ai.providers.google.baseUrl
  ai.providers.google.model
  ai.providers.google.maxTokens
  workspace.path
  workspace.autoCreate
  gateway.port
  gateway.autoStart
  ui.theme

<span class="system-info">Examples:</span>
  /config set gateway.port 19001
  /config set gateway.autoStart true
  /config set ai.defaultProvider google
  /config set ai.providers.google.model gemini-2.5-flash
  /config apply
  /config set workspace.path "./workspace"
      `.trim(),
      );
      return;
    }

    case "show": {
      const result = await window.terminalAPI.configGet();
      if (!result.success) {
        writeHtml(terminal, `<span class="system-error">[err] ${escapeHtml(result.error || "Failed to load config")}</span>`);
        return;
      }

      writeSection(terminal, "CyDeck Config", "[config]", writeHtml);
      writeHtml(terminal, `<span class="system-info">Path: ${escapeHtml(result.configPath)}</span>`);
      writeHtml(terminal, `<span class="system-info">State Dir: ${escapeHtml(result.stateDir)}</span>`);
      if (result.workspacePath) {
        writeHtml(terminal, `<span class="system-info">Workspace: ${escapeHtml(result.workspacePath)}</span>`);
      }
      if (result.runtimeProvider) {
        const runtimeProvider = asRecord(result.runtimeProvider);
        if (runtimeProvider) {
          const provider = typeof runtimeProvider.provider === "string" ? runtimeProvider.provider : "unknown";
          const model = typeof runtimeProvider.model === "string" ? runtimeProvider.model : "unknown";
          writeHtml(
            terminal,
            `<span class="system-info">Runtime Provider: ${escapeHtml(provider)} / ${escapeHtml(model)}</span>`,
          );
        }
      }

      renderValidation(result.validation, result.issues);

      if (result.config) {
        writeLine(terminal, "");
        writeHtml(terminal, `<span class="system-info">Resolved Config (redacted):</span>`);
        const redacted = redactConfig(result.config);
        writeHtml(
          terminal,
          `<pre class="assistant-code"><code>${escapeHtml(JSON.stringify(redacted, null, 2))}</code></pre>`,
        );
      }
      return;
    }

    case "set": {
      const key = args[1];
      const value = args.slice(2).join(" ");
      if (!key || !value.trim()) {
        writeHtml(
          terminal,
          `<span class="system-info">Usage: /config set &lt;key&gt; &lt;value&gt;</span>`,
        );
        return;
      }

      const result = await window.terminalAPI.configSet(key, value);
      if (!result.success) {
        writeHtml(terminal, `<span class="system-error">[err] ${escapeHtml(result.error || "Failed to set config value")}</span>`);
        return;
      }

      writeHtml(
        terminal,
        `<span class="system-ok">[ok] Updated ${escapeHtml(result.key || key)} = ${escapeHtml(String(result.value ?? value))}</span>`,
      );
      renderValidation(result.validation, result.issues);
      return;
    }

    case "validate": {
      const result = await window.terminalAPI.configValidate();
      if (!result.success) {
        writeHtml(terminal, `<span class="system-error">[err] ${escapeHtml(result.error || "Failed to validate config")}</span>`);
        return;
      }

      writeSection(terminal, "Config Validation", "[config]", writeHtml);
      writeHtml(terminal, `<span class="system-info">Path: ${escapeHtml(result.configPath)}</span>`);
      renderValidation(result.validation, result.issues);
      return;
    }

    case "apply": {
      const result = await window.terminalAPI.configApply();
      if (!result.success) {
        writeHtml(terminal, `<span class="system-error">[err] ${escapeHtml(result.error || "Failed to apply config")}</span>`);
        return;
      }

      writeHtml(terminal, `<span class="system-ok">[ok] Config applied to live gateway</span>`);
      const runtimeProvider = asRecord(result.runtimeProvider);
      if (runtimeProvider) {
        const provider = typeof runtimeProvider.provider === "string" ? runtimeProvider.provider : "unknown";
        const model = typeof runtimeProvider.model === "string" ? runtimeProvider.model : "unknown";
        writeHtml(
          terminal,
          `<span class="system-info">Runtime Provider: ${escapeHtml(provider)} / ${escapeHtml(model)}</span>`,
        );
      }
      renderValidation(result.validation, result.issues);
      return;
    }

    case "reset": {
      const result = await window.terminalAPI.configReset();
      if (!result.success) {
        writeHtml(terminal, `<span class="system-error">[err] ${escapeHtml(result.error || "Failed to reset config")}</span>`);
        return;
      }

      writeHtml(terminal, `<span class="system-ok">[ok] Config reset to defaults</span>`);
      writeHtml(terminal, `<span class="system-info">Path: ${escapeHtml(result.configPath)}</span>`);
      renderValidation(result.validation, result.issues);
      return;
    }

    case "path": {
      const result = await window.terminalAPI.configPath();
      if (!result.success) {
        writeHtml(terminal, `<span class="system-error">[err] ${escapeHtml(result.error || "Failed to resolve config paths")}</span>`);
        return;
      }

      writeSection(terminal, "Config Paths", "[config]", writeHtml);
      writeHtml(terminal, `<span class="system-info">Config: ${escapeHtml(result.configPath)}</span>`);
      writeHtml(terminal, `<span class="system-info">State: ${escapeHtml(result.stateDir)}</span>`);
      return;
    }

    default: {
      writeHtml(
        terminal,
        `<span class="system-warn">[warn] Unknown /config action: ${escapeHtml(action)}</span>`,
      );
      writeHtml(terminal, `<span class="system-info">Use /config help for usage.</span>`);
    }
  }
}

/**
 * Show mock AI agent output for visual testing
 */
async function showMockAgentOutput(
  terminal: HTMLElement,
  writeLine: (terminal: HTMLElement, text: string, className?: string) => void,
  writeHtml: (terminal: HTMLElement, html: string, className?: string) => void,
): Promise<void> {
  // 1. System dispatch message (bright cyan/yellow)
  writeHtml(
    terminal,
    `<span style="color: var(--accent-cyan);">[SYSTEM] Spawning Agent: WebSearch (PID: 90210)...</span>`,
  );
  writeLine(terminal, "");

  // 2. Thought & Action Stream (muted color, left padding, border)
  writeHtml(
    terminal,
    `<div style="padding-left: 1.5rem; border-left: 2px solid #30363d; color: var(--text-muted); margin: 0.25rem 0 0.5rem;">
      <div style="margin-bottom: 0.25rem;">&gt; Thought: I need to fetch the latest tech news.</div>
      <div style="margin-bottom: 0.25rem;">&gt; Action: [execute_shell] curl -s https://api.news.com/v1/tech</div>
      <div>&gt; Observation: 3 articles found.</div>
    </div>`,
  );

  // 3. Final Markdown Result
  const assistantBody = document.createElement("div");
  assistantBody.className = "assistant-output";
  appendBeforeInput(terminal, assistantBody);

  const outputNode = document.createElement("div");
  outputNode.className = "assistant-body";
  outputNode.innerHTML = renderAssistantMarkdown(`**Tech News Summary**

Here are the latest articles from the tech world:

- **AI Breakthrough**: New model achieves 99% accuracy on reasoning tasks
- **Quantum Leap**: IBM announces 1000-qubit processor milestone
- **Open Source Victory**: Major frameworks adopt permissive licensing

\`\`\`python
# Example: Fetching news programmatically
import requests

def fetch_tech_news():
    url = "https://api.news.com/v1/tech"
    response = requests.get(url)
    return response.json()

articles = fetch_tech_news()
for article in articles[:3]:
    print(f"- {article['title']}")
\`\`\`
`);
  assistantBody.appendChild(outputNode);

  // Add separator
  const separator = document.createElement("div");
  separator.className = "turn-separator";
  appendBeforeInput(terminal, separator);
}
