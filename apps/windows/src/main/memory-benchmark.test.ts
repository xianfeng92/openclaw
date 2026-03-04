import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildMemoryBenchmarkMarkdown,
  compareMemoryBenchmarkReports,
  generateMemoryBenchmarkDataset,
  materializeMemoryBenchmarkDataset,
  resolveDefaultBenchmarkWorkspace,
  runMemoryBenchmarkReport,
  writeMemoryBenchmarkArtifacts,
} from "./memory-benchmark.js";

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

describe("memory-benchmark", () => {
  it("generates deterministic datasets for the same seed", () => {
    const first = generateMemoryBenchmarkDataset(12345);
    const second = generateMemoryBenchmarkDataset(12345);
    const third = generateMemoryBenchmarkDataset(54321);

    expect(first).toEqual(second);
    expect(third).not.toEqual(first);
    expect(first.memoryFiles.some((entry) => entry.path === "MEMORY.md")).toBe(true);
    expect(first.memoryFiles.some((entry) => entry.path.startsWith("memory/"))).toBe(true);
  });

  it("blocks dataset file paths that escape workspace", () => {
    const workspace = createTempDir("cydeck-memory-benchmark-escape-");
    const dataset = generateMemoryBenchmarkDataset(101);
    dataset.memoryFiles.push({
      path: "../outside.md",
      content: "escape attempt",
    });

    expect(() => materializeMemoryBenchmarkDataset(workspace, dataset)).toThrow(
      "Path escapes workspace",
    );
  });

  it("builds report, compares regressions, and writes JSON/Markdown artifacts", () => {
    const workspace = createTempDir("cydeck-memory-benchmark-workspace-");
    const outputDir = createTempDir("cydeck-memory-benchmark-output-");
    const dataset = generateMemoryBenchmarkDataset(20260304);

    const report = runMemoryBenchmarkReport({
      workspacePath: workspace,
      dataset,
      now: new Date("2026-03-04T12:00:00.000Z"),
    });

    expect(report.schemaVersion).toBe(1);
    expect(report.datasetSeed).toBe(20260304);
    expect(report.generatedAt).toBe("2026-03-04T12:00:00.000Z");
    expect(report.summary.overallScore).toBeGreaterThanOrEqual(0);
    expect(report.summary.overallScore).toBeLessThanOrEqual(1);
    expect(report.summary.efficiencyHitRate).toBeGreaterThanOrEqual(0);
    expect(report.summary.efficiencyHitRate).toBeLessThanOrEqual(1);

    const degraded = {
      ...report,
      generatedAt: "2026-03-05T00:00:00.000Z",
      summary: {
        ...report.summary,
        efficiencyHitRate: Math.max(0, report.summary.efficiencyHitRate - 0.5),
        lossRate: report.summary.lossRate + 0.5,
        compressionPassRate: Math.max(0, report.summary.compressionPassRate - 0.5),
        efficiencyP95LatencyMs: report.summary.efficiencyP95LatencyMs + 100,
        averageCompressionRatio: report.summary.averageCompressionRatio + 0.4,
      },
    };

    const comparison = compareMemoryBenchmarkReports({
      baseline: report,
      current: degraded,
    });
    expect(comparison.degraded).toBe(true);
    expect(comparison.issues.length).toBeGreaterThan(0);

    const markdown = buildMemoryBenchmarkMarkdown({
      report: degraded,
      comparison,
    });
    expect(markdown).toContain("# Memory Benchmark Report");
    expect(markdown).toContain("## Regression Comparison");
    expect(markdown).toContain("efficiency.hitRate");

    const artifacts = writeMemoryBenchmarkArtifacts({
      outputDir,
      report: degraded,
      comparison,
    });

    expect(fs.existsSync(artifacts.reportPath)).toBe(true);
    expect(fs.existsSync(artifacts.markdownPath)).toBe(true);
    expect(fs.existsSync(artifacts.comparisonPath ?? "")).toBe(true);
    expect(fs.existsSync(artifacts.comparisonMarkdownPath ?? "")).toBe(true);

    const savedReport = JSON.parse(fs.readFileSync(artifacts.reportPath, "utf-8")) as {
      schemaVersion: number;
    };
    expect(savedReport.schemaVersion).toBe(1);

    const savedMarkdown = fs.readFileSync(artifacts.markdownPath, "utf-8");
    expect(savedMarkdown).toContain("Memory Benchmark Report");
  });

  it("resolves default benchmark workspace with the seed", () => {
    const resolved = resolveDefaultBenchmarkWorkspace(77);
    expect(resolved).toContain("cydeck-memory-benchmark-77");
  });
});
