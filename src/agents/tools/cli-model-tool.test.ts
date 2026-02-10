import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { peekSystemEvents, resetSystemEventsForTest } from "../../infra/system-events.js";

const execFileMock = vi.hoisted(() => vi.fn());
const callGatewayToolMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

vi.mock("./gateway.js", () => ({
  callGatewayTool: callGatewayToolMock,
}));

import { createCliModelTool } from "./cli-model-tool.js";

describe("cli_model tool", () => {
  const tempDirs: string[] = [];
  let homedirSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    execFileMock.mockReset();
    callGatewayToolMock.mockReset();
    resetSystemEventsForTest();

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-cli-model-tool-"));
    tempDirs.push(dir);
    homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(dir);
  });

  afterEach(() => {
    homedirSpy?.mockRestore();
    homedirSpy = null;
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("executes the action binary with argv args (no shell string interpolation)", async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, "ok\n", "");
    });

    const tool = createCliModelTool({
      config: {
        tools: {
          exec: {
            security: "full",
            ask: "off",
          },
        },
      },
    });
    const prompt = 'hello "world" & whoami';
    const result = await tool.execute("call1", { action: "claude", prompt });

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = execFileMock.mock.calls[0] ?? [];
    expect(cmd).toBe("claude");
    expect(args).toEqual([prompt]);
    expect(opts).toMatchObject({
      timeout: 120_000,
      maxBuffer: expect.any(Number),
      windowsHide: true,
      encoding: "utf8",
    });

    expect(result.content).toEqual([{ type: "text", text: "ok" }]);
  });

  it("falls back to .cmd on Windows when the base command is missing", async () => {
    if (process.platform !== "win32") {
      return;
    }

    execFileMock
      .mockImplementationOnce((_cmd, _args, _opts, cb) => {
        const err = Object.assign(new Error("not found"), { code: "ENOENT" });
        cb(err, "", "");
      })
      .mockImplementationOnce((_cmd, _args, _opts, cb) => {
        cb(null, "ok\n", "");
      });

    const tool = createCliModelTool({
      config: {
        tools: {
          exec: {
            security: "full",
            ask: "off",
          },
        },
      },
    });
    const result = await tool.execute("call2", { action: "claude", prompt: "hi" });

    expect(execFileMock).toHaveBeenCalledTimes(2);
    expect(execFileMock.mock.calls.map((call) => call[0])).toEqual(["claude", "claude.cmd"]);
    expect(result.content).toEqual([{ type: "text", text: "ok" }]);
  });

  it("requests approval when allowlist is required and missing", async () => {
    callGatewayToolMock.mockResolvedValue({ decision: "allow-once" });
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, "ok\n", "");
    });

    const tool = createCliModelTool({
      agentSessionKey: "main",
      config: {
        tools: {
          exec: {
            security: "allowlist",
            ask: "on-miss",
          },
        },
      },
    });
    const result = await tool.execute("call3", { action: "claude", prompt: "hi" });
    expect(result.details).toMatchObject({ status: "approval-pending" });

    // Background task runs after approval; give it a tick.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(callGatewayToolMock).toHaveBeenCalledWith(
      "exec.approval.request",
      expect.any(Object),
      expect.objectContaining({
        command: "claude",
        host: "gateway",
      }),
    );
    expect(execFileMock).toHaveBeenCalled();

    const events = peekSystemEvents("main").join("\n");
    expect(events).toContain("cli_model result");
    expect(events).toContain("ok");
  });
});
