import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_CYDECK_CONFIG,
  resolveCyDeckConfigPath,
  resolveCyDeckStateDir,
} from "./cydeck-config.js";

type EditableConfigLoadResult = {
  success: boolean;
  configPath: string;
  stateDir: string;
  document?: Record<string, unknown>;
  error?: string;
};

type EditableConfigWriteResult = {
  success: boolean;
  error?: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function cloneDefaultCyDeckConfigRecord(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(DEFAULT_CYDECK_CONFIG)) as Record<string, unknown>;
}

export function loadEditableCyDeckConfigDocument(
  env: NodeJS.ProcessEnv = process.env,
): EditableConfigLoadResult {
  const configPath = resolveCyDeckConfigPath(env);
  const stateDir = resolveCyDeckStateDir(env);

  if (!fs.existsSync(configPath)) {
    return {
      success: true,
      configPath,
      stateDir,
      document: cloneDefaultCyDeckConfigRecord(),
    };
  }

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    if (!raw.trim()) {
      return {
        success: true,
        configPath,
        stateDir,
        document: {},
      };
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) {
      return {
        success: false,
        configPath,
        stateDir,
        error: `Config file must contain a JSON object: ${configPath}`,
      };
    }

    return {
      success: true,
      configPath,
      stateDir,
      document: parsed,
    };
  } catch (err) {
    return {
      success: false,
      configPath,
      stateDir,
      error: `Failed to read config file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function writeCyDeckConfigDocument(
  configPath: string,
  stateDir: string,
  document: Record<string, unknown>,
): EditableConfigWriteResult {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(document, null, 2)}\n`, "utf-8");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: `Failed to write config file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
