import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendTerminalAuditRecord,
  resolveTerminalAuditLogPath,
} from "./terminal-audit-log.js";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cydeck-audit-log-"));
}

describe("terminal-audit-log", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes high-risk records into the CyDeck state dir audit log", () => {
    const stateDir = createTempDir();
    tempDirs.push(stateDir);
    const env = {
      ...process.env,
      CYDECK_STATE_DIR: stateDir,
    };

    const result = appendTerminalAuditRecord(
      {
        actionType: "agents.kill",
        commandPreview: "/agents kill task-1",
        riskSummary: "This terminates one or more running agent processes.",
        secondSummary: "Check the task id or --all target carefully; in-flight work may be lost.",
        phase: "confirmed",
        sessionKey: "session-1",
        agent: "codex",
      },
      env,
    );

    expect(result.success).toBe(true);
    const auditPath = resolveTerminalAuditLogPath(env);
    const raw = fs.readFileSync(auditPath, "utf-8").trim();
    const lines = raw.split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(parsed.actionType).toBe("agents.kill");
    expect(parsed.commandPreview).toBe("/agents kill task-1");
    expect(parsed.phase).toBe("confirmed");
    expect(typeof parsed.ts).toBe("string");
    expect(typeof parsed.tsMs).toBe("number");
  });
});
