import type { TerminalAPI } from "../preload/terminal-api";
import { TerminalGatewayClient, type GatewayChatState } from "./gateway-client.js";
import {
  handleSpawnCommand,
  handleAgentsCommand,
  handleTasksCommand,
  showOrchestralHelp,
} from "./orchestral-commands.js";

declare global {
  interface Window {
    terminalAPI: TerminalAPI;
  }
}

const SPINNER_FRAMES = ["[ / ]", "[ - ]", "[ \\ ]", "[ | ]"] as const;
const TYPEWRITER_MIN_DELAY_MS = 10;
const TYPEWRITER_MAX_DELAY_MS = 30;
const CHAT_TIMEOUT_MS = 180_000;
const CHAT_TIMEOUT_SECONDS = Math.round(CHAT_TIMEOUT_MS / 1000);
const USER_PROMPT_HTML =
  '<span class="prompt-host">[User@OpenClaw]</span> <span class="prompt-home">~</span> <span class="prompt-dollar">$</span>';

export type ParsedCommand =
  | { type: "shell"; command: string }
  | { type: "slash"; command: string; args: string[] }
  | { type: "message"; content: string }
  | { type: "empty" };

// Terminal state
let gatewayClient: TerminalGatewayClient | null = null;
let currentSessionKey = "default";
let currentAgent = "main";

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
      if (args.length === 0) {
        writeLine(terminal, `Current session: ${currentSessionKey}`);
        writeLine(terminal, "Usage: /session <session-key> | new | list");
      } else if (args[0] === "new") {
        currentSessionKey = `session-${Date.now()}`;
        writeHtml(
          terminal,
          `<span class="system-ok">[ok] Created new session: ${escapeHtml(currentSessionKey)}</span>`,
        );
      } else if (args[0] === "list") {
        writeLine(terminal, "Sessions: (list not implemented in MVP)");
      } else {
        currentSessionKey = args[0];
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
Terminal: OpenClaw Terminal
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
        writeLine(terminal, "History cleared (not implemented in MVP)");
        return;
      }
      writeLine(terminal, "Command History: (Use Up/Down arrows to navigate)");
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
║                    OpenClaw Terminal Help                ║
╚═══════════════════════════════════════════════════════════╝
</strong></span>

<span class="system-info"><strong>Terminal Commands:</strong></span>
  /help          - Show this help message
  /clear         - Clear the terminal screen
  /status        - Show terminal and gateway status
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
  /tasks          - List all tasks
  /orchestral     - Show orchestral command help

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
<span class="system-ok"><strong>OpenClaw Terminal Status</strong></span>

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
