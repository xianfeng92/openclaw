import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  resolveStateDir: vi.fn(),
  listAgentIds: vi.fn(),
  resolveAgentWorkspaceDir: vi.fn(),
  resolveDefaultAgentId: vi.fn(),
  runEmbeddedPiAgent: vi.fn(),
  loadModelCatalog: vi.fn(),
}));

vi.mock("../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("../config/paths.js", () => ({
  resolveStateDir: mocks.resolveStateDir,
}));

vi.mock("../agents/agent-scope.js", () => ({
  listAgentIds: mocks.listAgentIds,
  resolveAgentWorkspaceDir: mocks.resolveAgentWorkspaceDir,
  resolveDefaultAgentId: mocks.resolveDefaultAgentId,
}));

vi.mock("../agents/pi-embedded-runner/run.js", () => ({
  runEmbeddedPiAgent: mocks.runEmbeddedPiAgent,
}));

vi.mock("../agents/model-catalog.js", () => ({
  loadModelCatalog: mocks.loadModelCatalog,
}));

import { LocalAdapter } from "./local-adapter.js";

describe("LocalAdapter", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-local-adapter-"));
    mocks.loadConfig.mockReturnValue({});
    mocks.resolveStateDir.mockReturnValue(stateDir);
    mocks.listAgentIds.mockReturnValue(["main"]);
    mocks.resolveAgentWorkspaceDir.mockReturnValue(path.join(stateDir, "workspace-main"));
    mocks.resolveDefaultAgentId.mockReturnValue("main");
    mocks.runEmbeddedPiAgent.mockReset();
    mocks.loadModelCatalog.mockReset();
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("maps catalog entries into adapter model choices", async () => {
    mocks.loadModelCatalog.mockResolvedValue([
      {
        id: "gpt-4o-mini",
        name: "GPT-4o Mini",
        provider: "openai",
        contextWindow: 128000,
        reasoning: true,
      },
    ]);

    const adapter = new LocalAdapter();
    const result = await adapter.listModels();

    expect(mocks.loadModelCatalog).toHaveBeenCalledWith({ config: {} });
    expect(result).toEqual({
      models: [
        {
          id: "gpt-4o-mini",
          name: "GPT-4o Mini",
          provider: "openai",
          contextWindow: 128000,
          reasoning: true,
        },
      ],
    });
  });

  it("uses the current embedded runner contract and emits final chat events", async () => {
    mocks.runEmbeddedPiAgent.mockResolvedValue({
      payloads: [{ text: "Local adapter works" }],
      meta: { durationMs: 10, stopReason: "completed" },
    });

    const adapter = new LocalAdapter();
    const listener = vi.fn();
    adapter.onEvent(listener);
    await adapter.start();

    const result = await adapter.sendChat({
      sessionKey: "agent:main:main",
      message: "hello",
      timeoutMs: 1234,
      runId: "run-123",
    });

    expect(result).toEqual({ runId: "run-123", status: "complete" });
    expect(mocks.runEmbeddedPiAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "agent:main:main",
        sessionKey: "agent:main:main",
        sessionFile: path.join(stateDir, "sessions", "agent:main:main.jsonl"),
        workspaceDir: path.join(stateDir, "workspace-main"),
        agentId: "main",
        prompt: "hello",
        timeoutMs: 1234,
        runId: "run-123",
        config: {},
      }),
    );
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "chat",
        payload: expect.objectContaining({
          runId: "run-123",
          sessionKey: "agent:main:main",
          state: "final",
          message: expect.objectContaining({
            role: "assistant",
            content: "Local adapter works",
          }),
        }),
      }),
    );
  });
});
