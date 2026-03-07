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

type OrchestralAgentsHandler = (
  event: unknown,
  action: string,
  args: string[],
) => Promise<Record<string, unknown>>;

type WorkflowCreateHandler = (
  event: unknown,
  workflow: {
    name: string;
    description?: string;
    steps: Array<{ id: string; type: string; command: string; description?: string }>;
    tags?: string[];
  },
) => Promise<{ success: boolean; id?: string; error?: string }>;

type WorkflowRunHandler = (
  event: { sender?: unknown },
  name: string,
) => Promise<Record<string, unknown>>;

function getIpcHandler<T>(channel: string): T {
  for (let i = ipcMainHandleMock.mock.calls.length - 1; i >= 0; i--) {
    const call = ipcMainHandleMock.mock.calls[i];
    if (call && call[0] === channel) {
      return call[1] as T;
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
  let previousStateDir: string | undefined;
  let previousConfigPath: string | undefined;

  beforeEach(async () => {
    previousCwd = process.cwd();
    tempProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), "cydeck-terminal-ipc-test-"));
    process.chdir(tempProjectDir);
    previousStateDir = process.env.CYDECK_STATE_DIR;
    previousConfigPath = process.env.CYDECK_CONFIG_PATH;
    process.env.CYDECK_STATE_DIR = path.join(tempProjectDir, ".state");
    process.env.CYDECK_CONFIG_PATH = path.join(tempProjectDir, ".state", "cydeck.json");
    ipcMainHandleMock.mockReset();
    ipcMainOnMock.mockReset();
    getAgentManagerMock.mockReset();

    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(previousCwd);
    if (previousStateDir === undefined) {
      delete process.env.CYDECK_STATE_DIR;
    } else {
      process.env.CYDECK_STATE_DIR = previousStateDir;
    }
    if (previousConfigPath === undefined) {
      delete process.env.CYDECK_CONFIG_PATH;
    } else {
      process.env.CYDECK_CONFIG_PATH = previousConfigPath;
    }
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

    const handler = getIpcHandler<OrchestralTasksHandler>("terminal:orchestral-tasks");
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

    const handler = getIpcHandler<OrchestralTasksHandler>("terminal:orchestral-tasks");
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

    const handler = getIpcHandler<OrchestralTasksHandler>("terminal:orchestral-tasks");
    const result = await handler({}, { taskId: "task-running", success: "true" }, "complete");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Task is still running");
  });

  it("persists and clears landing wizard progress via IPC", async () => {
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

    const saveHandler = getIpcHandler<
      (event: unknown, stepIndex: number) => Promise<Record<string, unknown>>
    >("terminal:landing-wizard-save");
    const statusHandler = getIpcHandler<
      (event: unknown) => Promise<Record<string, unknown>>
    >("terminal:landing-status");
    const clearHandler = getIpcHandler<
      (event: unknown) => Promise<Record<string, unknown>>
    >("terminal:landing-wizard-clear");

    const save = await saveHandler({}, 2);
    expect(save.success).toBe(true);
    expect(save.wizardStepIndex).toBe(2);

    const status = await statusHandler({});
    expect(status.success).toBe(true);
    expect(status.wizardStepIndex).toBe(2);

    const clear = await clearHandler({});
    expect(clear.success).toBe(true);
    expect(clear.wizardStepIndex).toBeUndefined();

    const statusAfterClear = await statusHandler({});
    expect(statusAfterClear.success).toBe(true);
    expect(statusAfterClear.wizardStepIndex).toBeUndefined();
  });

  it("returns attachCommand for /agents attach responses", async () => {
    const { registerTerminalIpcRuntimeDeps, setupTerminalIpc } = await import("./terminal-ipc.js");
    getAgentManagerMock.mockReturnValue({
      getAgent: vi.fn((taskId: string) => ({
        id: taskId,
        description: "demo task",
        worktree: "C:/workspace/.openclaw/worktrees/task-1",
      })),
      listAgents: vi.fn(() => []),
      killAgent: vi.fn(async () => ({ success: true })),
      sendMessage: vi.fn(() => true),
      getOutput: vi.fn(() => ""),
      completeTask: vi.fn(),
      clearCompletedTasks: vi.fn(() => 0),
      clearAllTasks: vi.fn(() => ({ count: 0, worktreesCleaned: 0 })),
    });
    registerTerminalIpcRuntimeDeps({ getAgentManager: getAgentManagerMock });

    setupTerminalIpc({
      getState: () => ({ port: 18789 }),
      getAuthToken: () => "token",
    } as never);

    const handler = getIpcHandler<OrchestralAgentsHandler>("terminal:orchestral-agents");
    const result = await handler({}, "attach", ["task-1"]);

    expect(result.success).toBe(true);
    expect(result.command).toBe('cd "C:/workspace/.openclaw/worktrees/task-1"');
    expect(result.attachCommand).toBe('cd "C:/workspace/.openclaw/worktrees/task-1"');
  });

  it("executes workflow steps for terminal:workflow-run instead of dry-run", async () => {
    const { registerTerminalIpcRuntimeDeps, setupTerminalIpc } = await import("./terminal-ipc.js");
    const workflows = new Map<string, Record<string, unknown>>();
    const startAgent = vi.fn(async () => ({ success: true, pid: 1234 }));
    getAgentManagerMock.mockReturnValue({
      startAgent,
      completeTask: vi.fn(),
      clearCompletedTasks: vi.fn(() => 0),
      clearAllTasks: vi.fn(() => ({ count: 0, worktreesCleaned: 0 })),
      listAgents: vi.fn(() => []),
      killAgent: vi.fn(async () => ({ success: true })),
      sendMessage: vi.fn(() => true),
      getOutput: vi.fn(() => ""),
      getAgent: vi.fn(),
    });
    registerTerminalIpcRuntimeDeps({
      getAgentManager: getAgentManagerMock,
      importOrchestrationModule: async () => ({
        createWorkflow: async (workflow: {
          name: string;
          description?: string;
          steps: Array<{ id: string; type: string; command: string; description?: string }>;
          tags?: string[];
        }) => {
          const record = {
            id: "wf-1",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            runCount: 0,
            ...workflow,
          };
          workflows.set(workflow.name.toLowerCase(), record);
          return record;
        },
        getWorkflowByName: async (name: string) =>
          workflows.get(name.toLowerCase()) || null,
        incrementWorkflowRunCount: async (_id: string) => {},
      }),
    });

    setupTerminalIpc({
      getState: () => ({ port: 18789 }),
      getAuthToken: () => "token",
    } as never);

    const createHandler = getIpcHandler<WorkflowCreateHandler>("terminal:workflow-create");
    const runHandler = getIpcHandler<WorkflowRunHandler>("terminal:workflow-run");

    const createResult = await createHandler({}, {
      name: "phase-a-runner",
      steps: [
        { id: "step-1", type: "spawn", command: "Implement workflow smoke test" },
        { id: "step-2", type: "delay", command: "1" },
      ],
    });
    expect(createResult.success).toBe(true);

    const runResult = await runHandler({ sender: {} }, "phase-a-runner");
    const steps = (runResult.result as Array<Record<string, unknown>> | undefined) ?? [];
    expect(runResult.success).toBe(true);
    expect(steps.length).toBe(2);
    expect(steps[0]?.status).toBe("success");
    expect(steps[1]?.status).toBe("success");
    expect(startAgent).toHaveBeenCalledTimes(1);
    expect(runResult.completedSteps).toBe(2);
    expect(runResult.totalSteps).toBe(2);
  });
});
