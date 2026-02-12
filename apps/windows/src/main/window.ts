import { BrowserWindow } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import type { GatewayManager } from "./gateway.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WINDOW_WIDTH = 1200;
const WINDOW_HEIGHT = 800;
const INVOKE_BOOTSTRAP_DELAY_MS = 50;

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

      async function startGateway() {
        startBtn.disabled = true;
        startBtn.textContent = 'Starting...';
        errorDiv.textContent = '';
        statusSpan.textContent = 'Starting...';

        try {
          const result = await desktop.gateway.start();
          if (result && result.success) {
            startBtn.textContent = 'Gateway Running';
            statusSpan.textContent = 'Running';
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
        }).catch(() => {
          errorDiv.textContent = 'Could not get Gateway state';
        });

        desktop.gateway.onStateChanged((state) => {
          statusSpan.textContent = state.status || 'unknown';
          if (state.error) {
            errorDiv.textContent = state.error;
          }
        });
      }
    </script>
  </body>
</html>`;
  }

  private buildInvokeShellHtml(): string {
    return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenClaw - Invoke</title>
    <style>
      :root {
        color-scheme: dark;
      }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Segoe UI", "Inter", sans-serif;
        background:
          radial-gradient(circle at 20% 20%, rgba(74, 158, 255, 0.25), transparent 45%),
          radial-gradient(circle at 80% 80%, rgba(74, 255, 177, 0.18), transparent 40%),
          #0f1422;
        color: #e8eefc;
        display: grid;
        place-items: center;
      }
      .shell {
        width: min(760px, calc(100vw - 48px));
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(16, 23, 38, 0.92);
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
        overflow: hidden;
      }
      .shell-head {
        padding: 14px 18px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid rgba(255, 255, 255, 0.12);
      }
      .shell-title {
        font-size: 14px;
        font-weight: 600;
        letter-spacing: 0.02em;
      }
      .shell-shortcut {
        font-size: 12px;
        opacity: 0.75;
      }
      .shell-body {
        padding: 18px;
      }
      .shell-input {
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 10px;
        padding: 12px 14px;
        font-size: 14px;
        color: rgba(232, 238, 252, 0.92);
        background: rgba(7, 11, 20, 0.75);
      }
      .shell-meta {
        margin-top: 12px;
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        opacity: 0.8;
      }
      .loader {
        width: 12px;
        height: 12px;
        border-radius: 999px;
        border: 2px solid rgba(74, 158, 255, 0.35);
        border-top-color: #4a9eff;
        animation: spin 0.85s linear infinite;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    </style>
  </head>
  <body>
    <main class="shell" role="status" aria-live="polite">
      <header class="shell-head">
        <div class="shell-title">OpenClaw Invoke</div>
        <div class="shell-shortcut">Alt+Space</div>
      </header>
      <section class="shell-body">
        <div class="shell-input">Ask anything...</div>
        <div class="shell-meta">
          <span class="loader" aria-hidden="true"></span>
          <span>Preparing local AI context and streaming bridge...</span>
        </div>
      </section>
    </main>
  </body>
</html>`;
  }

  private getWebUiUrl(): string {
    // Gateway serves the Control UI at `/` by default (unless gateway.controlUi.basePath is set).
    const { port } = this.gatewayManager.getState();
    return `http://127.0.0.1:${port}/`;
  }

  private getFallbackDataUrl(): string {
    return `data:text/html;charset=utf-8,${encodeURIComponent(this.buildGatewayErrorPageHtml())}`;
  }

  private getInvokeShellDataUrl(): string {
    return `data:text/html;charset=utf-8,${encodeURIComponent(this.buildInvokeShellHtml())}`;
  }

  private loadFallbackPage(): void {
    const dataUrl = this.getFallbackDataUrl();
    this.window?.loadURL(dataUrl).catch((loadErr) => {
      console.error("Failed to load fallback error page:", loadErr);
    });
  }

  private loadInvokeShellPage(): void {
    const dataUrl = this.getInvokeShellDataUrl();
    this.window?.loadURL(dataUrl).catch((loadErr) => {
      console.error("Failed to load invoke shell page:", loadErr);
    });
  }

  private loadWebUiWithFallback(): void {
    this.window?.loadURL(this.getWebUiUrl()).catch((err) => {
      console.error("Failed to load Web UI:", err);
      // Navigate to a local error page (data: URL) so we can reliably run the preload bridge + start the gateway.
      this.loadFallbackPage();

      // Keep retrying while the window is alive; startup can race briefly even after process spawn.
      setTimeout(() => {
        if (!this.window) {
          return;
        }
        this.loadWebUiWithFallback();
      }, 800);
    });
  }

  private waitForGatewayRunning(timeoutMs = 45_000): Promise<boolean> {
    return new Promise((resolve) => {
      const current = this.gatewayManager.getState();
      if (current.status === "running") {
        resolve(true);
        return;
      }

      const onStateChanged = (state: { status: string }) => {
        if (state.status !== "running") {
          return;
        }
        this.gatewayManager.off("state-changed", onStateChanged);
        clearTimeout(timer);
        resolve(true);
      };

      const timer = setTimeout(() => {
        this.gatewayManager.off("state-changed", onStateChanged);
        resolve(false);
      }, timeoutMs);

      this.gatewayManager.on("state-changed", onStateChanged);
    });
  }

  private startGatewayAndLoadWebUi(): void {
    const state = this.gatewayManager.getState();
    if (state.status === "running") {
      this.loadWebUiWithFallback();
      return;
    }
    if (state.status === "starting") {
      void this.waitForGatewayRunning().then((ok) => {
        if (!ok || !this.window) {
          return;
        }
        this.loadWebUiWithFallback();
      });
      return;
    }

    void this.gatewayManager
      .start()
      .then(() => {
        if (!this.window) {
          return;
        }
        this.loadWebUiWithFallback();
      })
      .catch((err) => {
        console.error("Auto-start gateway failed:", err);
      });
  }

  createWindow(options?: { invokeFastPath?: boolean }): BrowserWindow {
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

    if (options?.invokeFastPath) {
      // Fast-path invoke: render a lightweight shell immediately, then swap to Web UI.
      this.loadInvokeShellPage();
      setTimeout(() => {
        if (!this.window) {
          return;
        }
        this.startGatewayAndLoadWebUi();
      }, INVOKE_BOOTSTRAP_DELAY_MS);
    } else {
      this.startGatewayAndLoadWebUi();
    }

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

  showInvokeWindow(): BrowserWindow {
    if (this.window) {
      if (this.window.isMinimized()) {
        this.window.restore();
      }
      this.window.show();
      this.window.focus();
      // Ensure invoke always lands on the real chat UI even if we're currently on a bootstrap/fallback page.
      this.startGatewayAndLoadWebUi();
      return this.window;
    }
    return this.createWindow({ invokeFastPath: true });
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
    this.loadWebUiWithFallback();
  }

  close(): void {
    this.window?.close();
    this.window = null;
  }
}
