import type { ExecAsk, ExecHost, ExecSecurity } from "../infra/exec-approvals.js";
import { maxAsk, minSecurity } from "../infra/exec-approvals.js";
import {
  getShellPathFromLoginShell,
  resolveShellEnvFallbackTimeoutMs,
} from "../infra/shell-env.js";
import { logInfo } from "../logger.js";
import {
  applyPathPrepend,
  applyShellPath,
  normalizeExecAsk,
  normalizeExecHost,
  normalizeExecSecurity,
  normalizePathPrepend,
  normalizeWindowsExecCommand,
  renderExecHostLabel,
  validateHostEnv,
} from "./bash-tools.exec.compat.js";
import type {
  ExecElevatedDefaults,
  ExecToolDefaults,
  ExecToolParams,
} from "./bash-tools.exec.types.js";
import {
  buildSandboxEnv,
  clampNumber,
  coerceEnv,
  resolveSandboxWorkdir,
  resolveWorkdir,
  truncateMiddle,
} from "./bash-tools.shared.js";

type PreparedExecContext = {
  warnings: string[];
  yieldWindow: number | null;
  host: ExecHost;
  security: ExecSecurity;
  ask: ExecAsk;
  bypassApprovals: boolean;
  sandbox?: ExecToolDefaults["sandbox"];
  workdir: string;
  containerWorkdir?: string | null;
  env: Record<string, string>;
  commandForLocalShell: string;
};

type PrepareExecContextParams = {
  params: ExecToolParams;
  defaults?: ExecToolDefaults;
  allowBackground: boolean;
  defaultBackgroundMs: number;
  defaultPathPrepend: string[];
  defaultPath: string;
};

function resolveElevatedMode(
  params: ExecToolParams,
  elevatedDefaults: ExecElevatedDefaults | undefined,
): { elevatedMode: "off" | "ask" | "full"; elevatedRequested: boolean } {
  const elevatedAllowed = Boolean(elevatedDefaults?.enabled && elevatedDefaults.allowed);
  const elevatedDefaultMode =
    elevatedDefaults?.defaultLevel === "full"
      ? "full"
      : elevatedDefaults?.defaultLevel === "ask"
        ? "ask"
        : elevatedDefaults?.defaultLevel === "on"
          ? "ask"
          : "off";
  const effectiveDefaultMode = elevatedAllowed ? elevatedDefaultMode : "off";
  const elevatedMode =
    typeof params.elevated === "boolean"
      ? params.elevated
        ? elevatedDefaultMode === "full"
          ? "full"
          : "ask"
        : "off"
      : effectiveDefaultMode;
  return { elevatedMode, elevatedRequested: elevatedMode !== "off" };
}

function assertElevatedAllowed(params: {
  elevatedRequested: boolean;
  elevatedDefaults: ExecElevatedDefaults | undefined;
  defaults?: ExecToolDefaults;
}): void {
  if (!params.elevatedRequested) {
    return;
  }
  if (params.elevatedDefaults?.enabled && params.elevatedDefaults.allowed) {
    return;
  }

  const runtime = params.defaults?.sandbox ? "sandboxed" : "direct";
  const gates: string[] = [];
  const contextParts: string[] = [];
  const provider = params.defaults?.messageProvider?.trim();
  const sessionKey = params.defaults?.sessionKey?.trim();
  if (provider) {
    contextParts.push(`provider=${provider}`);
  }
  if (sessionKey) {
    contextParts.push(`session=${sessionKey}`);
  }
  if (!params.elevatedDefaults?.enabled) {
    gates.push("enabled (tools.elevated.enabled / agents.list[].tools.elevated.enabled)");
  } else {
    gates.push(
      "allowFrom (tools.elevated.allowFrom.<provider> / agents.list[].tools.elevated.allowFrom.<provider>)",
    );
  }
  throw new Error(
    [
      `elevated is not available right now (runtime=${runtime}).`,
      `Failing gates: ${gates.join(", ")}`,
      contextParts.length > 0 ? `Context: ${contextParts.join(" ")}` : undefined,
      "Fix-it keys:",
      "- tools.elevated.enabled",
      "- tools.elevated.allowFrom.<provider>",
      "- agents.list[].tools.elevated.enabled",
      "- agents.list[].tools.elevated.allowFrom.<provider>",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

export async function prepareExecContext(
  params: PrepareExecContextParams,
): Promise<PreparedExecContext> {
  const warnings: string[] = [];
  const backgroundRequested = params.params.background === true;
  const yieldRequested = typeof params.params.yieldMs === "number";
  if (!params.allowBackground && (backgroundRequested || yieldRequested)) {
    warnings.push("Warning: background execution is disabled; running synchronously.");
  }
  const yieldWindow = params.allowBackground
    ? backgroundRequested
      ? 0
      : clampNumber(
          params.params.yieldMs ?? params.defaultBackgroundMs,
          params.defaultBackgroundMs,
          10,
          120_000,
        )
    : null;

  const elevatedDefaults = params.defaults?.elevated;
  const { elevatedMode, elevatedRequested } = resolveElevatedMode(params.params, elevatedDefaults);
  assertElevatedAllowed({
    elevatedRequested,
    elevatedDefaults,
    defaults: params.defaults,
  });
  if (elevatedRequested) {
    logInfo(`exec: elevated command ${truncateMiddle(params.params.command, 120)}`);
  }

  const configuredHost = params.defaults?.host ?? "sandbox";
  const requestedHost = normalizeExecHost(params.params.host) ?? null;
  let host: ExecHost = requestedHost ?? configuredHost;
  if (!elevatedRequested && requestedHost && requestedHost !== configuredHost) {
    throw new Error(
      `exec host not allowed (requested ${renderExecHostLabel(requestedHost)}; ` +
        `configure tools.exec.host=${renderExecHostLabel(configuredHost)} to allow).`,
    );
  }
  if (elevatedRequested) {
    host = "gateway";
  }

  const configuredSecurity =
    params.defaults?.security ?? (host === "sandbox" ? "deny" : "allowlist");
  const requestedSecurity = normalizeExecSecurity(params.params.security);
  let security = minSecurity(configuredSecurity, requestedSecurity ?? configuredSecurity);
  if (elevatedRequested && elevatedMode === "full") {
    security = "full";
  }

  const configuredAsk = params.defaults?.ask ?? "on-miss";
  const requestedAsk = normalizeExecAsk(params.params.ask);
  let ask = maxAsk(configuredAsk, requestedAsk ?? configuredAsk);
  const bypassApprovals = elevatedRequested && elevatedMode === "full";
  if (bypassApprovals) {
    ask = "off";
  }

  const sandbox = host === "sandbox" ? params.defaults?.sandbox : undefined;
  const normalizedWindowsCommand =
    host === "node" || sandbox
      ? { command: params.params.command, wrapped: false as const, cmdlet: undefined }
      : normalizeWindowsExecCommand({
          command: params.params.command,
          platform: process.platform,
        });
  const commandForLocalShell = normalizedWindowsCommand.command;
  if (normalizedWindowsCommand.wrapped) {
    warnings.push(
      `Windows fallback: wrapped bare ${normalizedWindowsCommand.cmdlet} command in powershell -NoProfile -EncodedCommand.`,
    );
  }

  const rawWorkdir = params.params.workdir?.trim() || params.defaults?.cwd || process.cwd();
  let workdir = rawWorkdir;
  let containerWorkdir = sandbox?.containerWorkdir;
  if (sandbox) {
    const resolved = await resolveSandboxWorkdir({
      workdir: rawWorkdir,
      sandbox,
      warnings,
    });
    workdir = resolved.hostWorkdir;
    containerWorkdir = resolved.containerWorkdir;
  } else {
    workdir = resolveWorkdir(rawWorkdir, warnings);
  }

  const baseEnv = coerceEnv(process.env);
  if (host !== "sandbox" && params.params.env) {
    validateHostEnv(params.params.env);
  }
  const mergedEnv = params.params.env ? { ...baseEnv, ...params.params.env } : baseEnv;
  const env = sandbox
    ? buildSandboxEnv({
        defaultPath: params.defaultPath,
        paramsEnv: params.params.env,
        sandboxEnv: sandbox.env,
        containerWorkdir: containerWorkdir ?? sandbox.containerWorkdir,
      })
    : mergedEnv;

  if (!sandbox && host === "gateway" && !params.params.env?.PATH) {
    const shellPath = getShellPathFromLoginShell({
      env: process.env,
      timeoutMs: resolveShellEnvFallbackTimeoutMs(process.env),
    });
    applyShellPath(env, shellPath);
  }
  applyPathPrepend(env, params.defaultPathPrepend);

  return {
    warnings,
    yieldWindow,
    host,
    security,
    ask,
    bypassApprovals,
    sandbox,
    workdir,
    containerWorkdir,
    env,
    commandForLocalShell,
  };
}
