import fs from "node:fs";
import path from "node:path";
import type { ExecAllowlistEntry } from "./exec-approvals.store.js";
import {
  analyzeShellCommand,
  isWindowsPlatform,
  splitCommandChain,
  matchAllowlist,
  resolveAllowlistCandidatePath,
  type CommandResolution,
  type ExecCommandAnalysis,
  type ExecCommandSegment,
} from "./exec-approvals.command-analysis.js";
export const DEFAULT_SAFE_BINS = ["jq", "grep", "cut", "sort", "uniq", "head", "tail", "tr", "wc"];
const DEFAULT_SAFE_BIN_TRUSTED_DIRS = [
  "/bin",
  "/usr/bin",
  "/usr/local/bin",
  "/opt/homebrew/bin",
  "/opt/local/bin",
  "/snap/bin",
  "/run/current-system/sw/bin",
];

function isPathLikeToken(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed === "-") {
    return false;
  }
  if (trimmed.startsWith("./") || trimmed.startsWith("../") || trimmed.startsWith("~")) {
    return true;
  }
  if (trimmed.startsWith("/")) {
    return true;
  }
  return /^[A-Za-z]:[\\/]/.test(trimmed);
}

function defaultFileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

type SafeBinPolicy = {
  knownLongFlags: readonly string[];
  deniedLongFlags: ReadonlySet<string>;
  allowedValueLongFlags: ReadonlySet<string>;
  deniedShortFlags: ReadonlySet<string>;
  allowedValueShortFlags: ReadonlySet<string>;
  maxPositional?: number;
  rejectUnknownLong?: boolean;
};

const EMPTY_FLAGS = new Set<string>();
const SAFE_BIN_POLICIES: Record<string, SafeBinPolicy> = {
  sort: {
    knownLongFlags: [
      "--key",
      "--field-separator",
      "--buffer-size",
      "--parallel",
      "--batch-size",
      "--compress-program",
      "--files0-from",
      "--output",
      "--random-source",
      "--temporary-directory",
    ],
    deniedLongFlags: new Set([
      "--compress-program",
      "--files0-from",
      "--output",
      "--random-source",
      "--temporary-directory",
    ]),
    allowedValueLongFlags: new Set([
      "--key",
      "--field-separator",
      "--buffer-size",
      "--parallel",
      "--batch-size",
    ]),
    deniedShortFlags: new Set(["-T", "-o"]),
    allowedValueShortFlags: new Set(["-k", "-t", "-S"]),
    maxPositional: 0,
    rejectUnknownLong: true,
  },
  wc: {
    knownLongFlags: ["--files0-from"],
    deniedLongFlags: new Set(["--files0-from"]),
    allowedValueLongFlags: EMPTY_FLAGS,
    deniedShortFlags: EMPTY_FLAGS,
    allowedValueShortFlags: EMPTY_FLAGS,
  },
};

function hasGlobToken(value: string): boolean {
  return /[*?[\]]/.test(value);
}

function normalizeSafeBinExecName(value: string): string {
  const lowered = value.trim().toLowerCase();
  return lowered.endsWith(".exe") ? lowered.slice(0, -4) : lowered;
}

function resolveSafeBinPolicy(value: string): SafeBinPolicy | null {
  const key = normalizeSafeBinExecName(value);
  return SAFE_BIN_POLICIES[key] ?? null;
}

function resolveCanonicalLongFlag(flag: string, knownLongFlags: readonly string[]): string | null {
  if (!flag.startsWith("--") || flag.length <= 2) {
    return null;
  }
  if (knownLongFlags.includes(flag)) {
    return flag;
  }
  const matches = knownLongFlags.filter((candidate) => candidate.startsWith(flag));
  if (matches.length !== 1) {
    return null;
  }
  return matches[0] ?? null;
}

function isDeniedLongFlagOrAbbreviation(flag: string, denied: ReadonlySet<string>): boolean {
  if (denied.has(flag)) {
    return true;
  }
  for (const candidate of denied) {
    if (candidate.startsWith(flag)) {
      return true;
    }
  }
  return false;
}

function hasUnsafeSafeBinValue(
  value: string | undefined,
  cwd: string,
  exists: (filePath: string) => boolean,
): boolean {
  if (!value || value.trim().length === 0) {
    return true;
  }
  if (value === "-") {
    return false;
  }
  if (hasGlobToken(value)) {
    return true;
  }
  if (isPathLikeToken(value)) {
    return true;
  }
  return exists(path.resolve(cwd, value));
}

function consumeSafeBinLongOption(params: {
  args: string[];
  index: number;
  policy: SafeBinPolicy;
  cwd: string;
  exists: (filePath: string) => boolean;
}): number {
  const token = params.args[params.index] ?? "";
  const eqIndex = token.indexOf("=");
  const flag = eqIndex > 0 ? token.slice(0, eqIndex) : token;
  const inlineValue = eqIndex > 0 ? token.slice(eqIndex + 1) : undefined;

  const policy = params.policy;
  let canonical = flag;
  if (policy.rejectUnknownLong) {
    const resolved = resolveCanonicalLongFlag(flag, policy.knownLongFlags);
    if (!resolved) {
      return -1;
    }
    canonical = resolved;
  } else if (isDeniedLongFlagOrAbbreviation(flag, policy.deniedLongFlags)) {
    return -1;
  }

  if (policy.deniedLongFlags.has(canonical)) {
    return -1;
  }

  const expectsValue = policy.allowedValueLongFlags.has(canonical);
  if (inlineValue !== undefined) {
    if (!expectsValue) {
      return policy.rejectUnknownLong ? -1 : params.index + 1;
    }
    return hasUnsafeSafeBinValue(inlineValue, params.cwd, params.exists) ? -1 : params.index + 1;
  }

  if (!expectsValue) {
    return params.index + 1;
  }
  const nextValue = params.args[params.index + 1];
  return hasUnsafeSafeBinValue(nextValue, params.cwd, params.exists) ? -1 : params.index + 2;
}

function consumeSafeBinShortOptionCluster(params: {
  args: string[];
  index: number;
  policy: SafeBinPolicy;
  cwd: string;
  exists: (filePath: string) => boolean;
}): number {
  const token = params.args[params.index] ?? "";
  if (!token.startsWith("-") || token.startsWith("--") || token.length <= 1) {
    return params.index + 1;
  }
  const cluster = token.slice(1);
  for (let i = 0; i < cluster.length; i += 1) {
    const flag = `-${cluster[i]}`;
    if (params.policy.deniedShortFlags.has(flag)) {
      return -1;
    }
    if (!params.policy.allowedValueShortFlags.has(flag)) {
      continue;
    }
    const inlineValue = cluster.slice(i + 1);
    if (inlineValue) {
      return hasUnsafeSafeBinValue(inlineValue, params.cwd, params.exists) ? -1 : params.index + 1;
    }
    const nextValue = params.args[params.index + 1];
    return hasUnsafeSafeBinValue(nextValue, params.cwd, params.exists) ? -1 : params.index + 2;
  }
  return params.index + 1;
}

export function normalizeSafeBins(entries?: string[]): Set<string> {
  if (!Array.isArray(entries)) {
    return new Set();
  }
  const normalized = entries
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return new Set(normalized);
}

function normalizeSafeBinTrustedPath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function normalizeSafeBinTrustedDirs(entries?: readonly string[] | null): Set<string> {
  if (!Array.isArray(entries)) {
    return new Set();
  }
  const normalized = entries
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => normalizeSafeBinTrustedPath(entry));
  return new Set(normalized);
}

export function getTrustedSafeBinDirs(extraDirs?: readonly string[] | null): Set<string> {
  const trusted = normalizeSafeBinTrustedDirs(DEFAULT_SAFE_BIN_TRUSTED_DIRS);
  const extras = normalizeSafeBinTrustedDirs(extraDirs);
  for (const entry of extras) {
    trusted.add(entry);
  }
  return trusted;
}

export function isTrustedSafeBinPath(params: {
  resolvedPath: string;
  trustedSafeBinDirs?: ReadonlySet<string>;
}): boolean {
  const trusted = params.trustedSafeBinDirs ?? getTrustedSafeBinDirs();
  const resolvedDir = normalizeSafeBinTrustedPath(path.dirname(params.resolvedPath));
  return trusted.has(resolvedDir);
}

export function resolveSafeBins(entries?: string[] | null): Set<string> {
  if (entries === undefined) {
    return normalizeSafeBins(DEFAULT_SAFE_BINS);
  }
  return normalizeSafeBins(entries ?? []);
}

export function isSafeBinUsage(params: {
  argv: string[];
  resolution: CommandResolution | null;
  safeBins: Set<string>;
  trustedSafeBinDirs?: ReadonlySet<string>;
  cwd?: string;
  fileExists?: (filePath: string) => boolean;
}): boolean {
  if (params.safeBins.size === 0) {
    return false;
  }
  const resolution = params.resolution;
  const execName = resolution?.executableName?.toLowerCase();
  if (!execName) {
    return false;
  }
  const matchesSafeBin =
    params.safeBins.has(execName) ||
    (process.platform === "win32" && params.safeBins.has(path.parse(execName).name));
  if (!matchesSafeBin) {
    return false;
  }
  if (!resolution?.resolvedPath) {
    return false;
  }
  if (
    !isTrustedSafeBinPath({
      resolvedPath: resolution.resolvedPath,
      trustedSafeBinDirs: params.trustedSafeBinDirs,
    })
  ) {
    return false;
  }
  const cwd = params.cwd ?? process.cwd();
  const exists = params.fileExists ?? defaultFileExists;
  const policy = resolveSafeBinPolicy(execName);
  let positionalCount = 0;
  for (let i = 1; i < params.argv.length; ) {
    const token = params.argv[i];
    if (!token) {
      i += 1;
      continue;
    }
    if (token === "-") {
      i += 1;
      continue;
    }
    if (token === "--") {
      i += 1;
      continue;
    }
    if (token.startsWith("-")) {
      if (token.startsWith("--")) {
        if (policy) {
          const nextIndex = consumeSafeBinLongOption({
            args: params.argv,
            index: i,
            policy,
            cwd,
            exists,
          });
          if (nextIndex < 0) {
            return false;
          }
          i = nextIndex;
          continue;
        }
      } else if (policy) {
        const nextIndex = consumeSafeBinShortOptionCluster({
          args: params.argv,
          index: i,
          policy,
          cwd,
          exists,
        });
        if (nextIndex < 0) {
          return false;
        }
        i = nextIndex;
        continue;
      }

      const eqIndex = token.indexOf("=");
      if (eqIndex > 0) {
        const value = token.slice(eqIndex + 1);
        if (value && (isPathLikeToken(value) || exists(path.resolve(cwd, value)))) {
          return false;
        }
      }
      i += 1;
      continue;
    }
    positionalCount += 1;
    if (typeof policy?.maxPositional === "number" && positionalCount > policy.maxPositional) {
      return false;
    }
    if (isPathLikeToken(token)) {
      return false;
    }
    if (exists(path.resolve(cwd, token))) {
      return false;
    }
    i += 1;
  }
  return true;
}

export type ExecAllowlistEvaluation = {
  allowlistSatisfied: boolean;
  allowlistMatches: ExecAllowlistEntry[];
};

function isPathScopedExecutableToken(token: string): boolean {
  return token.includes("/") || token.includes("\\");
}

function evaluateSegments(
  segments: ExecCommandSegment[],
  params: {
    allowlist: ExecAllowlistEntry[];
    safeBins: Set<string>;
    trustedSafeBinDirs?: ReadonlySet<string>;
    cwd?: string;
    skillBins?: Set<string>;
    autoAllowSkills?: boolean;
  },
): { satisfied: boolean; matches: ExecAllowlistEntry[] } {
  const matches: ExecAllowlistEntry[] = [];
  const allowSkills = params.autoAllowSkills === true && (params.skillBins?.size ?? 0) > 0;

  const satisfied = segments.every((segment) => {
    const candidatePath = resolveAllowlistCandidatePath(segment.resolution, params.cwd);
    const candidateResolution =
      candidatePath && segment.resolution
        ? { ...segment.resolution, resolvedPath: candidatePath }
        : segment.resolution;
    const match = matchAllowlist(params.allowlist, candidateResolution);
    if (match) {
      matches.push(match);
    }
    const safe = isSafeBinUsage({
      argv: segment.argv,
      resolution: segment.resolution,
      safeBins: params.safeBins,
      trustedSafeBinDirs: params.trustedSafeBinDirs,
      cwd: params.cwd,
    });
    const rawExecutable = segment.resolution?.rawExecutable?.trim() ?? "";
    const executableName = segment.resolution?.executableName;
    const usesExplicitPath = isPathScopedExecutableToken(rawExecutable);
    let skillAllow = false;
    if (
      allowSkills &&
      segment.resolution?.resolvedPath &&
      rawExecutable.length > 0 &&
      !usesExplicitPath &&
      executableName
    ) {
      skillAllow = Boolean(params.skillBins?.has(executableName));
    }
    return Boolean(match || safe || skillAllow);
  });

  return { satisfied, matches };
}

export function evaluateExecAllowlist(params: {
  analysis: ExecCommandAnalysis;
  allowlist: ExecAllowlistEntry[];
  safeBins: Set<string>;
  trustedSafeBinDirs?: ReadonlySet<string>;
  cwd?: string;
  skillBins?: Set<string>;
  autoAllowSkills?: boolean;
}): ExecAllowlistEvaluation {
  const allowlistMatches: ExecAllowlistEntry[] = [];
  if (!params.analysis.ok || params.analysis.segments.length === 0) {
    return { allowlistSatisfied: false, allowlistMatches };
  }

  // If the analysis contains chains, evaluate each chain part separately
  if (params.analysis.chains) {
    for (const chainSegments of params.analysis.chains) {
      const result = evaluateSegments(chainSegments, {
        allowlist: params.allowlist,
        safeBins: params.safeBins,
        trustedSafeBinDirs: params.trustedSafeBinDirs,
        cwd: params.cwd,
        skillBins: params.skillBins,
        autoAllowSkills: params.autoAllowSkills,
      });
      if (!result.satisfied) {
        return { allowlistSatisfied: false, allowlistMatches: [] };
      }
      allowlistMatches.push(...result.matches);
    }
    return { allowlistSatisfied: true, allowlistMatches };
  }

  // No chains, evaluate all segments together
  const result = evaluateSegments(params.analysis.segments, {
    allowlist: params.allowlist,
    safeBins: params.safeBins,
    trustedSafeBinDirs: params.trustedSafeBinDirs,
    cwd: params.cwd,
    skillBins: params.skillBins,
    autoAllowSkills: params.autoAllowSkills,
  });
  return { allowlistSatisfied: result.satisfied, allowlistMatches: result.matches };
}

/**
 * Splits a command string by chain operators (&&, ||, ;) while respecting quotes.
 * Returns null when no chain is present or when the chain is malformed.
 */
export type ExecAllowlistAnalysis = {
  analysisOk: boolean;
  allowlistSatisfied: boolean;
  allowlistMatches: ExecAllowlistEntry[];
  segments: ExecCommandSegment[];
};

function hasShellLineContinuation(command: string): boolean {
  return /\\(?:\r\n|\n|\r)/.test(command);
}

/**
 * Evaluates allowlist for shell commands (including &&, ||, ;) and returns analysis metadata.
 */
export function evaluateShellAllowlist(params: {
  command: string;
  allowlist: ExecAllowlistEntry[];
  safeBins: Set<string>;
  trustedSafeBinDirs?: ReadonlySet<string>;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  skillBins?: Set<string>;
  autoAllowSkills?: boolean;
  platform?: string | null;
}): ExecAllowlistAnalysis {
  const analysisFailure = (): ExecAllowlistAnalysis => ({
    analysisOk: false,
    allowlistSatisfied: false,
    allowlistMatches: [],
    segments: [],
  });

  // Keep allowlist analysis conservative: line continuation semantics are shell-dependent
  // and can change token boundaries at runtime.
  if (hasShellLineContinuation(params.command)) {
    return analysisFailure();
  }

  const chainParts = isWindowsPlatform(params.platform) ? null : splitCommandChain(params.command);
  if (!chainParts) {
    const analysis = analyzeShellCommand({
      command: params.command,
      cwd: params.cwd,
      env: params.env,
      platform: params.platform,
    });
    if (!analysis.ok) {
      return analysisFailure();
    }
    const evaluation = evaluateExecAllowlist({
      analysis,
      allowlist: params.allowlist,
      safeBins: params.safeBins,
      trustedSafeBinDirs: params.trustedSafeBinDirs,
      cwd: params.cwd,
      skillBins: params.skillBins,
      autoAllowSkills: params.autoAllowSkills,
    });
    return {
      analysisOk: true,
      allowlistSatisfied: evaluation.allowlistSatisfied,
      allowlistMatches: evaluation.allowlistMatches,
      segments: analysis.segments,
    };
  }

  const allowlistMatches: ExecAllowlistEntry[] = [];
  const segments: ExecCommandSegment[] = [];

  for (const part of chainParts) {
    const analysis = analyzeShellCommand({
      command: part,
      cwd: params.cwd,
      env: params.env,
      platform: params.platform,
    });
    if (!analysis.ok) {
      return analysisFailure();
    }

    segments.push(...analysis.segments);
    const evaluation = evaluateExecAllowlist({
      analysis,
      allowlist: params.allowlist,
      safeBins: params.safeBins,
      trustedSafeBinDirs: params.trustedSafeBinDirs,
      cwd: params.cwd,
      skillBins: params.skillBins,
      autoAllowSkills: params.autoAllowSkills,
    });
    allowlistMatches.push(...evaluation.allowlistMatches);
    if (!evaluation.allowlistSatisfied) {
      return {
        analysisOk: true,
        allowlistSatisfied: false,
        allowlistMatches,
        segments,
      };
    }
  }

  return {
    analysisOk: true,
    allowlistSatisfied: true,
    allowlistMatches,
    segments,
  };
}
