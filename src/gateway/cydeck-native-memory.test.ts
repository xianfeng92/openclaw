import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { resolveMemorySearchConfig } from "../agents/memory-search.js";
import { resolveStateDir } from "../config/paths.js";
import { buildCyDeckMemoryConfig } from "./cydeck-native-memory.js";

describe("buildCyDeckMemoryConfig", () => {
  it("overrides the resolved workspace for the target agent", () => {
    const cfg = {
      agents: {
        defaults: {
          workspace: "/tmp/default-workspace",
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
          },
        },
        list: [{ id: "main", default: true }],
      },
    };

    const next = buildCyDeckMemoryConfig({
      cfg,
      agentId: "main",
      workspacePath: "/tmp/cydeck-workspace",
    });

    expect(resolveAgentWorkspaceDir(next, "main")).toBe(path.resolve("/tmp/cydeck-workspace"));
  });

  it("isolates the memory sqlite path when CyDeck uses a different workspace", () => {
    const cfg = {
      agents: {
        defaults: {
          workspace: "/tmp/default-workspace",
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: {
              path: "/tmp/openclaw-memory/main.sqlite",
              vector: { enabled: false },
            },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };

    const next = buildCyDeckMemoryConfig({
      cfg,
      agentId: "main",
      workspacePath: "/tmp/cydeck-workspace",
    });

    const resolved = resolveMemorySearchConfig(next, "main");
    expect(resolved?.store.path).toContain(path.join(resolveStateDir(), "memory"));
    expect(path.basename(resolved?.store.path ?? "")).toMatch(/^cydeck-main-[a-f0-9]{12}\.sqlite$/);
  });

  it("keeps the configured sqlite path when the workspace already matches", () => {
    const cfg = {
      agents: {
        defaults: {
          workspace: "/tmp/shared-workspace",
          memorySearch: {
            provider: "openai",
            model: "mock-embed",
            store: {
              path: "/tmp/openclaw-memory/shared.sqlite",
              vector: { enabled: false },
            },
          },
        },
        list: [{ id: "main", default: true }],
      },
    };

    const next = buildCyDeckMemoryConfig({
      cfg,
      agentId: "main",
      workspacePath: "/tmp/shared-workspace",
    });

    const resolved = resolveMemorySearchConfig(next, "main");
    expect(resolved?.store.path).toBe(path.resolve("/tmp/openclaw-memory/shared.sqlite"));
  });
});
