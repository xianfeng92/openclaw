import type { TerminalAPI } from "../preload/terminal-api";

declare global {
  interface Window {
    terminalAPI: TerminalAPI;
  }
}

export {};
