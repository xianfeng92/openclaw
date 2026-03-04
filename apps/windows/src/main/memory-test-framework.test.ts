import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryTestHarness } from "./memory-test-framework.js";

const tempDirs: string[] = [];

function createWorkspace(): string {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "cydeck-memory-framework-"));
  tempDirs.push(workspace);
  fs.mkdirSync(path.join(workspace, "memory"), { recursive: true });
  return workspace;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("memory-test-framework", () => {
  it("measures memory efficiency hit-rate and latency", () => {
    const workspace = createWorkspace();
    fs.writeFileSync(
      path.join(workspace, "MEMORY.md"),
      [
        "# MEMORY",
        "- Product codename is Atlas.",
        "- Preferred language is Chinese.",
      ].join("\n"),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(workspace, "memory", "2026-03-04-release.md"),
      ["Atlas rollout checklist includes stage-1 verification."].join("\n"),
      "utf-8",
    );

    const harness = new MemoryTestHarness(workspace);
    const report = harness.runEfficiencySuite([
      {
        name: "atlas-codename",
        query: "what is codename atlas",
        expectedPhrases: ["atlas"],
      },
      {
        name: "language-preference",
        query: "which language preference",
        expectedPhrases: ["chinese"],
      },
    ]);

    expect(report.totalCases).toBe(2);
    expect(report.hitRate).toBe(1);
    expect(report.averageLatencyMs).toBeGreaterThanOrEqual(0);
    expect(report.p95LatencyMs).toBeGreaterThanOrEqual(0);
    expect(report.cases.every((item) => item.hit)).toBe(true);
  });

  it("detects memory loss/missing phrases after snapshots", () => {
    const workspace = createWorkspace();
    const harness = new MemoryTestHarness(workspace);

    const okReport = harness.runLossSuite([
      {
        name: "no-loss",
        sessionKey: "default",
        writes: [
          {
            reason: "session-memory",
            messages: [{ role: "user", content: "Remember Atlas rollout checklist for stage-1." }],
          },
          {
            reason: "session-memory",
            messages: [{ role: "assistant", content: "Stored rollout checklist and owner list." }],
          },
        ],
        validationQuery: "atlas rollout checklist",
        expectedPhrases: ["atlas", "rollout checklist"],
      },
    ]);

    expect(okReport.totalCases).toBe(1);
    expect(okReport.lossRate).toBe(0);
    expect(okReport.cases[0]?.missingPhrases).toEqual([]);

    const missingReport = harness.runLossSuite([
      {
        name: "detect-missing",
        sessionKey: "default",
        writes: [
          {
            reason: "session-memory",
            messages: [{ role: "user", content: "Only one phrase is stored." }],
          },
        ],
        validationQuery: "only one phrase",
        expectedPhrases: ["one phrase", "never-written-token"],
      },
    ]);

    expect(missingReport.totalCases).toBe(1);
    expect(missingReport.missingCases).toBe(1);
    expect(missingReport.cases[0]?.missingPhrases).toContain("never-written-token");
  });

  it("validates pre-compaction compression behavior", () => {
    const workspace = createWorkspace();
    const harness = new MemoryTestHarness(workspace);

    const longMessages: Array<{ role: "user" | "assistant"; content: string }> = Array.from(
      { length: 30 },
      (_, index) => ({
        role: index % 2 === 0 ? "user" : "assistant",
        content: `message-${index}-${"x".repeat(400)}`,
      }),
    );

    const report = harness.runCompressionSuite([
      {
        name: "flush-and-compress",
        sessionKey: "default",
        messages: longMessages,
        triggerThreshold: 10,
        snapshotMaxMessages: 6,
        expectFlush: true,
        maxMessageCompressionRatio: 0.25,
      },
      {
        name: "below-threshold-skip",
        sessionKey: "default",
        messages: longMessages.slice(0, 3),
        triggerThreshold: 10,
        snapshotMaxMessages: 2,
        expectFlush: false,
      },
    ]);

    expect(report.totalCases).toBe(2);
    expect(report.passRate).toBe(1);
    const flushCase = report.cases.find((entry) => entry.name === "flush-and-compress");
    expect(flushCase?.flushed).toBe(true);
    expect(flushCase?.selectedMessages).toBe(6);
    expect((flushCase?.messageCompressionRatio ?? 1) <= 0.25).toBe(true);

    const skipCase = report.cases.find((entry) => entry.name === "below-threshold-skip");
    expect(skipCase?.flushed).toBe(false);
    expect(skipCase?.passed).toBe(true);
  });
});
