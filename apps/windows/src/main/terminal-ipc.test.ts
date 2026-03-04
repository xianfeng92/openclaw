import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipcMainHandleMock = vi.fn();
const ipcMainOnMock = vi.fn();
const getAgentManagerMock = vi.fn();

vi.mock("electron", () => ({
  ipcMain: {
    handle: ipcMainHandleMock,
    on: ipcMainOnMock,
  },
  app: {
    isPackaged: false,
  },
}));

type OrchestralTasksHandler = (
  event: unknown,
  filters: Record<string, string>,
  action?: string,
) => Promise<{ success: boolean; error?: string; message?: string }>;

function getIpcHandler(channel: string): OrchestralTasksHandler {
  for (let i = ipcMainHandleMock.mock.calls.length - 1; i >= 0; i--) {
    const call = ipcMainHandleMock.mock.calls[i];
    if (call && call[0] === channel) {
      return call[1] as OrchestralTasksHandler;
    }
  }
  throw new Error(`IPC handler not found for channel: ${channel}`);
}

function createStoppedTask(taskId: string): {
  id: string;
  status: "completed";
} {
  return {
    id: taskId,
    status: "completed",
  };
}

describe("terminal-ipc orchestral tasks", () => {
  let previousCwd = process.cwd();
  let tempProjectDir = "";

  beforeEach(async () => {
    previousCwd = process.cwd();
    tempProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), "cydeck-terminal-ipc-test-"));
    process.chdir(tempProjectDir);
    ipcMainHandleMock.mockReset();
    ipcMainOnMock.mockReset();
    getAgentManagerMock.mockReset();

    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(previousCwd);
    fs.rmSync(tempProjectDir, { recursive: true, force: true });
  });

  it("handles action=complete by marking stopped task completed", async () => {
    const { registerTerminalIpcRuntimeDeps, setupTerminalIpc } = await import("./terminal-ipc.js");
    const task = createStoppedTask("task-1");
    const completeTask = vi.fn(() => ({ success: true, task }));
    getAgentManagerMock.mockReturnValue({
      completeTask,
      clearCompletedTasks: vi.fn(() => 0),
      clearAllTasks: vi.fn(() => ({ count: 0, worktreesCleaned: 0 })),
      listAgents: vi.fn(() => []),
    });
    registerTerminalIpcRuntimeDeps({ getAgentManager: getAgentManagerMock });

    setupTerminalIpc({
      getState: () => ({ port: 18789 }),
      getAuthToken: () => "token",
    } as never);

    const handler = getIpcHandler("terminal:orchestral-tasks");
    const result = await handler({}, { taskId: "task-1", success: "true" }, "complete");

    expect(result.success).toBe(true);
    expect(result.message).toContain("marked as completed");
    expect(completeTask).toHaveBeenCalledWith("task-1", true, undefined);
  });

  it("returns validation error when complete action misses taskId", async () => {
    const { registerTerminalIpcRuntimeDeps, setupTerminalIpc } = await import("./terminal-ipc.js");
    getAgentManagerMock.mockReturnValue({
      completeTask: vi.fn(),
      clearCompletedTasks: vi.fn(() => 0),
      clearAllTasks: vi.fn(() => ({ count: 0, worktreesCleaned: 0 })),
      listAgents: vi.fn(() => []),
    });
    registerTerminalIpcRuntimeDeps({ getAgentManager: getAgentManagerMock });

    setupTerminalIpc({
      getState: () => ({ port: 18789 }),
      getAuthToken: () => "token",
    } as never);

    const handler = getIpcHandler("terminal:orchestral-tasks");
    const result = await handler({}, { success: "true" }, "complete");

    expect(result).toEqual({ success: false, error: "taskId is required" });
  });

  it("rejects complete action when task is still running", async () => {
    const { registerTerminalIpcRuntimeDeps, setupTerminalIpc } = await import("./terminal-ipc.js");
    const completeTask = vi.fn(() => ({
      success: false,
      error: "Task is still running. Stop it first with /agents kill <task-id>.",
    }));
    getAgentManagerMock.mockReturnValue({
      completeTask,
      clearCompletedTasks: vi.fn(() => 0),
      clearAllTasks: vi.fn(() => ({ count: 0, worktreesCleaned: 0 })),
      listAgents: vi.fn(() => []),
    });
    registerTerminalIpcRuntimeDeps({ getAgentManager: getAgentManagerMock });

    setupTerminalIpc({
      getState: () => ({ port: 18789 }),
      getAuthToken: () => "token",
    } as never);

    const handler = getIpcHandler("terminal:orchestral-tasks");
    const result = await handler({}, { taskId: "task-running", success: "true" }, "complete");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Task is still running");
  });
});
