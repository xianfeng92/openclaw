import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import { agentHandlers } from "./agent.js";

const mocks = vi.hoisted(() => ({
  cfg: {} as OpenClawConfig,
}));

vi.mock("../../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => mocks.cfg,
  };
});

describe("gateway agent.identity.get", () => {
  let workspaceDir: string | null = null;

  afterEach(async () => {
    if (workspaceDir) {
      await fs.rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
      workspaceDir = null;
    }
  });

  it("does not return /avatar/<id> when the configured local avatar path is missing", () => {
    return (async () => {
      workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-identity-"));
      await fs.writeFile(
        path.join(workspaceDir, "IDENTITY.md"),
        [
          "# IDENTITY.md - Agent Identity",
          "",
          "- **Name:** C-3PO",
          "- **Emoji:** 🤖 (or ⚠️ when alarmed)",
          "- **Avatar:** avatars/c3po.png",
          "",
        ].join("\n"),
        "utf-8",
      );

      mocks.cfg = {
        agents: {
          list: [{ id: "main", workspace: workspaceDir }],
        },
      } as OpenClawConfig;

      const respond = vi.fn();
      agentHandlers["agent.identity.get"]({
        params: { agentId: "main" },
        respond,
        context: {} as unknown as Parameters<(typeof agentHandlers)["agent.identity.get"]>[0]["context"],
        client: null,
        req: { id: "req-1", type: "req", method: "agent.identity.get" },
        isWebchatConnect: () => false,
      });

      expect(respond).toHaveBeenCalledWith(
        true,
        expect.objectContaining({
          avatar: "🤖",
        }),
        undefined,
      );
    })();
  });

  it("returns /avatar/<id> when the configured local avatar file exists", () => {
    return (async () => {
      workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-identity-"));
      await fs.mkdir(path.join(workspaceDir, "avatars"), { recursive: true });
      await fs.writeFile(path.join(workspaceDir, "avatars", "c3po.png"), "x");
      await fs.writeFile(
        path.join(workspaceDir, "IDENTITY.md"),
        [
          "# IDENTITY.md - Agent Identity",
          "",
          "- **Name:** C-3PO",
          "- **Emoji:** 🤖",
          "- **Avatar:** avatars/c3po.png",
          "",
        ].join("\n"),
        "utf-8",
      );

      mocks.cfg = {
        agents: {
          list: [{ id: "main", workspace: workspaceDir }],
        },
      } as OpenClawConfig;

      const respond = vi.fn();
      agentHandlers["agent.identity.get"]({
        params: { agentId: "main" },
        respond,
        context: {} as unknown as Parameters<(typeof agentHandlers)["agent.identity.get"]>[0]["context"],
        client: null,
        req: { id: "req-2", type: "req", method: "agent.identity.get" },
        isWebchatConnect: () => false,
      });

      expect(respond).toHaveBeenCalledWith(
        true,
        expect.objectContaining({
          avatar: "/avatar/main",
        }),
        undefined,
      );
    })();
  });
});
