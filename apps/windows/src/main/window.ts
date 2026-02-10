import { BrowserWindow } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import type { GatewayManager } from "./gateway.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WINDOW_WIDTH = 1200;
const WINDOW_HEIGHT = 800;

export class ChatWindowManager {
  private window: BrowserWindow | null = null;

  constructor(private gatewayManager: GatewayManager) {}

  private buildGatewayErrorPageHtml(): string {
    // Keep this self-contained (data: URL) so it works even when the target URL refuses the connection.
    return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenClaw - Gateway Not Running</title>
    <style>
      body {
        font-family: system-ui, -apple-system, sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100vh;
        margin: 0;
        background: #1a1a2e;
        color: #eee;
      }
      .container {
        text-align: center;
        padding: 2rem;
        max-width: 600px;
      }
      h1 { margin-top: 0; color: #ff6b6b; }
      .status {
        background: #16213e;
        padding: 1rem;
        border-radius: 8px;
        margin: 1rem 0;
      }
      button {
        background: #4a9eff;
        color: white;
        border: none;
        padding: 0.75rem 1.5rem;
        border-radius: 6px;
        cursor: pointer;
        font-size: 1rem;
        margin-top: 1rem;
      }
      button:hover { background: #3a8eef; }
      button:disabled { background: #555; cursor: not-allowed; }
      .error {
        color: #ff6b6b;
        margin-top: 1rem;
        font-size: 0.9rem;
        white-space: pre-wrap;
      }
      .info {
        color: #aaa;
        margin-top: 1.5rem;
        font-size: 0.85rem;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>OpenClaw Desktop</h1>
      <div class="status">
        <p>The OpenClaw Gateway is not currently running.</p>
        <p>Click the button below to start it.</p>
      </div>
      <button id="startBtn" type="button">Start Gateway</button>
      <div id="error" class="error"></div>
      <div class="info">
        Status: <span id="status">Stopped</span>
      </div>
    </div>
    <script>
      const desktop = window.__openclawDesktop || window.electron;
      const startBtn = document.getElementById('startBtn');
      const errorDiv = document.getElementById('error');
      const statusSpan = document.getElementById('status');

      async function navigateToUi() {
        try {
          const state = await desktop.gateway.getState();
          const port = (state && state.port) || 19001;
          window.location.href = 'http://127.0.0.1:' + String(port) + '/';
        } catch {
          // Fall back to a plain reload if we can't read state for any reason.
          location.reload();
        }
      }

      async function startGateway() {
        startBtn.disabled = true;
        startBtn.textContent = 'Starting...';
        errorDiv.textContent = '';
        statusSpan.textContent = 'Starting...';

        try {
          const result = await desktop.gateway.start();
          if (result && result.success) {
            startBtn.textContent = 'Starting Gateway...';
            statusSpan.textContent = 'Running';
            setTimeout(() => void navigateToUi(), 2000);
          } else {
            startBtn.disabled = false;
            startBtn.textContent = 'Start Gateway';
            statusSpan.textContent = 'Error';
            errorDiv.textContent = (result && result.error) || 'Failed to start Gateway';
          }
        } catch (err) {
          startBtn.disabled = false;
          startBtn.textContent = 'Start Gateway';
          statusSpan.textContent = 'Error';
          errorDiv.textContent = (err && err.message) || String(err) || 'Unknown error';
        }
      }

      startBtn.addEventListener('click', () => void startGateway());

      if (typeof desktop === 'undefined') {
        errorDiv.textContent = 'Electron API not available.';
        startBtn.disabled = true;
      } else {
        desktop.gateway.getState().then((state) => {
          statusSpan.textContent = state.status || 'unknown';
          if (state.error) {
            errorDiv.textContent = state.error;
          }
          // User explicitly opened the chat window; automatically start the gateway on first load.
          if (state.status === 'stopped') {
            void startGateway();
          }
        }).catch(() => {
          errorDiv.textContent = 'Could not get Gateway state';
        });

        desktop.gateway.onStateChanged((state) => {
          statusSpan.textContent = state.status || 'unknown';
          if (state.error) {
            errorDiv.textContent = state.error;
          }
          if (state.status === 'running') {
            setTimeout(() => void navigateToUi(), 500);
          }
        });
      }
    </script>
  </body>
</html>`;
  }

  private getWebUiUrl(): string {
    // Gateway serves the Control UI at `/` by default (unless gateway.controlUi.basePath is set).
    const { port } = this.gatewayManager.getState();
    return `http://127.0.0.1:${port}/`;
  }

  createWindow(): BrowserWindow {
    if (this.window) {
      this.window.focus();
      return this.window;
    }

    this.window = new BrowserWindow({
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      minWidth: 800,
      minHeight: 600,
      title: "OpenClaw",
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        sandbox: false,
      },
    });

	    // Load the web UI
	    this.window.loadURL(this.getWebUiUrl()).catch((err) => {
	      console.error("Failed to load Web UI:", err);
	      // Navigate to a local error page (data: URL) so we can reliably run the preload bridge + start the gateway.
	      const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(this.buildGatewayErrorPageHtml())}`;
	      this.window?.loadURL(dataUrl).catch((loadErr) => {
	        console.error("Failed to load fallback error page:", loadErr);
	      });

	      // Also retry from the main process once the gateway is running (more reliable than in-page reloads).
	      const retry = () => {
	        try {
	          this.window?.loadURL(this.getWebUiUrl()).catch(() => undefined);
	        } finally {
	          this.gatewayManager.off("state-changed", onStateChanged);
	        }
	      };
	      const onStateChanged = (state: { status: string }) => {
	        if (state.status === "running") {
	          retry();
	        }
	      };
	      this.gatewayManager.on("state-changed", onStateChanged);
	    });

    // Handle window closed
    this.window.on("closed", () => {
      this.window = null;
    });

    // Show window when ready
    this.window.once("ready-to-show", () => {
      this.window?.show();
    });

    // Handle navigation errors
    this.window.webContents.on("did-fail-load", (event, errorCode, errorDescription) => {
      console.error("Failed to load:", errorCode, errorDescription);
    });

    return this.window;
  }

  showChatWindow(): BrowserWindow {
    if (this.window) {
      if (this.window.isMinimized()) {
        this.window.restore();
      }
      this.window.focus();
      return this.window;
    }
    return this.createWindow();
  }

  hideChatWindow(): void {
    if (this.window) {
      this.window.hide();
    }
  }

  toggleChatWindow(): void {
    if (this.window && this.window.isVisible()) {
      this.hideChatWindow();
    } else {
      this.showChatWindow();
    }
  }

  reloadToGatewayUi(): void {
    if (!this.window) {
      return;
    }
    this.window.loadURL(this.getWebUiUrl()).catch((err) => {
      console.error("Failed to load Web UI:", err);
    });
  }

  close(): void {
    this.window?.close();
    this.window = null;
  }
}
