import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

import { createCliModelTool } from "./cli-model-tool.js";

describe("cli_model tool", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("executes the action binary with argv args (no shell string interpolation)", async () => {
    execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, "ok\n", "");
    });

    const tool = createCliModelTool();
    const prompt = 'hello "world" & whoami';
    const result = await tool.execute("call1", { action: "claude", prompt });

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = execFileMock.mock.calls[0] ?? [];
    expect(cmd).toBe("claude");
    expect(args).toEqual([prompt]);
    expect(opts).toMatchObject({
      timeout: 120_000,
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

    const tool = createCliModelTool();
    const result = await tool.execute("call2", { action: "claude", prompt: "hi" });

    expect(execFileMock).toHaveBeenCalledTimes(2);
    expect(execFileMock.mock.calls.map((call) => call[0])).toEqual(["claude", "claude.cmd"]);
    expect(result.content).toEqual([{ type: "text", text: "ok" }]);
  });
});

