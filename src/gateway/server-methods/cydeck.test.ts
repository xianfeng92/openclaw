import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandlerOptions, RespondFn } from "./types.js";
import type { MemorySearchManager } from "../../memory/types.js";

const mocks = vi.hoisted(() => ({
  loadSessionEntry: vi.fn(),
  readSessionMessages: vi.fn(),
  getCyDeckMemoryManager: vi.fn(),
}));

vi.mock("../session-utils.js", () => ({
  loadSessionEntry: mocks.loadSessionEntry,
  readSessionMessages: mocks.readSessionMessages,
}));

vi.mock("../cydeck-native-memory.js", () => ({
  getCyDeckMemoryManager: mocks.getCyDeckMemoryManager,
}));

import { cydeckHandlers } from "./cydeck.js";

const tempDirs: string[] = [];
const originalRuntimePath = process.env.OPENCLAW_CYDECK_RUNTIME_PATH;

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-gateway-cydeck-"));
  tempDirs.push(dir);
  return dir;
}

function writeRuntimeDescriptor(workspacePath: string): string {
  const rootDir = makeTempDir();
  const runtimePath = path.join(rootDir, "cydeck-runtime.json");
  fs.writeFileSync(
    runtimePath,
    JSON.stringify(
      {
        version: 1,
        workspacePath,
        updatedAt: "2026-03-07T08:30:00.000Z",
      },
      null,
      2,
    ),
    "utf-8",
  );
  process.env.OPENCLAW_CYDECK_RUNTIME_PATH = runtimePath;
  return runtimePath;
}

async function callHandler(
  method: keyof typeof cydeckHandlers,
  params: Record<string, unknown>,
  respond: RespondFn,
) {
  await cydeckHandlers[method]({
    req: { type: "req", id: `req-${method}`, method },
    params,
    client: null,
    context: {} as GatewayRequestHandlerOptions["context"],
    respond,
    isWebchatConnect: () => false,
  } as GatewayRequestHandlerOptions);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  if (originalRuntimePath) {
    process.env.OPENCLAW_CYDECK_RUNTIME_PATH = originalRuntimePath;
  } else {
    delete process.env.OPENCLAW_CYDECK_RUNTIME_PATH;
  }
  vi.useRealTimers();
});

describe("cydeckHandlers", () => {
  beforeEach(() => {
    mocks.loadSessionEntry.mockReset();
    mocks.readSessionMessages.mockReset();
    mocks.getCyDeckMemoryManager.mockReset();
  });

  it("searches workspace memory files for private sessions via the native memory manager", async () => {
    const workspaceDir = makeTempDir();
    writeRuntimeDescriptor(workspaceDir);
    const manager: MemorySearchManager = {
      search: vi.fn().mockResolvedValue([
        {
          path: "MEMORY.md",
          startLine: 3,
          endLine: 3,
          score: 0.91,
          snippet: "CyDeck roadmap note: unify the root gateway runtime.",
          source: "memory",
        },
      ]),
      readFile: vi.fn(),
      status: vi.fn(),
      probeEmbeddingAvailability: vi.fn(),
      probeVectorAvailability: vi.fn(),
    };
    mocks.getCyDeckMemoryManager.mockResolvedValue({
      manager,
      agentId: "main",
      cfg: {},
    });

    const respond = vi.fn<RespondFn>();
    await callHandler(
      "tools.memory.search",
      {
        query: "gateway runtime",
        sessionKey: "main",
      },
      respond,
    );

    expect(respond).toHaveBeenCalledTimes(1);
    expect(mocks.getCyDeckMemoryManager).toHaveBeenCalledWith({
      workspacePath: workspaceDir,
      sessionKey: "main",
    });
    expect(manager.search).toHaveBeenCalledWith("gateway runtime", {
      maxResults: undefined,
      minScore: undefined,
      sessionKey: "main",
    });
    const payload = respond.mock.calls[0]?.[1] as {
      results?: Array<{ path?: string; snippet?: string }>;
    };
    expect(payload.results?.some((result) => result.path === "MEMORY.md")).toBe(true);
    expect(payload.results?.some((result) => result.snippet?.includes("gateway runtime"))).toBe(
      true,
    );
  });

  it("skips memory search for shared sessions", async () => {
    const workspaceDir = makeTempDir();
    writeRuntimeDescriptor(workspaceDir);

    const respond = vi.fn<RespondFn>();
    await callHandler(
      "tools.memory.search",
      {
        query: "project roadmap",
        sessionKey: "group:engineering",
      },
      respond,
    );

    expect(respond).toHaveBeenCalledWith(
      true,
      { results: [] },
    );
    expect(mocks.getCyDeckMemoryManager).not.toHaveBeenCalled();
  });

  it("rejects invalid tools.memory.get paths via the native manager", async () => {
    const workspaceDir = makeTempDir();
    writeRuntimeDescriptor(workspaceDir);
    const manager: MemorySearchManager = {
      search: vi.fn(),
      readFile: vi.fn().mockRejectedValue(new Error("path required")),
      status: vi.fn(),
      probeEmbeddingAvailability: vi.fn(),
      probeVectorAvailability: vi.fn(),
    };
    mocks.getCyDeckMemoryManager.mockResolvedValue({
      manager,
      agentId: "main",
      cfg: {},
    });

    const respond = vi.fn<RespondFn>();
    await callHandler(
      "tools.memory.get",
      {
        path: "../secret.txt",
      },
      respond,
    );

    expect(manager.readFile).toHaveBeenCalledWith({
      relPath: "../secret.txt",
      from: undefined,
      lines: undefined,
    });
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
      }),
    );
  });

  it("writes a session snapshot on session.rotate", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T08:30:00.000Z"));

    const workspaceDir = makeTempDir();
    writeRuntimeDescriptor(workspaceDir);
    mocks.loadSessionEntry.mockReturnValue({
      storePath: path.join(workspaceDir, "sessions.json"),
      entry: { sessionId: "sess-1" },
    });
    mocks.readSessionMessages.mockReturnValue([
      {
        role: "user",
        content: [{ type: "text", text: "Need to remember the gateway plan." }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Captured for the next session." }],
      },
    ]);

    const respond = vi.fn<RespondFn>();
    await callHandler(
      "session.rotate",
      {
        fromSessionKey: "main",
      },
      respond,
    );

    const memoryFile = path.join(workspaceDir, "memory", "2026-03-07-main.md");
    expect(fs.existsSync(memoryFile)).toBe(true);
    expect(fs.readFileSync(memoryFile, "utf-8")).toContain("Need to remember the gateway plan.");
    expect(fs.readFileSync(memoryFile, "utf-8")).toContain("Captured for the next session.");
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        saved: true,
        relativePath: "memory/2026-03-07-main.md",
        messageCount: 2,
      }),
    );
  });
});
