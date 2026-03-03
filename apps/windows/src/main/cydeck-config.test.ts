import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getEffectiveConfig,
  loadCyDeckConfig,
  resolveCyDeckConfigPath,
  resolveCyDeckStateDir,
  validateCyDeckConfig,
} from "./cydeck-config.js";

function makeEnv(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

function writeConfig(configPath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cydeck-config-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("cydeck-config path resolution", () => {
  it("uses CYDECK_CONFIG_PATH over CYDECK_STATE_DIR", () => {
    const tempDir = createTempDir();
    const explicitPath = path.join(tempDir, "custom-config.json");
    const env = makeEnv({
      CYDECK_STATE_DIR: path.join(tempDir, "state"),
      CYDECK_CONFIG_PATH: explicitPath,
    });

    expect(resolveCyDeckStateDir(env)).toBe(path.join(tempDir, "state"));
    expect(resolveCyDeckConfigPath(env)).toBe(explicitPath);
  });

  it("defaults config path to <stateDir>/cydeck.json", () => {
    const tempDir = createTempDir();
    const env = makeEnv({
      CYDECK_STATE_DIR: tempDir,
    });

    expect(resolveCyDeckConfigPath(env)).toBe(path.join(tempDir, "cydeck.json"));
  });
});

describe("cydeck-config load + env substitution", () => {
  it("creates default config file when missing", () => {
    const tempDir = createTempDir();
    const env = makeEnv({
      CYDECK_STATE_DIR: tempDir,
      OPENAI_API_KEY: "sk-openai",
      ANTHROPIC_API_KEY: "sk-anthropic",
      GEMINI_API_KEY: "sk-gemini",
    });

    const result = loadCyDeckConfig(env);
    expect(result.fromFile).toBe(false);
    expect(fs.existsSync(path.join(tempDir, "cydeck.json"))).toBe(true);
    expect(result.config.ai.providers.openai.apiKey).toBe("sk-openai");
  });

  it("resolves ${ENV_VAR} and keeps $${ENV_VAR} as literal", () => {
    const tempDir = createTempDir();
    const configPath = path.join(tempDir, "cydeck.json");
    writeConfig(configPath, {
      ai: {
        defaultProvider: "openai",
        providers: {
          openai: {
            apiKey: "${OPENAI_API_KEY}",
            baseUrl: "https://api.openai.com/v1",
            model: "$${OPENAI_MODEL}",
            maxTokens: 1024,
          },
        },
      },
    });

    const env = makeEnv({
      CYDECK_STATE_DIR: tempDir,
      OPENAI_API_KEY: "sk-openai",
      ANTHROPIC_API_KEY: "sk-anthropic",
      GEMINI_API_KEY: "sk-gemini",
    });
    const result = loadCyDeckConfig(env);

    expect(result.config.ai.providers.openai.apiKey).toBe("sk-openai");
    expect(result.config.ai.providers.openai.model).toBe("${OPENAI_MODEL}");
  });

  it("returns structured missing env issues when template vars are unset", () => {
    const tempDir = createTempDir();
    const configPath = path.join(tempDir, "cydeck.json");
    writeConfig(configPath, {
      ai: {
        defaultProvider: "openai",
        providers: {
          openai: {
            apiKey: "${OPENAI_API_KEY}",
            baseUrl: "https://api.openai.com/v1",
            model: "gpt-4o-mini",
            maxTokens: 1024,
          },
          anthropic: {
            apiKey: "${ANTHROPIC_API_KEY}",
            baseUrl: "https://api.anthropic.com/v1",
            model: "claude-3-5-sonnet",
            maxTokens: 8192,
          },
          google: {
            apiKey: "${GEMINI_API_KEY}",
            baseUrl: "https://generativelanguage.googleapis.com/v1beta",
            model: "gemini-2.0-flash",
            maxTokens: 8192,
          },
        },
      },
    });

    const env = makeEnv({
      CYDECK_STATE_DIR: tempDir,
      ANTHROPIC_API_KEY: "sk-anthropic",
      GEMINI_API_KEY: "sk-gemini",
    });
    const result = loadCyDeckConfig(env);

    expect(
      result.issues.some(
        (issue) => issue.code === "missing_env_var" && issue.varName === "OPENAI_API_KEY",
      ),
    ).toBe(true);
  });
});

describe("cydeck-config validation/effective config", () => {
  it("fails validation when gateway port is out of range", () => {
    const tempDir = createTempDir();
    const env = makeEnv({
      CYDECK_STATE_DIR: tempDir,
      OPENAI_API_KEY: "sk-openai",
      ANTHROPIC_API_KEY: "sk-anthropic",
      GEMINI_API_KEY: "sk-gemini",
    });

    const loaded = loadCyDeckConfig(env);
    const invalid = {
      ...loaded.config,
      gateway: {
        ...loaded.config.gateway,
        port: 70000,
      },
    };

    const validation = validateCyDeckConfig(invalid);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((msg) => msg.includes("gateway.port"))).toBe(true);
  });

  it("resolves workspace path relative to config directory", () => {
    const tempDir = createTempDir();
    const configPath = path.join(tempDir, "cydeck.json");
    writeConfig(configPath, {
      workspace: {
        path: "./workspace-relative",
        autoCreate: false,
      },
      ai: {
        defaultProvider: "openai",
      },
    });

    const env = makeEnv({
      CYDECK_STATE_DIR: tempDir,
      OPENAI_API_KEY: "sk-openai",
      ANTHROPIC_API_KEY: "sk-anthropic",
      GEMINI_API_KEY: "sk-gemini",
    });
    const result = getEffectiveConfig(env);

    expect(result.workspacePath).toBe(path.join(tempDir, "workspace-relative"));
    expect(result.config.workspace.path).toBe(path.join(tempDir, "workspace-relative"));
    expect(
      result.validation.warnings.some((msg) =>
        msg.includes("workspace.path does not exist and workspace.autoCreate is false"),
      ),
    ).toBe(true);
  });
});
