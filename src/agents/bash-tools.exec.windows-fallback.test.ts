import { describe, expect, it } from "vitest";
import { normalizeWindowsExecCommand } from "./bash-tools.exec.js";

function decodeEncodedPowerShellCommand(command: string): string {
  const parts = command.split(" ");
  const encoded = parts[parts.length - 1] || "";
  return Buffer.from(encoded, "base64").toString("utf16le");
}

describe("normalizeWindowsExecCommand", () => {
  it("wraps bare Get-ChildItem on win32", () => {
    const input = "Get-ChildItem -Path . -Recurse";
    const result = normalizeWindowsExecCommand({ command: input, platform: "win32" });

    expect(result.wrapped).toBe(true);
    expect(result.cmdlet).toBe("Get-ChildItem");
    expect(result.command.startsWith("powershell -NoProfile -EncodedCommand ")).toBe(true);
    expect(decodeEncodedPowerShellCommand(result.command)).toBe(input);
  });

  it("wraps bare Select-String on win32", () => {
    const input = "Select-String -Path README.md -Pattern todo";
    const result = normalizeWindowsExecCommand({ command: input, platform: "win32" });

    expect(result.wrapped).toBe(true);
    expect(result.cmdlet).toBe("Select-String");
    expect(decodeEncodedPowerShellCommand(result.command)).toBe(input);
  });

  it("does not wrap commands that already invoke powershell", () => {
    const input = "powershell -NoProfile -Command \"Get-ChildItem -Path .\"";
    const result = normalizeWindowsExecCommand({ command: input, platform: "win32" });

    expect(result.wrapped).toBe(false);
    expect(result.command).toBe(input);
  });

  it("does not wrap non-target commands or non-win platforms", () => {
    const cmdCommand = "dir /s /b";
    const nonWinCommand = "Get-ChildItem -Path .";

    const cmdResult = normalizeWindowsExecCommand({ command: cmdCommand, platform: "win32" });
    const nonWinResult = normalizeWindowsExecCommand({ command: nonWinCommand, platform: "linux" });

    expect(cmdResult.wrapped).toBe(false);
    expect(cmdResult.command).toBe(cmdCommand);
    expect(nonWinResult.wrapped).toBe(false);
    expect(nonWinResult.command).toBe(nonWinCommand);
  });
});
