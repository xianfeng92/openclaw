import { BrowserWindow, app } from "electron";
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
      // Create an error page directly in the window
      this.window?.webContents.executeJavaScript(`
        document.documentElement.innerHTML = \`
          <!DOCTYPE html>
          <html>
          <head>
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
              <button id="startBtn" onclick="startGateway()">Start Gateway</button>
              <div id="error" class="error"></div>
              <div class="info">
                Status: <span id="status">Stopped</span>
              </div>
            </div>
            <script>
              async function startGateway() {
                const btn = document.getElementById('startBtn');
                const errorDiv = document.getElementById('error');
                const statusSpan = document.getElementById('status');

                btn.disabled = true;
                btn.textContent = 'Starting...';
                errorDiv.textContent = '';
                statusSpan.textContent = 'Starting...';

                try {
                  const result = await window.electron.gateway.start();
                  if (result.success) {
                    btn.textContent = 'Starting Gateway...';
                    statusSpan.textContent = 'Running';
                    // Reload after 2 seconds to check if Gateway is ready
                    setTimeout(() => location.reload(), 2000);
                  } else {
                    btn.disabled = false;
                    btn.textContent = 'Start Gateway';
                    statusSpan.textContent = 'Error';
                    errorDiv.textContent = result.error || 'Failed to start Gateway';
                  }
                } catch (err) {
                  btn.disabled = false;
                  btn.textContent = 'Start Gateway';
                  statusSpan.textContent = 'Error';
                  errorDiv.textContent = err.message || 'Unknown error';
                }
              }

	              const desktop = window.__openclawDesktop || window.electron;

	              // Check if desktop bridge is available
	              if (typeof desktop === 'undefined') {
	                document.getElementById('error').textContent = 'Electron API not available. Please run in development mode.';
	                document.getElementById('startBtn').disabled = true;
	              } else {
	                // Check initial state
	                desktop.gateway.getState().then(state => {
	                  document.getElementById('status').textContent = state.status;
	                  if (state.error) {
	                    document.getElementById('error').textContent = state.error;
	                  }
	                }).catch(() => {
	                  document.getElementById('error').textContent = 'Could not get Gateway state';
	                });
	
	                // Listen for state changes
	                desktop.gateway.onStateChanged((state) => {
	                  document.getElementById('status').textContent = state.status;
	                  if (state.error) {
	                    document.getElementById('error').textContent = state.error;
	                  }
	                  if (state.status === 'running') {
                    setTimeout(() => location.reload(), 1000);
                  }
                });
              }
            </script>
          </body>
          </html>
        \`;
      `);
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

  close(): void {
    this.window?.close();
    this.window = null;
  }
}
