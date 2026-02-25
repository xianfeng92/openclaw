import type { TerminalAPI } from "../preload/terminal-api";
import { TerminalGatewayClient } from "./gateway-client.js";

declare global {
  interface Window {
    terminalAPI: TerminalAPI;
  }
}

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

  // Local shell command (! prefix)
  if (trimmed.startsWith("!") && trimmed !== "!") {
    return { type: "shell", command: trimmed.slice(1) };
  }

  // Slash command
  if (trimmed.startsWith("/")) {
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);
    return { type: "slash", command: cmd, args };
  }

  // Regular message - send to agent
  return { type: "message", content: trimmed };
}

// Helper to write plain text to terminal
function writeLine(terminal: HTMLElement, text: string): void {
  const inputLine = terminal.querySelector(".input-line");
  const line = document.createElement("div");
  line.className = "line";
  line.textContent = text;
  if (inputLine) {
    terminal.insertBefore(line, inputLine);
  } else {
    terminal.appendChild(line);
  }
  terminal.scrollTop = terminal.scrollHeight;
}

// Helper to write HTML (with colors) to terminal
function writeHtml(terminal: HTMLElement, html: string): void {
  const inputLine = terminal.querySelector(".input-line");
  const line = document.createElement("div");
  line.className = "line";
  line.innerHTML = html;
  if (inputLine) {
    terminal.insertBefore(line, inputLine);
  } else {
    terminal.appendChild(line);
  }
  terminal.scrollTop = terminal.scrollHeight;
}

// Write a styled section header
function writeSection(terminal: HTMLElement, title: string, icon = "ℹ️"): void {
  writeHtml(
    terminal,
    `<span style="color: #11a8cd; font-weight: bold;">${icon} ${title}</span>`,
  );
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

    // Wait for output
    const unsubscribe = window.terminalAPI.onShellOutput((data) => {
      if (data.runId !== runId) return;

      if (data.type === "stdout") {
        writeLine(terminal, data.data);
      } else if (data.type === "stderr") {
        writeHtml(terminal, `<span style="color: #cd3131;">${escapeHtml(data.data)}</span>`);
      } else if (data.type === "exit") {
        unsubscribe();
        const exitCode = data.exitCode ?? 0;
        if (exitCode !== 0) {
          writeHtml(
            terminal,
            `<span style="color: #666666;">Exit code: ${exitCode}</span>`,
          );
        }
      }
    });
  } catch (err) {
    writeHtml(terminal, `<span style="color: #cd3131;">Error: ${escapeHtml(String(err))}</span>`);
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
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
        writeLine(terminal, `Switched to agent: ${currentAgent}`);
      }
      return;
    }

    case "/session": {
      if (args.length === 0) {
        writeLine(terminal, `Current session: ${currentSessionKey}`);
        writeLine(terminal, "Usage: /session <session-key> | new | list");
      } else if (args[0] === "new") {
        currentSessionKey = `session-${Date.now()}`;
        writeLine(terminal, `Created new session: ${currentSessionKey}`);
      } else if (args[0] === "list") {
        writeLine(terminal, "Sessions: (list not implemented in MVP)");
      } else {
        currentSessionKey = args[0];
        writeLine(terminal, `Switched to session: ${currentSessionKey}`);
      }
      return;
    }

    case "/whoami": {
      const gatewayInfo = await window.terminalAPI.getGatewayInfo();
      writeHtml(terminal, `
<span style="font-weight: bold; color: #0dbc79;">User Information</span>
  Agent: ${currentAgent}
  Session: ${currentSessionKey}
  Gateway Port: ${gatewayInfo.port ?? "unknown"}
  Platform: ${navigator.platform}
`.trim());
      return;
    }

    case "/env":
    case "/environment": {
      writeHtml(terminal, `
<span style="font-weight: bold; color: #0dbc79;">Environment</span>
  Terminal: OpenClaw Super Terminal v1.0
  Mode: Desktop (Electron)
  Platform: ${navigator.platform}
  User Agent: ${navigator.userAgent}
  Language: ${navigator.language}
`.trim());
      return;
    }

    case "/echo": {
      writeLine(terminal, args.join(" "));
      return;
    }

    case "/date": {
      writeLine(terminal, new Date().toString());
      return;
    }

    case "/time": {
      const now = new Date();
      writeLine(terminal, now.toLocaleTimeString());
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
        writeLine(terminal, "Disconnected from Gateway");
      } else {
        writeLine(terminal, "Not connected to Gateway");
      }
      return;
    }

    default: {
      writeHtml(
        terminal,
        `<span style="color: #e5e510;">Unknown command: ${escapeHtml(command)}</span>`,
      );
      writeLine(terminal, "Type /help for available commands");
    }
  }
}

function showHelp(terminal: HTMLElement): void {
  writeHtml(terminal, `
<span style="font-weight: bold; color: #0dbc79;">
╔═══════════════════════════════════════════════════════════╗
║                    OpenClaw Terminal Help                  ║
╚═══════════════════════════════════════════════════════════╝
</span>

<span style="font-weight: bold; color: #11a8cd;">Terminal Commands:</span>
  /help          - Show this help message
  /clear         - Clear the terminal screen
  /status        - Show terminal and gateway status
  /history       - Show command history
  /whoami        - Display current user/session info
  /env           - Show environment information
  /echo &lt;text&gt;   - Echo the input text
  /date          - Show current date
  /time          - Show current time

<span style="font-weight: bold; color: #11a8cd;">Session Commands:</span>
  /agent &lt;name&gt;   - Switch agent (main, claude, gpt, local)
  /session &lt;key&gt;  - Switch session key
  /session new    - Create a new session

<span style="font-weight: bold; color: #11a8cd;">Gateway Commands:</span>
  /connect       - Connect to Gateway
  /disconnect    - Disconnect from Gateway

<span style="font-weight: bold; color: #11a8cd;">Shell Commands:</span>
  !&lt;command&gt;     - Execute shell command
  Example: !ls, !pwd, !git status

<span style="font-weight: bold; color: #11a8cd;">Agent Messages:</span>
  Just type a message to send it to the current agent

<span style="font-weight: bold; color: #11a8cd;">Keyboard Shortcuts:</span>
  Enter          - Execute command
  Tab            - Autocomplete command
  Ctrl+C         - Abort current input
  Ctrl+L         - Clear screen
  Up/Down        - Browse command history
  Ctrl+Shift+T   - Toggle terminal window
`);
}

async function showStatus(terminal: HTMLElement): void {
  const gatewayInfo = await window.terminalAPI.getGatewayInfo();
  const connected = gatewayClient?.isConnected() ?? false;

  writeHtml(terminal, `
<span style="font-weight: bold; color: #0dbc79;">OpenClaw Terminal Status</span>

<span style="color: #11a8cd;">Session:</span>
  Agent: ${currentAgent}
  Session: ${currentSessionKey}

<span style="color: #11a8cd;">Gateway:</span>
  Status: ${connected ? "<span style='color: #0dbc79;'>Connected</span>" : "<span style='color: #cd3131;'>Disconnected</span>"}
  Port: ${gatewayInfo.port ?? "unknown"}

<span style="color: #11a8cd;">Terminal:</span>
  Platform: ${navigator.platform}
  Mode: Desktop
`.trim());
}

async function connectGateway(terminal: HTMLElement): void {
  writeLine(terminal, "Connecting to Gateway...");

  try {
    const gatewayInfo = await window.terminalAPI.getGatewayInfo();

    if (!gatewayInfo.port) {
      writeHtml(
        terminal,
        "<span style='color: #cd3131;'>Error: Gateway port not found. Is Gateway running?</span>",
      );
      return;
    }

    // Use default auth token
    const auth = window.terminalAPI.getGatewayAuthSync();
    if (!auth?.token) {
      writeHtml(
        terminal,
        "<span style='color: #cd3131;'>Error: Gateway auth token not found</span>",
      );
      return;
    }

    const url = `ws://127.0.0.1:${auth.port}`;
    gatewayClient = new TerminalGatewayClient(url, auth.token);

    await gatewayClient.connect();
    writeHtml(
      terminal,
      "<span style='color: #0dbc79;'>✓ Connected to Gateway</span>",
    );
  } catch (err) {
    writeHtml(
      terminal,
      `<span style='color: #cd3131;'>✗ Failed to connect: ${escapeHtml(String(err))}</span>`,
    );
  }
}

async function handleMessage(terminal: HTMLElement, content: string): Promise<void> {
  // Check if connected to Gateway
  if (!gatewayClient || !gatewayClient.isConnected()) {
    // Auto-connect
    await connectGateway(terminal);
    if (!gatewayClient?.isConnected()) {
      writeLine(terminal, "Cannot send message: Not connected to Gateway");
      return;
    }
  }

  // Show user message
  writeHtml(terminal, `<span style="color: #e5e5e5;">${escapeHtml(content)}</span>`);

  // Show thinking indicator
  writeHtml(
    terminal,
    `<span style="color: #11a8cd;">⟳ Thinking...</span>`,
  );

  try {
    let responseStarted = false;
    let lastResponseLine: HTMLElement | null = null;

    const unsubscribe = gatewayClient!.onEvent((message, state) => {
      console.log("[Terminal] Event received:", { message, state });

      if (!responseStarted) {
        // Remove "Thinking..." line (last line before input)
        const lines = terminal.querySelectorAll(".line");
        if (lines.length > 0) {
          const lastLine = lines[lines.length - 1];
          if (lastLine.textContent?.includes("Thinking")) {
            lastLine.remove();
          }
        }
        responseStarted = true;
      }

      // Create or update response line
      if (!lastResponseLine) {
        const inputLine = terminal.querySelector(".input-line");
        lastResponseLine = document.createElement("div");
        lastResponseLine.className = "line";
        if (inputLine) {
          terminal.insertBefore(lastResponseLine, inputLine);
        } else {
          terminal.appendChild(lastResponseLine);
        }
      }

      // Update the response display
      lastResponseLine.innerHTML = `<span style="color: #d4d4d4;">${escapeHtml(message)}</span>`;
      terminal.scrollTop = terminal.scrollHeight;

      if (state === "final" || state === "aborted") {
        lastResponseLine = null;
        unsubscribe();
        writeLine(terminal, ""); // Add blank line
      }
    });

    const result = await gatewayClient!.sendMessage(currentSessionKey, content);
    console.log("[Terminal] sendMessage result:", result);

    // If no response after timeout, remove thinking indicator
    setTimeout(() => {
      if (!responseStarted) {
        unsubscribe();
        const lines = terminal.querySelectorAll(".line");
        if (lines.length > 0) {
          const lastLine = lines[lines.length - 1];
          if (lastLine.textContent?.includes("Thinking")) {
            lastLine.remove();
          }
        }
        writeHtml(
          terminal,
          "<span style='color: #e5e510;'>⚠ No response received (timeout)</span>",
        );
      }
    }, 60000);
  } catch (err) {
    console.error("[Terminal] sendMessage error:", err);
    writeHtml(
      terminal,
      `<span style='color: #cd3131;'>✗ Error: ${escapeHtml(String(err))}</span>`,
    );
  }
}
