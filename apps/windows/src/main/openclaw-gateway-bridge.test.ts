import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCyDeckOpenClawEnv,
  writeCyDeckOpenClawBridge,
} from "./openclaw-gateway-bridge.js";
import type { CyDeckEffectiveConfig } from "./cydeck-config.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cydeck-openclaw-bridge-"));
  tempDirs.push(dir);
  return dir;
}

function makeEffectiveConfig(stateDir: string): CyDeckEffectiveConfig {
  return {
    config: {
      version: 1,
      ai: {
        defaultProvider: "openai",
        providers: {
          openai: {
            apiKey: "sk-openai",
            baseUrl: "https://api.openai.com/v1",
            model: "gpt-4o-mini",
            maxTokens: 4096,
          },
          anthropic: {
            apiKey: "sk-anthropic",
            baseUrl: "https://api.anthropic.com/v1",
            model: "claude-3-5-sonnet",
            maxTokens: 8192,
          },
          google: {
            apiKey: "sk-google",
            baseUrl: "https://generativelanguage.googleapis.com/v1beta",
            model: "gemini-2.0-flash",
            maxTokens: 8192,
          },
        },
      },
      workspace: {
        path: path.join(stateDir, "workspace"),
        autoCreate: true,
      },
      gateway: {
        port: 19001,
        autoStart: true,
      },
      ui: {
        theme: "cydeck",
      },
      terminal: {
        allowShell: false,
      },
    },
    configPath: path.join(stateDir, "cydeck.json"),
    stateDir,
    fromFile: true,
    validation: {
      valid: true,
      errors: [],
      warnings: [],
      issues: [],
    },
    warnings: [],
    issues: [],
    runtimeProvider: {
      provider: "openai",
      apiKey: "sk-openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      maxTokens: 4096,
    },
    workspacePath: path.join(stateDir, "workspace"),
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("openclaw-gateway-bridge", () => {
  it("writes an isolated OpenClaw config and runtime descriptor", () => {
    const stateDir = createTempDir();
    const effectiveConfig = makeEffectiveConfig(stateDir);

    const paths = writeCyDeckOpenClawBridge({
      config: effectiveConfig,
      authToken: "cydeck-token-123",
    });

    expect(fs.existsSync(paths.configPath)).toBe(true);
    expect(fs.existsSync(paths.runtimePath)).toBe(true);

    const config = JSON.parse(fs.readFileSync(paths.configPath, "utf-8")) as Record<string, any>;
    expect(config.gateway.auth.token).toBe("cydeck-token-123");
    expect(config.agents.defaults.model.primary).toBe("openai/gpt-4o-mini");
    expect(config.models.providers.openai.baseUrl).toBe("https://api.openai.com/v1");

    const runtime = JSON.parse(fs.readFileSync(paths.runtimePath, "utf-8")) as Record<string, any>;
    expect(runtime.workspacePath).toBe(effectiveConfig.workspacePath);
    expect(runtime.version).toBe(1);
  });

  it("builds child env overrides for the spawned root gateway", () => {
    const stateDir = createTempDir();
    const effectiveConfig = makeEffectiveConfig(stateDir);
    const paths = writeCyDeckOpenClawBridge({
      config: effectiveConfig,
      authToken: "cydeck-token-456",
    });

    const env = buildCyDeckOpenClawEnv({
      config: effectiveConfig,
      authToken: "cydeck-token-456",
      paths,
    });

    expect(env.OPENCLAW_STATE_DIR).toBe(paths.stateDir);
    expect(env.OPENCLAW_CONFIG_PATH).toBe(paths.configPath);
    expect(env.OPENCLAW_CYDECK_RUNTIME_PATH).toBe(paths.runtimePath);
    expect(env.OPENCLAW_GATEWAY_TOKEN).toBe("cydeck-token-456");
    expect(env.OPENAI_API_KEY).toBe("sk-openai");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-anthropic");
    expect(env.GEMINI_API_KEY).toBe("sk-google");
  });
});
