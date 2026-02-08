import { BrowserWindow, app } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SETTINGS_PATH = path.join(__dirname, "../../resources/settings.html");

export type SettingsData = {
  provider: string;
  apiKey: string;
  baseUrl: string;
  gatewayPort: number;
  autoStartGateway: boolean;
};

function redactSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) {
    return "<redacted>";
  }
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

function shouldRedactConfigPath(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return (
    lower.endsWith(".apikey") ||
    lower.includes(".apikey.") ||
    lower.endsWith(".token") ||
    lower.includes(".token.") ||
    lower.endsWith(".secret") ||
    lower.includes(".secret.") ||
    lower.endsWith(".password") ||
    lower.includes(".password.")
  );
}

function redactArgsForLog(args: string[]): string[] {
  // Redact values for `openclaw config set <path> <value>` when the path indicates a secret.
  const out = [...args];
  for (let i = 0; i < out.length; i += 1) {
    if (out[i] !== "config" || out[i + 1] !== "set") {
      continue;
    }
    const pathArg = out[i + 2];
    const valueIdx = i + 3;
    if (typeof pathArg === "string" && typeof out[valueIdx] === "string" && shouldRedactConfigPath(pathArg)) {
      out[valueIdx] = redactSecret(out[valueIdx]);
    }
  }
  return out;
}

function findRepoRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i += 1) {
    const candidate = path.join(dir, "scripts", "run-node.mjs");
    if (fs.existsSync(candidate)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

function resolveRepoRoot(): string | null {
  // Prefer Electron's app path (works in dev + packaged), then cwd, then this file's directory.
  const candidates = [app.getAppPath(), process.cwd(), __dirname];
  for (const start of candidates) {
    const found = findRepoRoot(start);
    if (found) {
      return found;
    }
  }
  return null;
}

export class SettingsManager {
  private window: BrowserWindow | null = null;

  openSettingsWindow(): BrowserWindow {
    if (this.window) {
      this.window.focus();
      return this.window;
    }

    const preloadPath = path.join(__dirname, "../preload/index.cjs");
    console.log("[Settings] Opening settings window");
    console.log("[Settings] settings.html:", SETTINGS_PATH);
    console.log("[Settings] preload:", preloadPath, "exists=", fs.existsSync(preloadPath));

    this.window = new BrowserWindow({
      width: 600,
      height: 700,
      resizable: false,
      title: "OpenClaw Settings",
      autoHideMenuBar: true,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        sandbox: false,
      },
    });

    // If preload fails to load/execute, Electron will emit this on the WebContents.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.window.webContents.on("preload-error" as any, (_event: unknown, pathname: string, error: Error) => {
      console.error("[Settings] preload-error:", pathname, error?.stack ?? error?.message ?? String(error));
    });

    this.window.webContents.on("did-finish-load", () => {
      this.window?.webContents
        .executeJavaScript(
          "({ hasElectron: typeof window.electron, hasDesktop: typeof window.__openclawDesktop, keys: Object.keys(window).filter(k=>k.includes('openclaw')||k==='electron').slice(0,20) })",
          true,
        )
        .then((res) => console.log("[Settings] bridge probe:", res))
        .catch((err) => console.error("[Settings] bridge probe failed:", String(err)));
    });

    // Load settings page
    this.window.loadFile(SETTINGS_PATH).catch((err) => {
      console.error("Failed to load settings page:", err);
    });

    // Handle window closed
    this.window.on("closed", () => {
      this.window = null;
    });

    return this.window;
  }

  close(): void {
    this.window?.close();
    this.window = null;
  }
}

/**
 * Save settings and update Gateway configuration
 */
export async function saveSettings(data: SettingsData): Promise<{ success: boolean; error?: string }> {
  try {
    console.log("[Settings] Saving settings:", { provider: data.provider, hasApiKey: !!data.apiKey });

    // Settings should apply to the same profile the desktop app runs the gateway with.
    const profileArgs = ["--profile", "desktop"];

    // Set provider based on selection
    const providerConfigs: Record<string, { baseUrl: string; configPath: string }> = {
      google: {
        baseUrl: data.baseUrl || "https://generativelanguage.googleapis.com/v1beta",
        configPath: "models.providers.google"
      },
      openai: {
        baseUrl: data.baseUrl || "https://api.openai.com/v1",
        configPath: "models.providers.openai"
      },
      anthropic: {
        baseUrl: data.baseUrl || "https://api.anthropic.com",
        configPath: "models.providers.anthropic"
      }
    };

    const config = providerConfigs[data.provider] || providerConfigs.google;

    // Set default model
    const defaultModels: Record<string, string> = {
      google: "google/gemini-2.0-flash-exp",
      openai: "openai/gpt-4o-mini",
      anthropic: "anthropic/claude-3-5-haiku-20241022"
    };

    const defaultModel = defaultModels[data.provider] || defaultModels.google;

    const commands: string[][] = [
      ["config", "set", `${config.configPath}.baseUrl`, config.baseUrl],
      ["config", "set", `${config.configPath}.apiKey`, data.apiKey],
      ["config", "set", "agents.defaults.model.primary", defaultModel],
    ];

    // Execute commands: prefer local repo runner, otherwise fall back to npx openclaw (packaged installs).
    const repoRoot = resolveRepoRoot();
    const localRunner = repoRoot ? path.join(repoRoot, "scripts", "run-node.mjs") : null;
    const hasLocalRunner = Boolean(localRunner && fs.existsSync(localRunner));

    for (const cmdArgs of commands) {
      if (hasLocalRunner && repoRoot && localRunner) {
        await executeConfigCommand({
          command: "node",
          args: [localRunner, ...profileArgs, ...cmdArgs],
          cwd: repoRoot,
        });
      } else {
        // Packaged app / no repo checkout available: rely on published CLI.
        await executeConfigCommand({
          command: "npx",
          args: ["-y", "openclaw", ...profileArgs, ...cmdArgs],
          cwd: process.cwd(),
        });
      }
    }

    console.log("[Settings] Settings saved successfully");
    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[Settings] Error saving settings:", errorMsg);
    return { success: false, error: errorMsg };
  }
}

function executeConfigCommand(params: { command: string; args: string[]; cwd: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(params.command, params.args, {
      cwd: params.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to execute: ${err.message}`));
    });

    child.on("exit", (code) => {
      if (code === 0) {
        const safeArgs = redactArgsForLog(params.args);
        console.log(`[Settings] Config command success: ${params.command} ${safeArgs.join(" ")}`);
        resolve();
      } else {
        reject(new Error(`Command failed (code ${code}): ${stderr || stdout}`));
      }
    });
  });
}
