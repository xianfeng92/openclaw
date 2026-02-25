import type { TerminalAPI } from "../preload/terminal-api";
import { handleCommand } from "./command-handler.js";
import { ansiToHtml } from "./ansi.js";

declare global {
  interface Window {
    terminalAPI: TerminalAPI;
  }
}

// Terminal state
let commandHistory: string[] = [];
let historyIndex = -1;
let isProcessing = false;

// DOM elements
const terminalDiv = document.getElementById("terminal")!;

// Autocomplete suggestions
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

// Create prompt element
function createPrompt(): HTMLElement {
  const promptSpan = document.createElement("span");
  promptSpan.className = "prompt";
  promptSpan.textContent = "➜ ";
  return promptSpan;
}

// Create input line
function createInputLine(): { container: HTMLElement; input: HTMLInputElement } {
  const container = document.createElement("div");
  container.className = "input-line";

  const prompt = createPrompt();
  const input = document.createElement("input");
  input.id = "input";
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;

  container.appendChild(prompt);
  container.appendChild(input);

  return { container, input };
}

// Get completions for input
function getCompletions(input: string): string[] {
  const trimmed = input.trim();
  const completions: string[] = [];

  // Empty input - show all slash commands
  if (!trimmed) {
    return commands.map(c => `/${c}`);
  }

  // Slash command completion
  if (trimmed.startsWith("/")) {
    const search = trimmed.toLowerCase();
    return commands
      .filter(c => `/${c}`.startsWith(search))
      .map(c => `/${c}`);
  }

  // Shell command completion (!prefix)
  if (trimmed.startsWith("!")) {
    const search = trimmed.slice(1).toLowerCase();
    return shellCommands
      .filter(c => c.startsWith(search))
      .map(c => `!${c}`);
  }

  return completions;
}

// Initialize terminal
function initTerminal(): void {
  terminalDiv.innerHTML = "";

  // Welcome message
  writeHtml(`
<span style="font-weight: bold; color: #0dbc79;">
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   OpenClaw Super Terminal                                 ║
║                                                           ║
║   Type /help for available commands                       ║
║   Type !command to run shell commands                     ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
</span>
`);

  // Create input line
  const { container, input } = createInputLine();
  terminalDiv.appendChild(container);

  // Focus input
  input.focus();

  // Handle input
  input.addEventListener("keydown", async (e) => {
    if (isProcessing) return;

    switch (e.key) {
      case "Enter":
        e.preventDefault();
        const command = input.value.trim();
        input.value = "";

        if (command) {
          // Add to history
          commandHistory.push(command);
          historyIndex = -1;

          // Show command in output
          writeHtml(`<span style="color: #0dbc79;">➜</span> ${escapeHtml(command)}`);
          isProcessing = true;

          // Execute command
          await handleCommand(terminalDiv, command);

          isProcessing = false;
        }

        // Scroll to bottom
        scrollToBottom();
        break;

      case "ArrowUp":
        e.preventDefault();
        if (commandHistory.length > 0) {
          if (historyIndex === -1) {
            historyIndex = commandHistory.length - 1;
          } else if (historyIndex > 0) {
            historyIndex--;
          }
          input.value = commandHistory[commandHistory.length - 1 - historyIndex];
        }
        break;

      case "ArrowDown":
        e.preventDefault();
        if (historyIndex !== -1) {
          historyIndex++;
          if (historyIndex >= commandHistory.length) {
            historyIndex = -1;
            input.value = "";
          } else {
            input.value = commandHistory[commandHistory.length - 1 - historyIndex];
          }
        }
        break;

      case "Tab":
        e.preventDefault();
        const currentValue = input.value;
        const completions = getCompletions(currentValue);

        if (completions.length === 1) {
          // Single completion - use it
          input.value = completions[0];
        } else if (completions.length > 1) {
          // Multiple completions - show them
          writeHtml(`<span style="color: #0dbc79;">➜</span> ${escapeHtml(currentValue)}`);
          writeHtml(
            `<span style="color: #666666;">Available completions:</span>`
          );
          writeHtml(
            `<span style="color: #11a8cd;">${completions.join("  ")}</span>`
          );
        }
        break;

      case "c":
        if (e.ctrlKey) {
          e.preventDefault();
          writeHtml(`<span style="color: #e5e510;">^C</span>`);
          isProcessing = false;
        }
        break;

      case "l":
        if (e.ctrlKey) {
          e.preventDefault();
          clearTerminal();
        }
        break;
    }
  });

  // Focus input when clicking anywhere in terminal
  terminalDiv.addEventListener("click", () => {
    if (!isProcessing) {
      input.focus();
    }
  });
}

// Write a line to the terminal (plain text)
function writeLine(text: string): void {
  const inputLine = terminalDiv.querySelector(".input-line");
  const line = document.createElement("div");
  line.className = "line";
  line.textContent = text;
  if (inputLine) {
    terminalDiv.insertBefore(line, inputLine);
  } else {
    terminalDiv.appendChild(line);
  }
  scrollToBottom();
}

// Write HTML content to the terminal
function writeHtml(html: string): void {
  const inputLine = terminalDiv.querySelector(".input-line");
  const line = document.createElement("div");
  line.className = "line";
  line.innerHTML = html;
  if (inputLine) {
    terminalDiv.insertBefore(line, inputLine);
  } else {
    terminalDiv.appendChild(line);
  }
  scrollToBottom();
}

// Write with ANSI color support
function writeAnsi(text: string): void {
  const inputLine = terminalDiv.querySelector(".input-line");
  const line = document.createElement("div");
  line.className = "line";
  line.innerHTML = ansiToHtml(text);
  if (inputLine) {
    terminalDiv.insertBefore(line, inputLine);
  } else {
    terminalDiv.appendChild(line);
  }
  scrollToBottom();
}

// Clear terminal
function clearTerminal(): void {
  const inputLine = terminalDiv.querySelector(".input-line");
  terminalDiv.innerHTML = "";
  if (inputLine) {
    terminalDiv.appendChild(inputLine);
  }
  scrollToBottom();
}

// Scroll to bottom
function scrollToBottom(): void {
  terminalDiv.scrollTop = terminal.scrollHeight;
}

// Escape HTML
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Export functions for use in other modules
export type { TerminalDiv };
export { writeLine, writeHtml, writeAnsi, clearTerminal };

// Initialize
initTerminal();
