#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const env = { ...process.env };
const cwd = process.cwd();
const compiler = "tsdown";
const compilerArgs = ["exec", compiler, "--no-clean"];

const distRoot = path.join(cwd, "dist");
const distEntry = path.join(distRoot, "/entry.js");
const buildStampPath = path.join(distRoot, ".buildstamp");
const srcRoot = path.join(cwd, "src");
const configFiles = [path.join(cwd, "tsconfig.json"), path.join(cwd, "package.json")];

const statMtime = (filePath) => {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
};

const isExcludedSource = (filePath) => {
  const relativePath = path.relative(srcRoot, filePath);
  if (relativePath.startsWith("..")) {
    return false;
  }
  return (
    relativePath.endsWith(".test.ts") ||
    relativePath.endsWith(".test.tsx") ||
    relativePath.endsWith(`test-helpers.ts`)
  );
};

const findLatestMtime = (dirPath, shouldSkip) => {
  let latest = null;
  const queue = [dirPath];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (shouldSkip?.(fullPath)) {
        continue;
      }
      const mtime = statMtime(fullPath);
      if (mtime == null) {
        continue;
      }
      if (latest == null || mtime > latest) {
        latest = mtime;
      }
    }
  }
  return latest;
};

const shouldBuild = () => {
  if (env.OPENCLAW_FORCE_BUILD === "1") {
    return true;
  }
  const stampMtime = statMtime(buildStampPath);
  if (stampMtime == null) {
    return true;
  }
  if (statMtime(distEntry) == null) {
    return true;
  }

  for (const filePath of configFiles) {
    const mtime = statMtime(filePath);
    if (mtime != null && mtime > stampMtime) {
      return true;
    }
  }

  const srcMtime = findLatestMtime(srcRoot, isExcludedSource);
  if (srcMtime != null && srcMtime > stampMtime) {
    return true;
  }
  return false;
};

const logRunner = (message) => {
  if (env.OPENCLAW_RUNNER_LOG === "0") {
    return;
  }
  process.stderr.write(`[openclaw] ${message}\n`);
};

const canRun = (command, commandArgs) => {
  const result = spawnSync(command, commandArgs, {
    cwd,
    env,
    stdio: "ignore",
    windowsHide: true,
  });
  if (result.error) {
    return false;
  }
  return (result.status ?? 1) === 0;
};

const resolvePackageRunner = () => {
  if (canRun("pnpm", ["--version"])) {
    return { cmd: "pnpm", args: [] };
  }
  if (canRun("corepack", ["pnpm", "--version"])) {
    logRunner("pnpm command not found, falling back to corepack pnpm.");
    return { cmd: "corepack", args: ["pnpm"] };
  }
  return null;
};

const runNode = () => {
  const nodeProcess = spawn(process.execPath, ["openclaw.mjs", ...args], {
    cwd,
    env,
    stdio: "inherit",
  });

  nodeProcess.on("exit", (exitCode, exitSignal) => {
    if (exitSignal) {
      process.exit(1);
    }
    process.exit(exitCode ?? 1);
  });
};

const writeBuildStamp = () => {
  try {
    fs.mkdirSync(distRoot, { recursive: true });
    fs.writeFileSync(buildStampPath, `${Date.now()}\n`);
  } catch (error) {
    // Best-effort stamp; still allow the runner to start.
    logRunner(`Failed to write build stamp: ${error?.message ?? "unknown error"}`);
  }
};

if (!shouldBuild()) {
  runNode();
} else {
  logRunner("Building TypeScript (dist is stale).");
  const runner = resolvePackageRunner();
  if (!runner) {
    process.stderr.write("Missing package runner: install pnpm or corepack.\n");
    process.exit(1);
  }
  const buildCmd = runner.cmd;
  const buildArgs = [...runner.args, ...compilerArgs];
  const build = spawn(buildCmd, buildArgs, {
    cwd,
    env,
    stdio: "inherit",
  });

  build.on("exit", (code, signal) => {
    if (signal) {
      process.exit(1);
    }
    if (code !== 0 && code !== null) {
      process.exit(code);
    }
    writeBuildStamp();
    runNode();
  });
}
