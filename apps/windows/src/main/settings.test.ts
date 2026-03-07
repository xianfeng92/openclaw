import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSettings, saveSettings } from "./settings.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cydeck-settings-test-"));
  tempDirs.push(dir);
  return dir;
}

function makeEnv(stateDir: string): NodeJS.ProcessEnv {
  return {
    CYDECK_STATE_DIR: stateDir,
    OPENAI_API_KEY: "openai-from-env",
    ANTHROPIC_API_KEY: "anthropic-from-env",
    GEMINI_API_KEY: "gemini-from-env",
  };
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
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

describe("settings save/load", () => {
  it("writes selected provider and gateway settings into cydeck.json", async () => {
    const stateDir = createTempDir();
    const env = makeEnv(stateDir);

    const saveResult = await saveSettings(
      {
        provider: "anthropic",
        apiKey: "sk-anthropic-123",
        baseUrl: "",
        gatewayPort: 19077,
        autoStartGateway: false,
      },
      env,
    );

    expect(saveResult).toEqual({ success: true });

    const configPath = path.join(stateDir, "cydeck.json");
    const raw = readJson(configPath);
    const ai = raw.ai as Record<string, unknown>;
    const providers = ai.providers as Record<string, unknown>;
    const anthropic = providers.anthropic as Record<string, unknown>;
    const gateway = raw.gateway as Record<string, unknown>;

    expect(ai.defaultProvider).toBe("anthropic");
    expect(anthropic.apiKey).toBe("sk-anthropic-123");
    expect(anthropic.baseUrl).toBe("https://api.anthropic.com/v1");
    expect(gateway.port).toBe(19077);
    expect(gateway.autoStart).toBe(false);
  });

  it("fills provider default model when stored model is blank", async () => {
    const stateDir = createTempDir();
    const env = makeEnv(stateDir);
    const configPath = path.join(stateDir, "cydeck.json");

    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          version: 1,
          ai: {
            defaultProvider: "google",
            providers: {
              google: {
                apiKey: "old-key",
                baseUrl: "https://generativelanguage.googleapis.com/v1beta",
                model: "",
                maxTokens: 1024,
              },
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );

    const saveResult = await saveSettings(
      {
        provider: "google",
        apiKey: "sk-google-789",
        baseUrl: "",
        gatewayPort: 19001,
        autoStartGateway: true,
      },
      env,
    );

    expect(saveResult.success).toBe(true);

    const raw = readJson(configPath);
    const ai = raw.ai as Record<string, unknown>;
    const providers = ai.providers as Record<string, unknown>;
    const google = providers.google as Record<string, unknown>;
    expect(google.model).toBe("gemini-2.0-flash");
  });

  it("loadSettings returns effective values from current default provider", async () => {
    const stateDir = createTempDir();
    const env = makeEnv(stateDir);

    await saveSettings(
      {
        provider: "openai",
        apiKey: "sk-openai-xyz",
        baseUrl: "https://proxy.example.com/v1",
        gatewayPort: 19111,
        autoStartGateway: true,
      },
      env,
    );

    const loaded = loadSettings(env);
    expect(loaded.success).toBe(true);
    expect(loaded.data).toEqual({
      provider: "openai",
      apiKey: "sk-openai-xyz",
      baseUrl: "https://proxy.example.com/v1",
      gatewayPort: 19111,
      autoStartGateway: true,
    });
  });

  it("rejects invalid provider and invalid port", async () => {
    const stateDir = createTempDir();
    const env = makeEnv(stateDir);

    const invalidProvider = await saveSettings(
      {
        provider: "foo",
        apiKey: "sk-foo",
        baseUrl: "",
        gatewayPort: 19001,
        autoStartGateway: true,
      },
      env,
    );
    const invalidPort = await saveSettings(
      {
        provider: "openai",
        apiKey: "sk-openai",
        baseUrl: "",
        gatewayPort: 70000,
        autoStartGateway: true,
      },
      env,
    );

    expect(invalidProvider.success).toBe(false);
    expect(invalidProvider.error).toContain("Unsupported provider");
    expect(invalidPort.success).toBe(false);
    expect(invalidPort.error).toContain("gatewayPort");
  });
});
