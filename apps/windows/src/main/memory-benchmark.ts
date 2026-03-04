import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MemoryTestHarness,
  type MemoryCompressionCase,
  type MemoryCompressionSuiteResult,
  type MemoryEfficiencyCase,
  type MemoryEfficiencySuiteResult,
  type MemoryLossCase,
  type MemoryLossSuiteResult,
} from "./memory-test-framework.js";

export type MemoryBenchmarkDatasetFile = {
  path: string;
  content: string;
};

export type MemoryBenchmarkDataset = {
  version: 1;
  seed: number;
  memoryFiles: MemoryBenchmarkDatasetFile[];
  efficiencyCases: MemoryEfficiencyCase[];
  lossCases: MemoryLossCase[];
  compressionCases: MemoryCompressionCase[];
};

export type MemoryBenchmarkSummary = {
  overallScore: number;
  efficiencyHitRate: number;
  efficiencyP95LatencyMs: number;
  lossRate: number;
  compressionPassRate: number;
  averageCompressionRatio: number;
};

export type MemoryBenchmarkReport = {
  schemaVersion: 1;
  generatedAt: string;
  datasetSeed: number;
  workspacePath: string;
  summary: MemoryBenchmarkSummary;
  efficiency: MemoryEfficiencySuiteResult;
  loss: MemoryLossSuiteResult;
  compression: MemoryCompressionSuiteResult;
};

export type MemoryRegressionThresholds = {
  maxHitRateDrop: number;
  maxLossRateIncrease: number;
  maxCompressionPassDrop: number;
  maxLatencyIncreaseRatio: number;
  maxCompressionRatioIncrease: number;
};

export type MemoryRegressionIssue = {
  metric: string;
  baseline: number;
  current: number;
  delta: number;
  threshold: number;
  description: string;
};

export type MemoryRegressionComparison = {
  degraded: boolean;
  baselineGeneratedAt: string;
  currentGeneratedAt: string;
  thresholds: MemoryRegressionThresholds;
  issues: MemoryRegressionIssue[];
};

export type MemoryBenchmarkArtifacts = {
  reportPath: string;
  markdownPath: string;
  comparisonPath?: string;
  comparisonMarkdownPath?: string;
};

type BenchmarkRng = () => number;

const DEFAULT_REGRESSION_THRESHOLDS: MemoryRegressionThresholds = {
  maxHitRateDrop: 0.05,
  maxLossRateIncrease: 0.03,
  maxCompressionPassDrop: 0.05,
  maxLatencyIncreaseRatio: 0.4,
  maxCompressionRatioIncrease: 0.2,
};

const DEFAULT_DATASET_SEED = 20260304;

function mulberry32(seed: number): BenchmarkRng {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(rng: BenchmarkRng, min: number, max: number): number {
  const lower = Math.floor(min);
  const upper = Math.floor(max);
  if (upper <= lower) {
    return lower;
  }
  return lower + Math.floor(rng() * (upper - lower + 1));
}

function pickOne<T>(rng: BenchmarkRng, values: readonly [T, ...T[]]): T {
  const index = randomInt(rng, 0, values.length - 1);
  return values[index];
}

function normalizeRelPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function ensureInsideWorkspace(workspacePath: string, relPath: string): string {
  const resolved = path.resolve(workspacePath, relPath);
  const relative = path.relative(workspacePath, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace: ${relPath}`);
  }
  return resolved;
}

function weightedScore(parts: Array<{ value: number; weight: number }>): number {
  let numerator = 0;
  let denominator = 0;
  for (const part of parts) {
    numerator += part.value * part.weight;
    denominator += part.weight;
  }
  if (denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

export function generateMemoryBenchmarkDataset(
  seed = DEFAULT_DATASET_SEED,
): MemoryBenchmarkDataset {
  const rng = mulberry32(seed);
  const domains = [
    "release",
    "compliance",
    "billing",
    "security",
    "localization",
    "support",
    "analytics",
    "migration",
  ] as const;
  const verbs = [
    "stabilize",
    "optimize",
    "validate",
    "document",
    "prioritize",
    "verify",
    "audit",
    "synchronize",
  ] as const;
  const objects = [
    "atlas rollout",
    "tenant billing rules",
    "incident postmortem",
    "token rotation policy",
    "knowledge export plan",
    "session privacy boundary",
    "on-call handover",
    "model fallback matrix",
  ] as const;

  const memoryFacts: string[] = [];
  for (let index = 0; index < 14; index += 1) {
    const domain = pickOne(rng, domains);
    const verb = pickOne(rng, verbs);
    const object = pickOne(rng, objects);
    const owner = `owner-${randomInt(rng, 1, 9)}`;
    const milestone = `M${randomInt(rng, 1, 5)}-${randomInt(rng, 10, 99)}`;
    memoryFacts.push(
      `- Fact ${index + 1}: ${domain} must ${verb} ${object}; owner=${owner}; milestone=${milestone}.`,
    );
  }

  const memoryFiles: MemoryBenchmarkDatasetFile[] = [
    {
      path: "MEMORY.md",
      content: [
        "# MEMORY.md",
        "",
        "## Long-term Facts",
        ...memoryFacts,
        "",
        "## User Preferences",
        "- Preferred language: Chinese.",
        "- Response style: concise with numbered lists.",
      ].join("\n"),
    },
  ];

  for (let day = 1; day <= 6; day += 1) {
    const topic = pickOne(rng, objects);
    const action = pickOne(rng, verbs);
    memoryFiles.push({
      path: `memory/2026-03-0${day}-session-${day}.md`,
      content: [
        `# Session Snapshot 2026-03-0${day}`,
        "",
        `- Discussed ${topic}.`,
        `- Decision: ${action} checklist before rollout.`,
        `- Reminder token: TRACE-${seed}-${day}.`,
      ].join("\n"),
    });
  }

  const efficiencyCases: MemoryEfficiencyCase[] = [
    {
      name: "preferences-language",
      query: "what language preference should we answer in",
      expectedPhrases: ["preferred language: chinese"],
      maxResults: 4,
      minScore: 0.05,
    },
    {
      name: "preferences-style",
      query: "which response style is preferred",
      expectedPhrases: ["numbered lists"],
      maxResults: 4,
      minScore: 0.05,
    },
    ...memoryFacts.slice(0, 4).map((fact, index) => {
      const token = fact.split(":")[1]?.trim() ?? fact;
      return {
        name: `fact-recall-${index + 1}`,
        query: token.split(";")[0] ?? token,
        expectedPhrases: [token.slice(0, 48).toLowerCase()],
        maxResults: 5,
        minScore: 0.05,
      };
    }),
  ];

  const lossCases: MemoryLossCase[] = [
    {
      name: "session-memory-no-loss",
      sessionKey: "default",
      writes: [
        {
          reason: "session-memory",
          messages: [
            { role: "user", content: "Remember TRACE-LOSS-A and Atlas freeze window." },
            { role: "assistant", content: "Stored TRACE-LOSS-A with freeze owner list." },
          ],
        },
        {
          reason: "session-memory",
          messages: [{ role: "user", content: "Also capture rollback token TRACE-LOSS-B." }],
        },
      ],
      validationQuery: "trace loss rollback token",
      expectedPhrases: ["trace-loss-a", "trace-loss-b"],
    },
    {
      name: "session-memory-summary",
      sessionKey: "default",
      writes: [
        {
          reason: "session-memory",
          messages: [
            { role: "user", content: "Escalation owner is owner-7 for billing lock." },
            { role: "assistant", content: "Acknowledged owner-7 billing lock escalation." },
          ],
        },
      ],
      validationQuery: "billing lock owner",
      expectedPhrases: ["owner-7", "billing lock"],
    },
  ];

  const buildLongMessages = (prefix: string, count: number): Array<{
    role: "user" | "assistant";
    content: string;
  }> =>
    Array.from({ length: count }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `${prefix}-msg-${index}-${"x".repeat(360)}`,
    }));

  const compressionCases: MemoryCompressionCase[] = [
    {
      name: "flush-on-threshold",
      sessionKey: "default",
      messages: buildLongMessages("flush", 28),
      triggerThreshold: 12,
      snapshotMaxMessages: 7,
      expectFlush: true,
      maxMessageCompressionRatio: 0.35,
    },
    {
      name: "skip-below-threshold",
      sessionKey: "default",
      messages: buildLongMessages("skip", 5),
      triggerThreshold: 12,
      snapshotMaxMessages: 4,
      expectFlush: false,
    },
  ];

  return {
    version: 1,
    seed,
    memoryFiles,
    efficiencyCases,
    lossCases,
    compressionCases,
  };
}

export function materializeMemoryBenchmarkDataset(
  workspacePath: string,
  dataset: MemoryBenchmarkDataset,
): void {
  fs.mkdirSync(workspacePath, { recursive: true });
  for (const file of dataset.memoryFiles) {
    const relPath = normalizeRelPath(file.path);
    const absPath = ensureInsideWorkspace(workspacePath, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, file.content, "utf-8");
  }
}

export function runMemoryBenchmarkReport(params: {
  workspacePath: string;
  dataset: MemoryBenchmarkDataset;
  now?: Date;
}): MemoryBenchmarkReport {
  materializeMemoryBenchmarkDataset(params.workspacePath, params.dataset);
  const harness = new MemoryTestHarness(params.workspacePath);
  const efficiency = harness.runEfficiencySuite(params.dataset.efficiencyCases);
  const loss = harness.runLossSuite(params.dataset.lossCases);
  const compression = harness.runCompressionSuite(params.dataset.compressionCases);

  const latencyScore =
    efficiency.p95LatencyMs <= 0 ? 1 : 1 / (1 + efficiency.p95LatencyMs / 50);
  const summary: MemoryBenchmarkSummary = {
    overallScore: weightedScore([
      { value: efficiency.hitRate, weight: 0.4 },
      { value: 1 - loss.lossRate, weight: 0.3 },
      { value: compression.passRate, weight: 0.2 },
      { value: latencyScore, weight: 0.1 },
    ]),
    efficiencyHitRate: efficiency.hitRate,
    efficiencyP95LatencyMs: efficiency.p95LatencyMs,
    lossRate: loss.lossRate,
    compressionPassRate: compression.passRate,
    averageCompressionRatio: compression.averageMessageCompressionRatio,
  };

  return {
    schemaVersion: 1,
    generatedAt: (params.now ?? new Date()).toISOString(),
    datasetSeed: params.dataset.seed,
    workspacePath: params.workspacePath,
    summary,
    efficiency,
    loss,
    compression,
  };
}

function compareMetric(params: {
  metric: string;
  baseline: number;
  current: number;
  threshold: number;
  direction: "drop" | "increase";
  description: string;
}): MemoryRegressionIssue | null {
  const delta = params.current - params.baseline;
  if (params.direction === "drop") {
    if (params.baseline - params.current > params.threshold) {
      return {
        metric: params.metric,
        baseline: params.baseline,
        current: params.current,
        delta,
        threshold: params.threshold,
        description: params.description,
      };
    }
    return null;
  }
  if (delta > params.threshold) {
    return {
      metric: params.metric,
      baseline: params.baseline,
      current: params.current,
      delta,
      threshold: params.threshold,
      description: params.description,
    };
  }
  return null;
}

export function compareMemoryBenchmarkReports(params: {
  baseline: MemoryBenchmarkReport;
  current: MemoryBenchmarkReport;
  thresholds?: Partial<MemoryRegressionThresholds>;
}): MemoryRegressionComparison {
  const thresholds: MemoryRegressionThresholds = {
    ...DEFAULT_REGRESSION_THRESHOLDS,
    ...params.thresholds,
  };

  const issues: MemoryRegressionIssue[] = [];

  const hitRateIssue = compareMetric({
    metric: "efficiency.hitRate",
    baseline: params.baseline.summary.efficiencyHitRate,
    current: params.current.summary.efficiencyHitRate,
    threshold: thresholds.maxHitRateDrop,
    direction: "drop",
    description: "Memory recall hit rate dropped beyond allowed threshold.",
  });
  if (hitRateIssue) {
    issues.push(hitRateIssue);
  }

  const lossRateIssue = compareMetric({
    metric: "loss.lossRate",
    baseline: params.baseline.summary.lossRate,
    current: params.current.summary.lossRate,
    threshold: thresholds.maxLossRateIncrease,
    direction: "increase",
    description: "Memory loss rate increased beyond allowed threshold.",
  });
  if (lossRateIssue) {
    issues.push(lossRateIssue);
  }

  const compressionPassIssue = compareMetric({
    metric: "compression.passRate",
    baseline: params.baseline.summary.compressionPassRate,
    current: params.current.summary.compressionPassRate,
    threshold: thresholds.maxCompressionPassDrop,
    direction: "drop",
    description: "Compression pass rate dropped beyond allowed threshold.",
  });
  if (compressionPassIssue) {
    issues.push(compressionPassIssue);
  }

  const baselineLatency = Math.max(1, params.baseline.summary.efficiencyP95LatencyMs);
  const currentLatency = params.current.summary.efficiencyP95LatencyMs;
  const latencyIncreaseRatio = (currentLatency - baselineLatency) / baselineLatency;
  if (latencyIncreaseRatio > thresholds.maxLatencyIncreaseRatio) {
    issues.push({
      metric: "efficiency.p95LatencyMs",
      baseline: baselineLatency,
      current: currentLatency,
      delta: currentLatency - baselineLatency,
      threshold: thresholds.maxLatencyIncreaseRatio,
      description: "P95 memory search latency increased too much.",
    });
  }

  const compressionRatioIssue = compareMetric({
    metric: "compression.averageMessageCompressionRatio",
    baseline: params.baseline.summary.averageCompressionRatio,
    current: params.current.summary.averageCompressionRatio,
    threshold: thresholds.maxCompressionRatioIncrease,
    direction: "increase",
    description: "Average compression ratio increased (less compression efficiency).",
  });
  if (compressionRatioIssue) {
    issues.push(compressionRatioIssue);
  }

  return {
    degraded: issues.length > 0,
    baselineGeneratedAt: params.baseline.generatedAt,
    currentGeneratedAt: params.current.generatedAt,
    thresholds,
    issues,
  };
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatNumber(value: number): string {
  if (Number.isFinite(value)) {
    return value.toFixed(4).replace(/\.?0+$/, "");
  }
  return String(value);
}

export function buildMemoryBenchmarkMarkdown(params: {
  report: MemoryBenchmarkReport;
  comparison?: MemoryRegressionComparison;
}): string {
  const { report, comparison } = params;
  const lines: string[] = [
    "# Memory Benchmark Report",
    "",
    `- Generated At: ${report.generatedAt}`,
    `- Dataset Seed: ${report.datasetSeed}`,
    `- Workspace: ${report.workspacePath}`,
    "",
    "## Summary",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Overall Score | ${formatNumber(report.summary.overallScore)} |`,
    `| Efficiency Hit Rate | ${formatPercent(report.summary.efficiencyHitRate)} |`,
    `| Efficiency P95 Latency (ms) | ${formatNumber(report.summary.efficiencyP95LatencyMs)} |`,
    `| Loss Rate | ${formatPercent(report.summary.lossRate)} |`,
    `| Compression Pass Rate | ${formatPercent(report.summary.compressionPassRate)} |`,
    `| Avg Compression Ratio | ${formatPercent(report.summary.averageCompressionRatio)} |`,
    "",
    "## Efficiency",
    "",
    `- Cases: ${report.efficiency.totalCases}`,
    `- Hit Cases: ${report.efficiency.hitCases}`,
    `- Hit Rate: ${formatPercent(report.efficiency.hitRate)}`,
    `- Avg Latency: ${formatNumber(report.efficiency.averageLatencyMs)} ms`,
    `- P95 Latency: ${formatNumber(report.efficiency.p95LatencyMs)} ms`,
    "",
    "## Loss",
    "",
    `- Cases: ${report.loss.totalCases}`,
    `- Missing Cases: ${report.loss.missingCases}`,
    `- Loss Rate: ${formatPercent(report.loss.lossRate)}`,
    "",
    "## Compression",
    "",
    `- Cases: ${report.compression.totalCases}`,
    `- Passed Cases: ${report.compression.passedCases}`,
    `- Pass Rate: ${formatPercent(report.compression.passRate)}`,
    `- Avg Message Compression Ratio: ${formatPercent(report.compression.averageMessageCompressionRatio)}`,
    "",
  ];

  if (comparison) {
    lines.push("## Regression Comparison", "");
    lines.push(`- Degraded: ${comparison.degraded ? "yes" : "no"}`);
    lines.push(`- Baseline Generated At: ${comparison.baselineGeneratedAt}`);
    lines.push(`- Current Generated At: ${comparison.currentGeneratedAt}`);
    lines.push("");
    if (comparison.issues.length === 0) {
      lines.push("No regression issues detected.", "");
    } else {
      lines.push("| Metric | Baseline | Current | Delta | Threshold |");
      lines.push("| --- | ---: | ---: | ---: | ---: |");
      for (const issue of comparison.issues) {
        lines.push(
          `| ${issue.metric} | ${formatNumber(issue.baseline)} | ${formatNumber(issue.current)} | ${formatNumber(issue.delta)} | ${formatNumber(issue.threshold)} |`,
        );
      }
      lines.push("");
      for (const issue of comparison.issues) {
        lines.push(`- ${issue.metric}: ${issue.description}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function writeMemoryBenchmarkArtifacts(params: {
  outputDir: string;
  report: MemoryBenchmarkReport;
  comparison?: MemoryRegressionComparison;
}): MemoryBenchmarkArtifacts {
  const outputDir = path.resolve(params.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const reportPath = path.join(outputDir, "memory-benchmark.report.json");
  const markdownPath = path.join(outputDir, "memory-benchmark.report.md");
  fs.writeFileSync(reportPath, `${JSON.stringify(params.report, null, 2)}\n`, "utf-8");
  fs.writeFileSync(
    markdownPath,
    `${buildMemoryBenchmarkMarkdown({ report: params.report, comparison: params.comparison })}\n`,
    "utf-8",
  );

  let comparisonPath: string | undefined;
  let comparisonMarkdownPath: string | undefined;
  if (params.comparison) {
    comparisonPath = path.join(outputDir, "memory-benchmark.comparison.json");
    comparisonMarkdownPath = path.join(outputDir, "memory-benchmark.comparison.md");
    fs.writeFileSync(comparisonPath, `${JSON.stringify(params.comparison, null, 2)}\n`, "utf-8");
    const markdown = buildMemoryBenchmarkMarkdown({
      report: params.report,
      comparison: params.comparison,
    });
    fs.writeFileSync(comparisonMarkdownPath, `${markdown}\n`, "utf-8");
  }

  return {
    reportPath,
    markdownPath,
    comparisonPath,
    comparisonMarkdownPath,
  };
}

export function resolveDefaultBenchmarkWorkspace(seed: number): string {
  return path.join(os.tmpdir(), `cydeck-memory-benchmark-${seed}`);
}
