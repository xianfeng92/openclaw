import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcMainHandleMock = vi.fn();
const appendTerminalAuditRecordMock = vi.fn();

vi.mock("electron", () => ({
  ipcMain: {
    handle: ipcMainHandleMock,
  },
}));

vi.mock("./terminal-audit-log.js", () => ({
  appendTerminalAuditRecord: appendTerminalAuditRecordMock,
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

describe("terminal-ipc.audit", () => {
  beforeEach(() => {
    ipcMainHandleMock.mockReset();
    appendTerminalAuditRecordMock.mockReset();
  });

  it("registers a handler that persists high-risk audit records", async () => {
    appendTerminalAuditRecordMock.mockReturnValue({
      success: true,
      auditPath: "C:/mock/state/audit/high-risk-actions.jsonl",
    });

    const { registerTerminalAuditIpcHandlers } = await import("./terminal-ipc.audit.js");
    registerTerminalAuditIpcHandlers();

    const handler = getIpcHandler<[Record<string, unknown>], { success: boolean }>(
      "terminal:audit-high-risk",
    );
    const entry = {
      actionType: "tasks.clear-all",
      commandPreview: "/tasks clear-all",
      riskSummary: "This permanently removes all tracked tasks from local storage.",
      secondSummary: "This is destructive and not reversible from the terminal UI.",
      phase: "queued",
    };
    const result = await handler({}, entry);

    expect(appendTerminalAuditRecordMock).toHaveBeenCalledWith(entry);
    expect(result).toEqual({
      success: true,
      auditPath: "C:/mock/state/audit/high-risk-actions.jsonl",
    });
  });
});
