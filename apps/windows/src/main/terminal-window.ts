import { BrowserWindow } from "electron";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TERMINAL_WIDTH = 900;
const TERMINAL_HEIGHT = 600;

export class TerminalWindowManager {
  private window: BrowserWindow | null = null;

  show(): BrowserWindow {
    if (this.window) {
      if (this.window.isMinimized()) {
        this.window.restore();
      }
      this.window.show();
      this.window.focus();
      return this.window;
    }

    this.window = new BrowserWindow({
      width: TERMINAL_WIDTH,
      height: TERMINAL_HEIGHT,
      minWidth: 600,
      minHeight: 400,
      title: "OpenClaw Terminal",
      show: false,
      autoHideMenuBar: true,
      darkTheme: true,
      backgroundColor: "#1e1e1e",
      webPreferences: {
        preload: path.join(__dirname, "../preload/terminal-api.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        sandbox: false,
      },
    });

    // Load the terminal HTML file
    const htmlPath = path.join(__dirname, "../terminal/index.html");
    this.window.loadFile(htmlPath).catch((err) => {
      console.error("[Terminal] Failed to load terminal page:", err);
    });

    // Handle window closed
    this.window.on("closed", () => {
      this.window = null;
    });

    // Show window when ready
    this.window.once("ready-to-show", () => {
      this.window?.show();
    });

    return this.window;
  }

  hide(): void {
    if (this.window) {
      this.window.hide();
    }
  }

  toggle(): BrowserWindow {
    if (this.window && this.window.isVisible()) {
      this.hide();
      return this.window;
    }
    return this.show();
  }

  close(): void {
    this.window?.close();
    this.window = null;
  }

  getWindow(): BrowserWindow | null {
    return this.window;
  }
}
