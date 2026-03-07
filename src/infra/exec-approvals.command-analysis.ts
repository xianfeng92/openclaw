import fs from "node:fs";
import path from "node:path";
import { expandHome } from "./exec-approvals.store.js";
import type { ExecAllowlistEntry } from "./exec-approvals.store.js";
export type CommandResolution = {
  rawExecutable: string;
  resolvedPath?: string;
  executableName: string;
};

const MAX_DISPATCH_WRAPPER_DEPTH = 4;
const MAX_ALLOW_ALWAYS_RECURSION_DEPTH = 3;
const POSIX_SHELL_WRAPPERS = new Set(["ash", "bash", "dash", "fish", "ksh", "sh", "zsh"]);
const WINDOWS_CMD_WRAPPERS = new Set(["cmd.exe", "cmd"]);
const POWERSHELL_WRAPPERS = new Set(["powershell", "powershell.exe", "pwsh", "pwsh.exe"]);
const DISPATCH_WRAPPER_EXECUTABLES = new Set([
  "chrt",
  "chrt.exe",
  "doas",
  "doas.exe",
  "env",
  "env.exe",
  "ionice",
  "ionice.exe",
  "nice",
  "nice.exe",
  "nohup",
  "nohup.exe",
  "setsid",
  "setsid.exe",
  "stdbuf",
  "stdbuf.exe",
  "sudo",
  "sudo.exe",
  "taskset",
  "taskset.exe",
  "timeout",
  "timeout.exe",
]);
const POSIX_INLINE_COMMAND_FLAGS = new Set(["-lc", "-c", "--command"]);
const POWERSHELL_INLINE_COMMAND_FLAGS = new Set(["-c", "-command", "--command"]);
const ENV_OPTIONS_WITH_VALUE = new Set([
  "-u",
  "--unset",
  "-C",
  "--chdir",
  "-S",
  "--split-string",
  "--default-signal",
  "--ignore-signal",
  "--block-signal",
]);
const ENV_FLAG_OPTIONS = new Set(["-i", "--ignore-environment", "-0", "--null"]);
const NICE_OPTIONS_WITH_VALUE = new Set(["-n", "--adjustment", "--priority"]);
const STDBUF_OPTIONS_WITH_VALUE = new Set(["-i", "--input", "-o", "--output", "-e", "--error"]);
const TIMEOUT_FLAG_OPTIONS = new Set(["--foreground", "--preserve-status", "-v", "--verbose"]);
const TIMEOUT_OPTIONS_WITH_VALUE = new Set(["-k", "--kill-after", "-s", "--signal"]);

function basenameLower(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return path.posix.basename(trimmed.replace(/\\/g, "/")).toLowerCase();
}

function normalizeExecutableName(value?: string | null): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function stripExeSuffix(value: string): string {
  return value.endsWith(".exe") ? value.slice(0, -4) : value;
}

function unwrapEnvInvocation(argv: string[]): string[] | null {
  let idx = 1;
  let expectsValue = false;
  while (idx < argv.length) {
    const token = argv[idx]?.trim() ?? "";
    if (!token) {
      idx += 1;
      continue;
    }
    if (expectsValue) {
      expectsValue = false;
      idx += 1;
      continue;
    }
    if (token === "--") {
      idx += 1;
      break;
    }
    if (token.startsWith("-") && token !== "-") {
      const lower = token.toLowerCase();
      const [flag] = lower.split("=", 2);
      if (ENV_FLAG_OPTIONS.has(flag)) {
        idx += 1;
        continue;
      }
      if (ENV_OPTIONS_WITH_VALUE.has(flag)) {
        if (!lower.includes("=")) {
          expectsValue = true;
        }
        idx += 1;
        continue;
      }
      return null;
    }
    const eq = token.indexOf("=");
    if (eq > 0) {
      idx += 1;
      continue;
    }
    break;
  }
  if (expectsValue) {
    return null;
  }
  return idx < argv.length ? argv.slice(idx) : null;
}

function unwrapNiceInvocation(argv: string[]): string[] | null {
  let idx = 1;
  let expectsOptionValue = false;
  while (idx < argv.length) {
    const token = argv[idx]?.trim() ?? "";
    if (!token) {
      idx += 1;
      continue;
    }
    if (expectsOptionValue) {
      expectsOptionValue = false;
      idx += 1;
      continue;
    }
    if (token === "--") {
      idx += 1;
      break;
    }
    if (token.startsWith("-") && token !== "-") {
      const lower = token.toLowerCase();
      const [flag] = lower.split("=", 2);
      if (/^-\d+$/.test(lower)) {
        idx += 1;
        continue;
      }
      if (NICE_OPTIONS_WITH_VALUE.has(flag)) {
        if (!lower.includes("=") && lower === flag) {
          expectsOptionValue = true;
        }
        idx += 1;
        continue;
      }
      if (lower.startsWith("-n") && lower.length > 2) {
        idx += 1;
        continue;
      }
      return null;
    }
    break;
  }
  if (expectsOptionValue) {
    return null;
  }
  return idx < argv.length ? argv.slice(idx) : null;
}

function unwrapNohupInvocation(argv: string[]): string[] | null {
  let idx = 1;
  while (idx < argv.length) {
    const token = argv[idx]?.trim() ?? "";
    if (!token) {
      idx += 1;
      continue;
    }
    if (token === "--") {
      idx += 1;
      break;
    }
    if (token.startsWith("-") && token !== "-") {
      const lower = token.toLowerCase();
      if (lower === "--help" || lower === "--version") {
        idx += 1;
        continue;
      }
      return null;
    }
    break;
  }
  return idx < argv.length ? argv.slice(idx) : null;
}

function unwrapStdbufInvocation(argv: string[]): string[] | null {
  let idx = 1;
  let expectsOptionValue = false;
  while (idx < argv.length) {
    const token = argv[idx]?.trim() ?? "";
    if (!token) {
      idx += 1;
      continue;
    }
    if (expectsOptionValue) {
      expectsOptionValue = false;
      idx += 1;
      continue;
    }
    if (token === "--") {
      idx += 1;
      break;
    }
    if (token.startsWith("-") && token !== "-") {
      const lower = token.toLowerCase();
      const [flag] = lower.split("=", 2);
      if (STDBUF_OPTIONS_WITH_VALUE.has(flag)) {
        if (!lower.includes("=")) {
          expectsOptionValue = true;
        }
        idx += 1;
        continue;
      }
      return null;
    }
    break;
  }
  if (expectsOptionValue) {
    return null;
  }
  return idx < argv.length ? argv.slice(idx) : null;
}

function unwrapTimeoutInvocation(argv: string[]): string[] | null {
  let idx = 1;
  let expectsOptionValue = false;
  while (idx < argv.length) {
    const token = argv[idx]?.trim() ?? "";
    if (!token) {
      idx += 1;
      continue;
    }
    if (expectsOptionValue) {
      expectsOptionValue = false;
      idx += 1;
      continue;
    }
    if (token === "--") {
      idx += 1;
      break;
    }
    if (token.startsWith("-") && token !== "-") {
      const lower = token.toLowerCase();
      const [flag] = lower.split("=", 2);
      if (TIMEOUT_FLAG_OPTIONS.has(flag)) {
        idx += 1;
        continue;
      }
      if (TIMEOUT_OPTIONS_WITH_VALUE.has(flag)) {
        if (!lower.includes("=")) {
          expectsOptionValue = true;
        }
        idx += 1;
        continue;
      }
      return null;
    }
    break;
  }
  if (expectsOptionValue || idx >= argv.length) {
    return null;
  }
  idx += 1; // duration
  return idx < argv.length ? argv.slice(idx) : null;
}

function unwrapKnownDispatchWrapperInvocation(argv: string[]): string[] | null | undefined {
  const token0 = argv[0]?.trim();
  if (!token0) {
    return undefined;
  }
  const base = basenameLower(token0);
  const normalizedBase = stripExeSuffix(base);
  switch (normalizedBase) {
    case "env":
      return unwrapEnvInvocation(argv);
    case "nice":
      return unwrapNiceInvocation(argv);
    case "nohup":
      return unwrapNohupInvocation(argv);
    case "stdbuf":
      return unwrapStdbufInvocation(argv);
    case "timeout":
      return unwrapTimeoutInvocation(argv);
    case "chrt":
    case "doas":
    case "ionice":
    case "setsid":
    case "sudo":
    case "taskset":
      return null;
    default:
      return undefined;
  }
}

function unwrapDispatchWrappersForResolution(
  argv: string[],
  maxDepth = MAX_DISPATCH_WRAPPER_DEPTH,
): string[] {
  let current = argv;
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const unwrapped = unwrapKnownDispatchWrapperInvocation(current);
    if (unwrapped === undefined) {
      break;
    }
    if (!unwrapped || unwrapped.length === 0) {
      break;
    }
    current = unwrapped;
  }
  return current;
}

function parsePosixInlineCommand(argv: string[]): string | null {
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) {
      continue;
    }
    const lower = token.toLowerCase();
    if (POSIX_INLINE_COMMAND_FLAGS.has(lower)) {
      const command = argv
        .slice(i + 1)
        .join(" ")
        .trim();
      return command || null;
    }
    if (lower.startsWith("--command=")) {
      const command = token.slice(token.indexOf("=") + 1).trim();
      return command || null;
    }
  }
  return null;
}

function parsePowershellInlineCommand(argv: string[]): string | null {
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) {
      continue;
    }
    const lower = token.toLowerCase();
    if (POWERSHELL_INLINE_COMMAND_FLAGS.has(lower)) {
      const command = argv
        .slice(i + 1)
        .join(" ")
        .trim();
      return command || null;
    }
    if (
      lower.startsWith("-command=") ||
      lower.startsWith("--command=") ||
      lower.startsWith("-c=")
    ) {
      const command = token.slice(token.indexOf("=") + 1).trim();
      return command || null;
    }
  }
  return null;
}

function parseCmdInlineCommand(argv: string[]): string | null {
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) {
      continue;
    }
    const lower = token.toLowerCase();
    if (lower === "/c") {
      const command = argv
        .slice(i + 1)
        .join(" ")
        .trim();
      return command || null;
    }
    if (lower.startsWith("/c:")) {
      const command = token.slice(3).trim();
      return command || null;
    }
  }
  return null;
}

function isShellWrapperToken(token: string): boolean {
  const base = basenameLower(token);
  const normalized = stripExeSuffix(base);
  return (
    POSIX_SHELL_WRAPPERS.has(normalized) ||
    WINDOWS_CMD_WRAPPERS.has(base) ||
    WINDOWS_CMD_WRAPPERS.has(normalized) ||
    POWERSHELL_WRAPPERS.has(base) ||
    POWERSHELL_WRAPPERS.has(normalized)
  );
}

function extractShellInlineCommand(argv: string[]): string | null {
  const token0 = argv[0]?.trim();
  if (!token0) {
    return null;
  }
  const base0 = basenameLower(token0);
  const normalized0 = stripExeSuffix(base0);
  if (POSIX_SHELL_WRAPPERS.has(normalized0)) {
    return parsePosixInlineCommand(argv);
  }
  if (WINDOWS_CMD_WRAPPERS.has(base0) || WINDOWS_CMD_WRAPPERS.has(normalized0)) {
    return parseCmdInlineCommand(argv);
  }
  if (POWERSHELL_WRAPPERS.has(base0) || POWERSHELL_WRAPPERS.has(normalized0)) {
    return parsePowershellInlineCommand(argv);
  }
  return null;
}

function isShellWrapperSegment(segment: ExecCommandSegment): boolean {
  const candidates = [
    normalizeExecutableName(segment.resolution?.executableName),
    normalizeExecutableName(segment.resolution?.rawExecutable),
    normalizeExecutableName(segment.argv[0]),
  ];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (isShellWrapperToken(candidate)) {
      return true;
    }
  }
  return false;
}

function isDispatchWrapperSegment(segment: ExecCommandSegment): boolean {
  const candidates = [
    normalizeExecutableName(segment.resolution?.executableName),
    normalizeExecutableName(segment.resolution?.rawExecutable),
    normalizeExecutableName(segment.argv[0]),
  ];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (DISPATCH_WRAPPER_EXECUTABLES.has(candidate)) {
      return true;
    }
    const base = basenameLower(candidate);
    if (DISPATCH_WRAPPER_EXECUTABLES.has(base)) {
      return true;
    }
  }
  return false;
}

function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return false;
    }
    if (process.platform !== "win32") {
      fs.accessSync(filePath, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function parseFirstToken(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) {
    return null;
  }
  const first = trimmed[0];
  if (first === '"' || first === "'") {
    const end = trimmed.indexOf(first, 1);
    if (end > 1) {
      return trimmed.slice(1, end);
    }
    return trimmed.slice(1);
  }
  const match = /^[^\s]+/.exec(trimmed);
  return match ? match[0] : null;
}

function resolveExecutablePath(rawExecutable: string, cwd?: string, env?: NodeJS.ProcessEnv) {
  const expanded = rawExecutable.startsWith("~") ? expandHome(rawExecutable) : rawExecutable;
  if (expanded.includes("/") || expanded.includes("\\")) {
    if (path.isAbsolute(expanded)) {
      return isExecutableFile(expanded) ? expanded : undefined;
    }
    const base = cwd && cwd.trim() ? cwd.trim() : process.cwd();
    const candidate = path.resolve(base, expanded);
    return isExecutableFile(candidate) ? candidate : undefined;
  }
  const envPath = env?.PATH ?? env?.Path ?? process.env.PATH ?? process.env.Path ?? "";
  const entries = envPath.split(path.delimiter).filter(Boolean);
  const hasExtension = process.platform === "win32" && path.extname(expanded).length > 0;
  const extensions =
    process.platform === "win32"
      ? hasExtension
        ? [""]
        : (
            env?.PATHEXT ??
            env?.Pathext ??
            process.env.PATHEXT ??
            process.env.Pathext ??
            ".EXE;.CMD;.BAT;.COM"
          )
            .split(";")
            .map((ext) => ext.toLowerCase())
      : [""];
  for (const entry of entries) {
    for (const ext of extensions) {
      const candidate = path.join(entry, expanded + ext);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

export function resolveCommandResolution(
  command: string,
  cwd?: string,
  env?: NodeJS.ProcessEnv,
): CommandResolution | null {
  const rawExecutable = parseFirstToken(command);
  if (!rawExecutable) {
    return null;
  }
  const resolvedPath = resolveExecutablePath(rawExecutable, cwd, env);
  const executableName = resolvedPath ? path.basename(resolvedPath) : rawExecutable;
  return { rawExecutable, resolvedPath, executableName };
}

export function resolveCommandResolutionFromArgv(
  argv: string[],
  cwd?: string,
  env?: NodeJS.ProcessEnv,
): CommandResolution | null {
  const effectiveArgv = unwrapDispatchWrappersForResolution(argv);
  const rawExecutable = effectiveArgv[0]?.trim();
  if (!rawExecutable) {
    return null;
  }
  const resolvedPath = resolveExecutablePath(rawExecutable, cwd, env);
  const executableName = resolvedPath ? path.basename(resolvedPath) : rawExecutable;
  return { rawExecutable, resolvedPath, executableName };
}

function normalizeMatchTarget(value: string): string {
  if (process.platform === "win32") {
    const stripped = value.replace(/^\\\\[?.]\\/, "");
    return stripped.replace(/\\/g, "/").toLowerCase();
  }
  return value.replace(/\\\\/g, "/").toLowerCase();
}

function tryRealpath(value: string): string | null {
  try {
    return fs.realpathSync(value);
  } catch {
    return null;
  }
}

function globToRegExp(pattern: string): RegExp {
  let regex = "^";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*") {
      const next = pattern[i + 1];
      if (next === "*") {
        regex += ".*";
        i += 2;
        continue;
      }
      regex += "[^/]*";
      i += 1;
      continue;
    }
    if (ch === "?") {
      regex += ".";
      i += 1;
      continue;
    }
    regex += ch.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&");
    i += 1;
  }
  regex += "$";
  return new RegExp(regex, "i");
}

function matchesPattern(pattern: string, target: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return false;
  }
  const expanded = trimmed.startsWith("~") ? expandHome(trimmed) : trimmed;
  const hasWildcard = /[*?]/.test(expanded);
  let normalizedPattern = expanded;
  let normalizedTarget = target;
  if (process.platform === "win32" && !hasWildcard) {
    normalizedPattern = tryRealpath(expanded) ?? expanded;
    normalizedTarget = tryRealpath(target) ?? target;
  }
  normalizedPattern = normalizeMatchTarget(normalizedPattern);
  normalizedTarget = normalizeMatchTarget(normalizedTarget);
  const regex = globToRegExp(normalizedPattern);
  return regex.test(normalizedTarget);
}

export function resolveAllowlistCandidatePath(
  resolution: CommandResolution | null,
  cwd?: string,
): string | undefined {
  if (!resolution) {
    return undefined;
  }
  if (resolution.resolvedPath) {
    return resolution.resolvedPath;
  }
  const raw = resolution.rawExecutable?.trim();
  if (!raw) {
    return undefined;
  }
  const expanded = raw.startsWith("~") ? expandHome(raw) : raw;
  if (!expanded.includes("/") && !expanded.includes("\\")) {
    return undefined;
  }
  if (path.isAbsolute(expanded)) {
    return expanded;
  }
  const base = cwd && cwd.trim() ? cwd.trim() : process.cwd();
  return path.resolve(base, expanded);
}

export function matchAllowlist(
  entries: ExecAllowlistEntry[],
  resolution: CommandResolution | null,
): ExecAllowlistEntry | null {
  if (!entries.length || !resolution?.resolvedPath) {
    return null;
  }
  const resolvedPath = resolution.resolvedPath;
  for (const entry of entries) {
    const pattern = entry.pattern?.trim();
    if (!pattern) {
      continue;
    }
    const hasPath = pattern.includes("/") || pattern.includes("\\") || pattern.includes("~");
    if (!hasPath) {
      continue;
    }
    if (matchesPattern(pattern, resolvedPath)) {
      return entry;
    }
  }
  return null;
}

export type ExecCommandSegment = {
  raw: string;
  argv: string[];
  resolution: CommandResolution | null;
};

export type ExecCommandAnalysis = {
  ok: boolean;
  reason?: string;
  segments: ExecCommandSegment[];
  chains?: ExecCommandSegment[][]; // Segments grouped by chain operator (&&, ||, ;)
};

const DISALLOWED_PIPELINE_TOKENS = new Set([">", "<", "`", "\n", "\r", "(", ")"]);
const DOUBLE_QUOTE_ESCAPES = new Set(["\\", '"', "$", "`"]);
const WINDOWS_UNSUPPORTED_TOKENS = new Set([
  "&",
  "|",
  "<",
  ">",
  "^",
  "(",
  ")",
  "%",
  "!",
  "\n",
  "\r",
]);

function isDoubleQuoteEscape(next: string | undefined): next is string {
  return Boolean(next && DOUBLE_QUOTE_ESCAPES.has(next));
}

function isEscapedLineContinuation(next: string | undefined): next is string {
  return next === "\n" || next === "\r";
}

type IteratorAction = "split" | "skip" | "include" | { reject: string };

/**
 * Iterates through a command string while respecting shell quoting rules.
 * The callback receives each character and the next character, and returns an action:
 * - "split": push current buffer as a segment and start a new one
 * - "skip": skip this character (and optionally the next via skip count)
 * - "include": add this character to the buffer
 * - { reject: reason }: abort with an error
 */
function iterateQuoteAware(
  command: string,
  onChar: (ch: string, next: string | undefined, index: number) => IteratorAction,
): { ok: true; parts: string[]; hasSplit: boolean } | { ok: false; reason: string } {
  const parts: string[] = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let hasSplit = false;

  const pushPart = () => {
    const trimmed = buf.trim();
    if (trimmed) {
      parts.push(trimmed);
    }
    buf = "";
  };

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    const next = command[i + 1];

    if (escaped) {
      buf += ch;
      escaped = false;
      continue;
    }
    if (!inSingle && !inDouble && ch === "\\") {
      escaped = true;
      buf += ch;
      continue;
    }
    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      }
      buf += ch;
      continue;
    }
    if (inDouble) {
      if (ch === "\\" && isEscapedLineContinuation(next)) {
        return { ok: false, reason: "unsupported shell token: newline" };
      }
      if (ch === "\\" && isDoubleQuoteEscape(next)) {
        buf += ch;
        buf += next;
        i += 1;
        continue;
      }
      if (ch === "$" && next === "(") {
        return { ok: false, reason: "unsupported shell token: $()" };
      }
      if (ch === "`") {
        return { ok: false, reason: "unsupported shell token: `" };
      }
      if (ch === "\n" || ch === "\r") {
        return { ok: false, reason: "unsupported shell token: newline" };
      }
      if (ch === '"') {
        inDouble = false;
      }
      buf += ch;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      buf += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      buf += ch;
      continue;
    }

    const action = onChar(ch, next, i);
    if (typeof action === "object" && "reject" in action) {
      return { ok: false, reason: action.reject };
    }
    if (action === "split") {
      pushPart();
      hasSplit = true;
      continue;
    }
    if (action === "skip") {
      continue;
    }
    buf += ch;
  }

  if (escaped || inSingle || inDouble) {
    return { ok: false, reason: "unterminated shell quote/escape" };
  }
  pushPart();
  return { ok: true, parts, hasSplit };
}

function splitShellPipeline(command: string): { ok: boolean; reason?: string; segments: string[] } {
  let emptySegment = false;
  const result = iterateQuoteAware(command, (ch, next) => {
    if (ch === "|" && next === "|") {
      return { reject: "unsupported shell token: ||" };
    }
    if (ch === "|" && next === "&") {
      return { reject: "unsupported shell token: |&" };
    }
    if (ch === "|") {
      emptySegment = true;
      return "split";
    }
    if (ch === "&" || ch === ";") {
      return { reject: `unsupported shell token: ${ch}` };
    }
    if (DISALLOWED_PIPELINE_TOKENS.has(ch)) {
      return { reject: `unsupported shell token: ${ch}` };
    }
    if (ch === "$" && next === "(") {
      return { reject: "unsupported shell token: $()" };
    }
    emptySegment = false;
    return "include";
  });

  if (!result.ok) {
    return { ok: false, reason: result.reason, segments: [] };
  }
  if (emptySegment || result.parts.length === 0) {
    return {
      ok: false,
      reason: result.parts.length === 0 ? "empty command" : "empty pipeline segment",
      segments: [],
    };
  }
  return { ok: true, segments: result.parts };
}

function findWindowsUnsupportedToken(command: string): string | null {
  for (const ch of command) {
    if (WINDOWS_UNSUPPORTED_TOKENS.has(ch)) {
      if (ch === "\n" || ch === "\r") {
        return "newline";
      }
      return ch;
    }
  }
  return null;
}

function tokenizeWindowsSegment(segment: string): string[] | null {
  const tokens: string[] = [];
  let buf = "";
  let inDouble = false;

  const pushToken = () => {
    if (buf.length > 0) {
      tokens.push(buf);
      buf = "";
    }
  };

  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];
    if (ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (!inDouble && /\s/.test(ch)) {
      pushToken();
      continue;
    }
    buf += ch;
  }

  if (inDouble) {
    return null;
  }
  pushToken();
  return tokens.length > 0 ? tokens : null;
}

function analyzeWindowsShellCommand(params: {
  command: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}): ExecCommandAnalysis {
  const unsupported = findWindowsUnsupportedToken(params.command);
  if (unsupported) {
    return {
      ok: false,
      reason: `unsupported windows shell token: ${unsupported}`,
      segments: [],
    };
  }
  const argv = tokenizeWindowsSegment(params.command);
  if (!argv || argv.length === 0) {
    return { ok: false, reason: "unable to parse windows command", segments: [] };
  }
  return {
    ok: true,
    segments: [
      {
        raw: params.command,
        argv,
        resolution: resolveCommandResolutionFromArgv(argv, params.cwd, params.env),
      },
    ],
  };
}

export function isWindowsPlatform(platform?: string | null): boolean {
  const normalized = String(platform ?? "")
    .trim()
    .toLowerCase();
  return normalized.startsWith("win");
}

function tokenizeShellSegment(segment: string): string[] | null {
  const tokens: string[] = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  const pushToken = () => {
    if (buf.length > 0) {
      tokens.push(buf);
      buf = "";
    }
  };

  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];
    if (escaped) {
      buf += ch;
      escaped = false;
      continue;
    }
    if (!inSingle && !inDouble && ch === "\\") {
      escaped = true;
      continue;
    }
    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      } else {
        buf += ch;
      }
      continue;
    }
    if (inDouble) {
      const next = segment[i + 1];
      if (ch === "\\" && isDoubleQuoteEscape(next)) {
        buf += next;
        i += 1;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
      } else {
        buf += ch;
      }
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (/\s/.test(ch)) {
      pushToken();
      continue;
    }
    buf += ch;
  }

  if (escaped || inSingle || inDouble) {
    return null;
  }
  pushToken();
  return tokens;
}

function parseSegmentsFromParts(
  parts: string[],
  cwd?: string,
  env?: NodeJS.ProcessEnv,
): ExecCommandSegment[] | null {
  const segments: ExecCommandSegment[] = [];
  for (const raw of parts) {
    const argv = tokenizeShellSegment(raw);
    if (!argv || argv.length === 0) {
      return null;
    }
    segments.push({
      raw,
      argv,
      resolution: resolveCommandResolutionFromArgv(argv, cwd, env),
    });
  }
  return segments;
}

export function analyzeShellCommand(params: {
  command: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: string | null;
}): ExecCommandAnalysis {
  if (isWindowsPlatform(params.platform)) {
    return analyzeWindowsShellCommand(params);
  }
  // First try splitting by chain operators (&&, ||, ;)
  const chainParts = splitCommandChain(params.command);
  if (chainParts) {
    const chains: ExecCommandSegment[][] = [];
    const allSegments: ExecCommandSegment[] = [];

    for (const part of chainParts) {
      const pipelineSplit = splitShellPipeline(part);
      if (!pipelineSplit.ok) {
        return { ok: false, reason: pipelineSplit.reason, segments: [] };
      }
      const segments = parseSegmentsFromParts(pipelineSplit.segments, params.cwd, params.env);
      if (!segments) {
        return { ok: false, reason: "unable to parse shell segment", segments: [] };
      }
      chains.push(segments);
      allSegments.push(...segments);
    }

    return { ok: true, segments: allSegments, chains };
  }

  // No chain operators, parse as simple pipeline
  const split = splitShellPipeline(params.command);
  if (!split.ok) {
    return { ok: false, reason: split.reason, segments: [] };
  }
  const segments = parseSegmentsFromParts(split.segments, params.cwd, params.env);
  if (!segments) {
    return { ok: false, reason: "unable to parse shell segment", segments: [] };
  }
  return { ok: true, segments };
}

export function analyzeArgvCommand(params: {
  argv: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}): ExecCommandAnalysis {
  const argv = params.argv.filter((entry) => entry.trim().length > 0);
  if (argv.length === 0) {
    return { ok: false, reason: "empty argv", segments: [] };
  }
  return {
    ok: true,
    segments: [
      {
        raw: argv.join(" "),
        argv,
        resolution: resolveCommandResolutionFromArgv(argv, params.cwd, params.env),
      },
    ],
  };
}

export function extractShellCommandFromArgv(argv: string[]): string | null {
  if (argv.length === 0) {
    return null;
  }
  let current = argv;
  for (let depth = 0; depth < MAX_DISPATCH_WRAPPER_DEPTH; depth += 1) {
    const inline = extractShellInlineCommand(current);
    if (inline) {
      return inline;
    }
    const unwrapped = unwrapKnownDispatchWrapperInvocation(current);
    if (!unwrapped || unwrapped.length === 0) {
      return null;
    }
    current = unwrapped;
  }
  return null;
}

function collectAllowAlwaysPatterns(params: {
  segment: ExecCommandSegment;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: string | null;
  depth: number;
  out: Set<string>;
}) {
  if (params.depth >= MAX_ALLOW_ALWAYS_RECURSION_DEPTH) {
    return;
  }

  if (isDispatchWrapperSegment(params.segment)) {
    const unwrappedArgv = unwrapKnownDispatchWrapperInvocation(params.segment.argv);
    if (!unwrappedArgv || unwrappedArgv.length === 0) {
      return;
    }
    collectAllowAlwaysPatterns({
      segment: {
        raw: unwrappedArgv.join(" "),
        argv: unwrappedArgv,
        resolution: resolveCommandResolutionFromArgv(unwrappedArgv, params.cwd, params.env),
      },
      cwd: params.cwd,
      env: params.env,
      platform: params.platform,
      depth: params.depth + 1,
      out: params.out,
    });
    return;
  }

  const candidatePath = resolveAllowlistCandidatePath(params.segment.resolution, params.cwd);
  if (!candidatePath) {
    return;
  }
  if (!isShellWrapperSegment(params.segment)) {
    params.out.add(candidatePath);
    return;
  }
  const inlineCommand = extractShellInlineCommand(params.segment.argv);
  if (!inlineCommand) {
    return;
  }
  const analysis = analyzeShellCommand({
    command: inlineCommand,
    cwd: params.cwd,
    env: params.env,
    platform: params.platform,
  });
  if (!analysis.ok) {
    return;
  }
  for (const nestedSegment of analysis.segments) {
    collectAllowAlwaysPatterns({
      segment: nestedSegment,
      cwd: params.cwd,
      env: params.env,
      platform: params.platform,
      depth: params.depth + 1,
      out: params.out,
    });
  }
}

export function resolveAllowAlwaysPatterns(params: {
  segments: ExecCommandSegment[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: string | null;
}): string[] {
  const out = new Set<string>();
  for (const segment of params.segments) {
    collectAllowAlwaysPatterns({
      segment,
      cwd: params.cwd,
      env: params.env,
      platform: params.platform,
      depth: 0,
      out,
    });
  }
  return [...out];
}

export function splitCommandChain(command: string): string[] | null {
  const parts: string[] = [];
  let buf = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let foundChain = false;
  let invalidChain = false;

  const pushPart = () => {
    const trimmed = buf.trim();
    if (trimmed) {
      parts.push(trimmed);
      buf = "";
      return true;
    }
    buf = "";
    return false;
  };

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    const next = command[i + 1];
    if (escaped) {
      buf += ch;
      escaped = false;
      continue;
    }
    if (!inSingle && !inDouble && ch === "\\") {
      escaped = true;
      buf += ch;
      continue;
    }
    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      }
      buf += ch;
      continue;
    }
    if (inDouble) {
      if (ch === "\\" && isEscapedLineContinuation(next)) {
        invalidChain = true;
        break;
      }
      if (ch === "\\" && isDoubleQuoteEscape(next)) {
        buf += ch;
        buf += next;
        i += 1;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
      }
      buf += ch;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      buf += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      buf += ch;
      continue;
    }

    if (ch === "&" && command[i + 1] === "&") {
      if (!pushPart()) {
        invalidChain = true;
      }
      i += 1;
      foundChain = true;
      continue;
    }
    if (ch === "|" && command[i + 1] === "|") {
      if (!pushPart()) {
        invalidChain = true;
      }
      i += 1;
      foundChain = true;
      continue;
    }
    if (ch === ";") {
      if (!pushPart()) {
        invalidChain = true;
      }
      foundChain = true;
      continue;
    }

    buf += ch;
  }

  const pushedFinal = pushPart();
  if (!foundChain) {
    return null;
  }
  if (invalidChain || !pushedFinal) {
    return null;
  }
  return parts.length > 0 ? parts : null;
}

