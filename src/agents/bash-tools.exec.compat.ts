import path from "node:path";
import type { ExecAsk, ExecHost, ExecSecurity } from "../infra/exec-approvals.js";
import { requestHeartbeatNow } from "../infra/heartbeat-wake.js";
import { enqueueSystemEvent } from "../infra/system-events.js";
import type { ProcessSession } from "./bash-process-registry.js";
import { tail } from "./bash-process-registry.js";

const DANGEROUS_HOST_ENV_VARS = new Set([
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "LD_AUDIT",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PYTHONPATH",
  "PYTHONHOME",
  "RUBYLIB",
  "PERL5LIB",
  "BASH_ENV",
  "ENV",
  "HOME",
  "ZDOTDIR",
  "GCONV_PATH",
  "IFS",
  "SSLKEYLOGFILE",
]);
const DANGEROUS_HOST_ENV_PREFIXES = ["DYLD_", "LD_"];
const WINDOWS_BARE_POWERSHELL_CMDLETS = new Set(["get-childitem", "select-string"]);

export function validateHostEnv(env: Record<string, string>): void {
  for (const key of Object.keys(env)) {
    const upperKey = key.toUpperCase();
    if (DANGEROUS_HOST_ENV_PREFIXES.some((prefix) => upperKey.startsWith(prefix))) {
      throw new Error(
        `Security Violation: Environment variable '${key}' is forbidden during host execution.`,
      );
    }
    if (DANGEROUS_HOST_ENV_VARS.has(upperKey)) {
      throw new Error(
        `Security Violation: Environment variable '${key}' is forbidden during host execution.`,
      );
    }
    if (upperKey === "PATH") {
      throw new Error(
        "Security Violation: Custom 'PATH' variable is forbidden during host execution.",
      );
    }
  }
}

export function normalizeExecHost(value?: string | null): ExecHost | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "sandbox" || normalized === "gateway" || normalized === "node") {
    return normalized;
  }
  return null;
}

export function normalizeExecSecurity(value?: string | null): ExecSecurity | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "deny" || normalized === "allowlist" || normalized === "full") {
    return normalized;
  }
  return null;
}

export function normalizeExecAsk(value?: string | null): ExecAsk | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "off" || normalized === "on-miss" || normalized === "always") {
    return normalized as ExecAsk;
  }
  return null;
}

export function renderExecHostLabel(host: ExecHost) {
  return host === "sandbox" ? "sandbox" : host === "gateway" ? "gateway" : "node";
}

export function normalizeNotifyOutput(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isWindowsPowerShellInvoker(command: string) {
  const normalized = command.trim().toLowerCase();
  return (
    normalized === "powershell" ||
    normalized.startsWith("powershell ") ||
    normalized === "pwsh" ||
    normalized.startsWith("pwsh ")
  );
}

function detectLeadingBareWindowsPowerShellCmdlet(command: string): string | undefined {
  const trimmed = command.trim();
  if (!trimmed) {
    return undefined;
  }
  if (isWindowsPowerShellInvoker(trimmed)) {
    return undefined;
  }
  const match = trimmed.match(/^([A-Za-z][A-Za-z0-9-]*)\b/);
  if (!match) {
    return undefined;
  }
  const candidate = match[1];
  if (!WINDOWS_BARE_POWERSHELL_CMDLETS.has(candidate.toLowerCase())) {
    return undefined;
  }
  return candidate;
}

export function normalizeWindowsExecCommand(params: {
  command: string;
  platform?: NodeJS.Platform;
}): { command: string; wrapped: boolean; cmdlet?: string } {
  const platform = params.platform ?? process.platform;
  const sourceCommand = params.command;
  if (platform !== "win32") {
    return { command: sourceCommand, wrapped: false };
  }
  const cmdlet = detectLeadingBareWindowsPowerShellCmdlet(sourceCommand);
  if (!cmdlet) {
    return { command: sourceCommand, wrapped: false };
  }
  const encoded = Buffer.from(sourceCommand, "utf16le").toString("base64");
  return {
    command: `powershell -NoProfile -EncodedCommand ${encoded}`,
    wrapped: true,
    cmdlet,
  };
}

export function normalizePathPrepend(entries?: string[]) {
  if (!Array.isArray(entries)) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function mergePathPrepend(existing: string | undefined, prepend: string[]) {
  if (prepend.length === 0) {
    return existing;
  }
  const partsExisting = (existing ?? "")
    .split(path.delimiter)
    .map((part) => part.trim())
    .filter(Boolean);
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const part of [...prepend, ...partsExisting]) {
    if (seen.has(part)) {
      continue;
    }
    seen.add(part);
    merged.push(part);
  }
  return merged.join(path.delimiter);
}

export function applyPathPrepend(
  env: Record<string, string>,
  prepend: string[],
  options?: { requireExisting?: boolean },
) {
  if (prepend.length === 0) {
    return;
  }
  if (options?.requireExisting && !env.PATH) {
    return;
  }
  const merged = mergePathPrepend(env.PATH, prepend);
  if (merged) {
    env.PATH = merged;
  }
}

export function applyShellPath(env: Record<string, string>, shellPath?: string | null) {
  if (!shellPath) {
    return;
  }
  const entries = shellPath
    .split(path.delimiter)
    .map((part) => part.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    return;
  }
  const merged = mergePathPrepend(env.PATH, entries);
  if (merged) {
    env.PATH = merged;
  }
}

export function maybeNotifyOnExit(params: {
  session: ProcessSession;
  status: "completed" | "failed";
  tailChars: number;
}) {
  const { session, status, tailChars } = params;
  if (!session.backgrounded || !session.notifyOnExit || session.exitNotified) {
    return;
  }
  const sessionKey = session.sessionKey?.trim();
  if (!sessionKey) {
    return;
  }
  session.exitNotified = true;
  const exitLabel = session.exitSignal
    ? `signal ${session.exitSignal}`
    : `code ${session.exitCode ?? 0}`;
  const output = normalizeNotifyOutput(tail(session.tail || session.aggregated || "", tailChars));
  const summary = output
    ? `Exec ${status} (${session.id.slice(0, 8)}, ${exitLabel}) :: ${output}`
    : `Exec ${status} (${session.id.slice(0, 8)}, ${exitLabel})`;
  enqueueSystemEvent(summary, { sessionKey });
  requestHeartbeatNow({ reason: `exec:${session.id}:exit` });
}
