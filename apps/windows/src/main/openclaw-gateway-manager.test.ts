import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
  },
}));

import { OpenClawGatewayManager } from "./openclaw-gateway-manager.js";
import type { CyDeckEffectiveConfig } from "./cydeck-config.js";

class FakeChildProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 4242;
  killed = false;

  kill(): boolean {
    this.killed = true;
    queueMicrotask(() => {
      this.emit("exit", 0, null);
    });
    return true;
  }
}

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cydeck-gateway-manager-"));
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

describe("OpenClawGatewayManager", () => {
  it("spawns the root gateway with isolated config/runtime env", async () => {
    const stateDir = createTempDir();
    const effectiveConfig = makeEffectiveConfig(stateDir);
    const child = new FakeChildProcess();
    const spawnImpl = vi.fn(() => child as any);
    const waitForPortImpl = vi.fn(async () => undefined);

    const manager = new OpenClawGatewayManager(19001, "gateway-token-123", {
      effectiveConfig,
      spawnImpl,
      waitForPortImpl,
      log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await manager.start();

    expect(spawnImpl).toHaveBeenCalledTimes(1);
    const spawnArgs = spawnImpl.mock.calls[0] as unknown as [
      string,
      string[],
      {
        env: NodeJS.ProcessEnv;
        cwd: string;
      },
    ];
    expect(spawnArgs[0]).toBe("node");
    expect(spawnArgs[1][0]).toContain("scripts");
    expect(spawnArgs[1][0]).toContain("run-node.mjs");
    const options = spawnArgs?.[2] as {
      env: NodeJS.ProcessEnv;
      cwd: string;
    };
    expect(options.env.OPENCLAW_GATEWAY_TOKEN).toBe("gateway-token-123");
    expect(options.env.OPENCLAW_CONFIG_PATH).toContain("openclaw-gateway");
    expect(options.env.OPENCLAW_CYDECK_RUNTIME_PATH).toContain("cydeck-runtime.json");
    expect(manager.getState().status).toBe("running");
    expect(manager.getState().pid).toBe(4242);

    await manager.stop();
    expect(manager.getState().status).toBe("stopped");
  });

  it("rewrites the runtime descriptor when workspace path changes", () => {
    const stateDir = createTempDir();
    const effectiveConfig = makeEffectiveConfig(stateDir);
    const manager = new OpenClawGatewayManager(19001, "gateway-token-456", {
      effectiveConfig,
      spawnImpl: vi.fn(() => new FakeChildProcess() as any),
      waitForPortImpl: vi.fn(async () => undefined),
      log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    const nextWorkspace = path.join(stateDir, "workspace-next");
    manager.reloadWorkspacePath(nextWorkspace);

    const runtimePath = path.join(stateDir, "openclaw-gateway", "state", "cydeck-runtime.json");
    const runtime = JSON.parse(fs.readFileSync(runtimePath, "utf-8")) as Record<string, any>;
    expect(runtime.workspacePath).toBe(nextWorkspace);
  });
});
