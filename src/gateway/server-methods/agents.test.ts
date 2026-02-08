import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentsHandlers } from "./agents.js";

const mocks = vi.hoisted(() => ({
  cfg: {} as Record<string, unknown>,
  workspaceDir: "" as string,
  listAgentsForGateway: vi.fn(),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => mocks.cfg,
}));

vi.mock("../session-utils.js", () => ({
  listAgentsForGateway: (...args: unknown[]) => mocks.listAgentsForGateway(...args),
}));

vi.mock("../../agents/agent-scope.js", () => ({
  resolveAgentWorkspaceDir: () => mocks.workspaceDir,
}));

describe("gateway agents handler (files)", () => {
  afterEach(async () => {
    mocks.listAgentsForGateway.mockReset();
    if (mocks.workspaceDir) {
      const dir = mocks.workspaceDir;
      mocks.workspaceDir = "";
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("accepts agent ids returned by agents.list (normalized)", async () => {
    mocks.workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-agents-files-"));
    mocks.listAgentsForGateway.mockReturnValue({
      defaultId: "dev",
      mainKey: "main",
      scope: "per-sender",
      agents: [{ id: "dev" }, { id: "main" }],
    });

    const respond = vi.fn();
    await agentsHandlers["agents.files.list"]({
      params: { agentId: "Dev" },
      respond,
      context: {} as unknown as Parameters<(typeof agentsHandlers)["agents.files.list"]>[0]["context"],
      client: null,
      req: { id: "req-1", type: "req", method: "agents.files.list" },
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        agentId: "dev",
        workspace: mocks.workspaceDir,
        files: expect.any(Array),
      }),
      undefined,
    );
  });

  it("rejects agent ids not present in agents.list", async () => {
    mocks.workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-agents-files-"));
    mocks.listAgentsForGateway.mockReturnValue({
      defaultId: "dev",
      mainKey: "main",
      scope: "per-sender",
      agents: [{ id: "dev" }],
    });

    const respond = vi.fn();
    await agentsHandlers["agents.files.list"]({
      params: { agentId: "main" },
      respond,
      context: {} as unknown as Parameters<(typeof agentsHandlers)["agents.files.list"]>[0]["context"],
      client: null,
      req: { id: "req-2", type: "req", method: "agents.files.list" },
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: "unknown agent id",
      }),
    );
  });
});

