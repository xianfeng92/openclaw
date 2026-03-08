import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcMainHandleMock = vi.fn();
const spawnMock = vi.fn();
const getEffectiveConfigMock = vi.fn();

vi.mock("electron", () => ({
  ipcMain: {
    handle: ipcMainHandleMock,
  },
}));

vi.mock("child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("./cydeck-config.js", () => ({
  getEffectiveConfig: getEffectiveConfigMock,
}));

type IpcHandler<TArgs extends unknown[] = unknown[], TResult = unknown> = (
  event: unknown,
  ...args: TArgs
) => Promise<TResult>;

function getIpcHandler<TArgs extends unknown[] = unknown[], TResult = unknown>(
  channel: string,
): IpcHandler<TArgs, TResult> {
  for (let index = ipcMainHandleMock.mock.calls.length - 1; index >= 0; index -= 1) {
    const call = ipcMainHandleMock.mock.calls[index];
    if (call?.[0] === channel) {
      return call[1] as IpcHandler<TArgs, TResult>;
    }
  }
  throw new Error(`IPC handler not found for channel: ${channel}`);
}

describe("terminal-ipc shell handlers", () => {
  beforeEach(() => {
    ipcMainHandleMock.mockReset();
    spawnMock.mockReset();
    getEffectiveConfigMock.mockReset();
  });

  it("rejects shell execution when terminal.allowShell is false", async () => {
    getEffectiveConfigMock.mockReturnValue({
      config: {
        terminal: {
          allowShell: false,
        },
      },
    });

    const { registerTerminalShellIpcHandlers } = await import("./terminal-ipc.shell.js");
    registerTerminalShellIpcHandlers();

    const handler = getIpcHandler<[string], { runId: string }>("terminal:exec-shell");

    await expect(handler({ sender: { send: vi.fn() } }, "dir")).rejects.toThrow(
      'Shell execution is disabled. Enable it with "/config set terminal.allowShell true" if you accept the risk.',
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("opens a worktree in VS Code through the dedicated IPC", async () => {
    const unrefMock = vi.fn();
    spawnMock.mockReturnValue({ unref: unrefMock });

    const { registerTerminalShellIpcHandlers } = await import("./terminal-ipc.shell.js");
    registerTerminalShellIpcHandlers();

    const handler = getIpcHandler<[string], { success: boolean }>("terminal:open-in-editor");
    const targetPath = "C:/workspace/.openclaw/worktrees/task-1";
    const result = await handler({}, targetPath);

    expect(result).toEqual({ success: true });
    expect(spawnMock).toHaveBeenCalledWith(
      process.platform === "win32" ? "code.cmd" : "code",
      ["--add", targetPath],
      expect.objectContaining({
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      }),
    );
    expect(unrefMock).toHaveBeenCalledTimes(1);
  });
});
