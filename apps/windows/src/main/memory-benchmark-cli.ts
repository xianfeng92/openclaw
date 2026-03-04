import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compareMemoryBenchmarkReports,
  generateMemoryBenchmarkDataset,
  resolveDefaultBenchmarkWorkspace,
  runMemoryBenchmarkReport,
  writeMemoryBenchmarkArtifacts,
  type MemoryBenchmarkReport,
} from "./memory-benchmark.js";

type CliOptions = {
  seed: number;
  workspacePath: string;
  outputDir: string;
  baselinePath?: string;
  writeBaselinePath?: string;
  failOnRegression: boolean;
  cleanWorkspace: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  let seed = 20260304;
  let workspacePath = "";
  let outputDir = "";
  let baselinePath = "";
  let writeBaselinePath = "";
  let failOnRegression = false;
  let cleanWorkspace = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }
    if (token === "--fail-on-regression") {
      failOnRegression = true;
      continue;
    }
    if (token === "--clean-workspace") {
      cleanWorkspace = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next) {
      continue;
    }
    if (token === "--seed") {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed)) {
        seed = parsed;
      }
      index += 1;
      continue;
    }
    if (token === "--workspace") {
      workspacePath = next.trim();
      index += 1;
      continue;
    }
    if (token === "--output-dir") {
      outputDir = next.trim();
      index += 1;
      continue;
    }
    if (token === "--baseline") {
      baselinePath = next.trim();
      index += 1;
      continue;
    }
    if (token === "--write-baseline") {
      writeBaselinePath = next.trim();
      index += 1;
      continue;
    }
  }

  const resolvedWorkspace = workspacePath
    ? path.resolve(workspacePath)
    : resolveDefaultBenchmarkWorkspace(seed);
  const resolvedOutputDir = outputDir
    ? path.resolve(outputDir)
    : path.join(resolvedWorkspace, ".openclaw", "memory-benchmark");

  return {
    seed,
    workspacePath: resolvedWorkspace,
    outputDir: resolvedOutputDir,
    baselinePath: baselinePath ? path.resolve(baselinePath) : undefined,
    writeBaselinePath: writeBaselinePath ? path.resolve(writeBaselinePath) : undefined,
    failOnRegression,
    cleanWorkspace,
  };
}

function readBaselineReport(baselinePath: string): MemoryBenchmarkReport | null {
  if (!fs.existsSync(baselinePath)) {
    return null;
  }
  const raw = fs.readFileSync(baselinePath, "utf-8");
  const parsed = JSON.parse(raw) as MemoryBenchmarkReport;
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  return parsed;
}

function ensureWorkspace(workspacePath: string, cleanWorkspace: boolean): void {
  if (cleanWorkspace && fs.existsSync(workspacePath)) {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }
  fs.mkdirSync(workspacePath, { recursive: true });
}

export async function runMemoryBenchmarkCli(argv = process.argv.slice(2)): Promise<number> {
  const options = parseArgs(argv);
  ensureWorkspace(options.workspacePath, options.cleanWorkspace);

  const dataset = generateMemoryBenchmarkDataset(options.seed);
  const report = runMemoryBenchmarkReport({
    workspacePath: options.workspacePath,
    dataset,
  });

  const baseline =
    options.baselinePath && fs.existsSync(options.baselinePath)
      ? readBaselineReport(options.baselinePath)
      : null;
  const comparison = baseline
    ? compareMemoryBenchmarkReports({
        baseline,
        current: report,
      })
    : undefined;

  const artifacts = writeMemoryBenchmarkArtifacts({
    outputDir: options.outputDir,
    report,
    comparison,
  });

  if (options.writeBaselinePath) {
    fs.mkdirSync(path.dirname(options.writeBaselinePath), { recursive: true });
    fs.writeFileSync(options.writeBaselinePath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  }

  console.log("[memory-benchmark] done");
  console.log(`  workspace: ${options.workspacePath}`);
  console.log(`  report: ${artifacts.reportPath}`);
  console.log(`  markdown: ${artifacts.markdownPath}`);
  if (comparison) {
    console.log(`  degraded: ${comparison.degraded ? "yes" : "no"}`);
    if (artifacts.comparisonPath) {
      console.log(`  comparison: ${artifacts.comparisonPath}`);
    }
  } else {
    console.log("  degraded: n/a (no baseline)");
  }
  if (options.writeBaselinePath) {
    console.log(`  baseline written: ${options.writeBaselinePath}`);
  }

  if (options.failOnRegression && comparison?.degraded) {
    return 2;
  }
  return 0;
}

const isEntrypoint =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  runMemoryBenchmarkCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error("[memory-benchmark] failed");
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exitCode = 1;
    });
}
