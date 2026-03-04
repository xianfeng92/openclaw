import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runMemoryBenchmarkCli } from "./memory-benchmark-cli.js";
import type { MemoryBenchmarkReport } from "./memory-benchmark.js";

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
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

describe("memory-benchmark-cli", () => {
  it("writes benchmark artifacts and baseline report", async () => {
    const workspace = createTempDir("cydeck-memory-benchmark-cli-workspace-");
    const outputDir = createTempDir("cydeck-memory-benchmark-cli-output-");
    const baselinePath = path.join(outputDir, "baseline.json");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      const exitCode = await runMemoryBenchmarkCli([
        "--seed",
        "20260304",
        "--workspace",
        workspace,
        "--output-dir",
        outputDir,
        "--write-baseline",
        baselinePath,
        "--clean-workspace",
      ]);

      expect(exitCode).toBe(0);
      expect(fs.existsSync(path.join(outputDir, "memory-benchmark.report.json"))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, "memory-benchmark.report.md"))).toBe(true);
      expect(fs.existsSync(baselinePath)).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("returns exit code 2 when regression is detected and fail-on-regression is enabled", async () => {
    const workspace = createTempDir("cydeck-memory-benchmark-cli-regress-workspace-");
    const outputDir = createTempDir("cydeck-memory-benchmark-cli-regress-output-");
    const baselinePath = path.join(outputDir, "baseline.json");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    try {
      const firstExitCode = await runMemoryBenchmarkCli([
        "--seed",
        "20260304",
        "--workspace",
        workspace,
        "--output-dir",
        outputDir,
        "--write-baseline",
        baselinePath,
        "--clean-workspace",
      ]);
      expect(firstExitCode).toBe(0);

      const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf-8")) as MemoryBenchmarkReport;
      const exaggeratedBaseline: MemoryBenchmarkReport = {
        ...baseline,
        summary: {
          ...baseline.summary,
          efficiencyHitRate: 2,
          lossRate: -1,
          compressionPassRate: 2,
          efficiencyP95LatencyMs: 1,
          averageCompressionRatio: -1,
        },
      };
      fs.writeFileSync(baselinePath, `${JSON.stringify(exaggeratedBaseline, null, 2)}\n`, "utf-8");

      const secondExitCode = await runMemoryBenchmarkCli([
        "--seed",
        "20260304",
        "--workspace",
        workspace,
        "--output-dir",
        outputDir,
        "--baseline",
        baselinePath,
        "--clean-workspace",
        "--fail-on-regression",
      ]);

      expect(secondExitCode).toBe(2);
      expect(fs.existsSync(path.join(outputDir, "memory-benchmark.comparison.json"))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, "memory-benchmark.comparison.md"))).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });
});
