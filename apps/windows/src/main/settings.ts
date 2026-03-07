import { BrowserWindow } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import type { CyDeckProvider } from "./cydeck-config.js";
import { getEffectiveConfig } from "./cydeck-config.js";
import { assignConfigPathValue } from "./cydeck-config-ipc.js";
import {
  loadEditableCyDeckConfigDocument,
  writeCyDeckConfigDocument,
} from "./cydeck-config-document.js";

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

export type SettingsLoadResult = {
  success: boolean;
  data?: SettingsData;
  error?: string;
};

export type SettingsSaveResult = {
  success: boolean;
  error?: string;
};

const DEFAULT_PROVIDER_BASE_URLS: Record<CyDeckProvider, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
};

const DEFAULT_PROVIDER_MODELS: Record<CyDeckProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet",
  google: "gemini-2.0-flash",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeProvider(value: string): CyDeckProvider | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "openai" || normalized === "anthropic" || normalized === "google") {
    return normalized;
  }
  return null;
}

function normalizeBaseUrl(provider: CyDeckProvider, value: string): string {
  const trimmed = value.trim();
  return trimmed || DEFAULT_PROVIDER_BASE_URLS[provider];
}

function getProviderModelFromDocument(
  document: Record<string, unknown>,
  provider: CyDeckProvider,
): string | undefined {
  const ai = asRecord(document.ai);
  const providers = asRecord(ai?.providers);
  const providerNode = asRecord(providers?.[provider]);
  const model = providerNode?.model;
  if (typeof model !== "string") {
    return undefined;
  }
  const trimmed = model.trim();
  return trimmed ? trimmed : undefined;
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
      title: "CyDeck Settings",
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
 * Load settings from cydeck.json.
 */
export function loadSettings(env: NodeJS.ProcessEnv = process.env): SettingsLoadResult {
  try {
    const effective = getEffectiveConfig(env);
    const provider = effective.config.ai.defaultProvider;
    const providerConfig = effective.config.ai.providers[provider];

    return {
      success: true,
      data: {
        provider,
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        gatewayPort: effective.config.gateway.port,
        autoStartGateway: effective.config.gateway.autoStart,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Save settings into cydeck.json.
 */
export async function saveSettings(
  data: SettingsData,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SettingsSaveResult> {
  try {
    const provider = normalizeProvider(data.provider);
    if (!provider) {
      return { success: false, error: `Unsupported provider: ${data.provider}` };
    }

    const apiKey = data.apiKey.trim();
    if (!apiKey) {
      return { success: false, error: "API key cannot be empty" };
    }

    if (!Number.isInteger(data.gatewayPort) || data.gatewayPort < 1 || data.gatewayPort > 65535) {
      return { success: false, error: "gatewayPort must be an integer between 1 and 65535" };
    }

    const editable = loadEditableCyDeckConfigDocument(env);
    if (!editable.success || !editable.document) {
      return {
        success: false,
        error: editable.error ?? "Failed to load editable config document",
      };
    }

    assignConfigPathValue(editable.document, "ai.defaultProvider", provider);
    assignConfigPathValue(editable.document, `ai.providers.${provider}.apiKey`, apiKey);
    assignConfigPathValue(editable.document, `ai.providers.${provider}.baseUrl`, normalizeBaseUrl(provider, data.baseUrl));
    assignConfigPathValue(editable.document, "gateway.port", data.gatewayPort);
    assignConfigPathValue(editable.document, "gateway.autoStart", data.autoStartGateway);

    const existingModel = getProviderModelFromDocument(editable.document, provider);
    if (!existingModel) {
      assignConfigPathValue(editable.document, `ai.providers.${provider}.model`, DEFAULT_PROVIDER_MODELS[provider]);
    }

    const writeResult = writeCyDeckConfigDocument(editable.configPath, editable.stateDir, editable.document);
    if (!writeResult.success) {
      return {
        success: false,
        error: writeResult.error ?? "Failed to write settings",
      };
    }

    console.log("[Settings] Saved to cydeck config:", {
      provider,
      gatewayPort: data.gatewayPort,
      autoStartGateway: data.autoStartGateway,
    });
    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[Settings] Error saving settings:", errorMsg);
    return { success: false, error: errorMsg };
  }
}
