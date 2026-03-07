import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import {
  getTrustedSafeBinDirs,
  resolveSafeBins,
} from "../infra/exec-approvals.js";
import { parseAgentSessionKey, resolveAgentIdFromSessionKey } from "../routing/session-key.js";
import { resolveApprovalRunningNoticeMs } from "./bash-tools.exec.approvals.js";
import { normalizePathPrepend } from "./bash-tools.exec.compat.js";
import { prepareExecContext } from "./bash-tools.exec.context.js";
import { maybeExecuteGatewayHost } from "./bash-tools.exec.gateway-host.js";
import { executeLocalExecHost } from "./bash-tools.exec.local-host.js";
import { executeNodeExecHost } from "./bash-tools.exec.node-host.js";
import type {
  ExecToolDefaults,
  ExecToolDetails,
  ExecToolParams,
} from "./bash-tools.exec.types.js";
import { clampNumber, readEnvInt } from "./bash-tools.shared.js";
import { callGatewayTool } from "./tools/gateway.js";
import { listNodes, resolveNodeIdFromList } from "./tools/nodes-utils.js";
const DEFAULT_MAX_OUTPUT = clampNumber(
  readEnvInt("PI_BASH_MAX_OUTPUT_CHARS"),
  200_000,
  1_000,
  200_000,
);
const DEFAULT_PENDING_MAX_OUTPUT = clampNumber(
  readEnvInt("OPENCLAW_BASH_PENDING_MAX_OUTPUT_CHARS"),
  200_000,
  1_000,
  200_000,
);
const DEFAULT_PATH =
  process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const DEFAULT_NOTIFY_TAIL_CHARS = 400;
const DEFAULT_APPROVAL_TIMEOUT_MS = 120_000;
const DEFAULT_APPROVAL_REQUEST_TIMEOUT_MS = 130_000;
const DEFAULT_APPROVAL_RUNNING_NOTICE_MS = 10_000;
const APPROVAL_SLUG_LENGTH = 8;

export type { BashSandboxConfig } from "./bash-tools.shared.js";
export type {
  ExecElevatedDefaults,
  ExecToolDefaults,
  ExecToolDetails,
  ExecToolParams,
} from "./bash-tools.exec.types.js";

const execSchema = Type.Object({
  command: Type.String({ description: "Shell command to execute" }),
  workdir: Type.Optional(Type.String({ description: "Working directory (defaults to cwd)" })),
  env: Type.Optional(Type.Record(Type.String(), Type.String())),
  yieldMs: Type.Optional(
    Type.Number({
      description: "Milliseconds to wait before backgrounding (default 10000)",
    }),
  ),
  background: Type.Optional(Type.Boolean({ description: "Run in background immediately" })),
  timeout: Type.Optional(
    Type.Number({
      description: "Timeout in seconds (optional, kills process on expiry)",
    }),
  ),
  pty: Type.Optional(
    Type.Boolean({
      description:
        "Run in a pseudo-terminal (PTY) when available (TTY-required CLIs, coding agents)",
    }),
  ),
  elevated: Type.Optional(
    Type.Boolean({
      description: "Run on the host with elevated permissions (if allowed)",
    }),
  ),
  host: Type.Optional(
    Type.String({
      description: "Exec host (sandbox|gateway|node).",
    }),
  ),
  security: Type.Optional(
    Type.String({
      description: "Exec security mode (deny|allowlist|full).",
    }),
  ),
  ask: Type.Optional(
    Type.String({
      description: "Exec ask mode (off|on-miss|always).",
    }),
  ),
  node: Type.Optional(
    Type.String({
      description: "Node id/name for host=node.",
    }),
  ),
});
export { normalizeWindowsExecCommand } from "./bash-tools.exec.compat.js";



export function createExecTool(
  defaults?: ExecToolDefaults,
  // oxlint-disable-next-line typescript/no-explicit-any
): AgentTool<any, ExecToolDetails> {
  const defaultBackgroundMs = clampNumber(
    defaults?.backgroundMs ?? readEnvInt("PI_BASH_YIELD_MS"),
    10_000,
    10,
    120_000,
  );
  const allowBackground = defaults?.allowBackground ?? true;
  const defaultTimeoutSec =
    typeof defaults?.timeoutSec === "number" && defaults.timeoutSec > 0
      ? defaults.timeoutSec
      : 1800;
  const defaultPathPrepend = normalizePathPrepend(defaults?.pathPrepend);
  const safeBins = resolveSafeBins(defaults?.safeBins);
  const trustedSafeBinDirs = getTrustedSafeBinDirs(defaults?.safeBinTrustedDirs);
  const notifyOnExit = defaults?.notifyOnExit !== false;
  const notifySessionKey = defaults?.sessionKey?.trim() || undefined;
  const gatewayCallTool = defaults?.gatewayCallTool ?? callGatewayTool;
  const listNodesTool = defaults?.listNodesTool ?? listNodes;
  const resolveNodeIdFromListTool =
    defaults?.resolveNodeIdFromListTool ?? resolveNodeIdFromList;
  const approvalRunningNoticeMs = resolveApprovalRunningNoticeMs(
    defaults?.approvalRunningNoticeMs,
    DEFAULT_APPROVAL_RUNNING_NOTICE_MS,
  );
  // Derive agentId only when sessionKey is an agent session key.
  const parsedAgentSession = parseAgentSessionKey(defaults?.sessionKey);
  const agentId =
    defaults?.agentId ??
    (parsedAgentSession ? resolveAgentIdFromSessionKey(defaults?.sessionKey) : undefined);

  return {
    name: "exec",
    label: "exec",
    description:
      "Execute shell commands with background continuation. Use yieldMs/background to continue later via process tool. Use pty=true for TTY-required commands (terminal UIs, coding agents).",
    parameters: execSchema,
    execute: async (_toolCallId, args, signal, onUpdate) => {
      const params = args as ExecToolParams;

      if (!params.command) {
        throw new Error("Provide a command to start.");
      }

      const maxOutput = DEFAULT_MAX_OUTPUT;
      const pendingMaxOutput = DEFAULT_PENDING_MAX_OUTPUT;
      const {
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
      } = await prepareExecContext({
        params,
        defaults,
        allowBackground,
        defaultBackgroundMs,
        defaultPathPrepend,
        defaultPath: DEFAULT_PATH,
      });

      if (host === "node") {
        return await executeNodeExecHost({
          params,
          agentId,
          security,
          ask,
          workdir,
          env,
          warnings,
          defaultPathPrepend,
          defaultTimeoutSec,
          approvalRunningNoticeMs,
          approvalTimeoutMs: DEFAULT_APPROVAL_TIMEOUT_MS,
          approvalRequestTimeoutMs: DEFAULT_APPROVAL_REQUEST_TIMEOUT_MS,
          approvalSlugLength: APPROVAL_SLUG_LENGTH,
          boundNode: defaults?.node?.trim(),
          sessionKey: defaults?.sessionKey,
          notifySessionKey,
          gatewayCallTool,
          listNodesTool,
          resolveNodeIdFromListTool,
        });
      }
      if (host === "gateway" && !bypassApprovals) {
        const gatewayResult = await maybeExecuteGatewayHost({
          params,
          agentId,
          security,
          ask,
          workdir,
          env,
          warnings,
          safeBins,
          trustedSafeBinDirs,
          defaultTimeoutSec,
          approvalRunningNoticeMs,
          approvalTimeoutMs: DEFAULT_APPROVAL_TIMEOUT_MS,
          approvalRequestTimeoutMs: DEFAULT_APPROVAL_REQUEST_TIMEOUT_MS,
          approvalSlugLength: APPROVAL_SLUG_LENGTH,
          notifyTailChars: DEFAULT_NOTIFY_TAIL_CHARS,
          commandForLocalShell,
          usePty: params.pty === true && !sandbox,
          maxOutput,
          pendingMaxOutput,
          scopeKey: defaults?.scopeKey,
          sessionKey: defaults?.sessionKey,
          notifySessionKey,
          gatewayCallTool,
        });
        if (gatewayResult) {
          return gatewayResult;
        }
      }
      const effectiveTimeout =
        typeof params.timeout === "number" ? params.timeout : defaultTimeoutSec;
      return await executeLocalExecHost({
        command: commandForLocalShell,
        workdir,
        env,
        sandbox,
        containerWorkdir,
        usePty: params.pty === true && !sandbox,
        warnings,
        maxOutput,
        pendingMaxOutput,
        notifyOnExit,
        scopeKey: defaults?.scopeKey,
        sessionKey: notifySessionKey,
        timeoutSec: effectiveTimeout,
        notifyTailChars: DEFAULT_NOTIFY_TAIL_CHARS,
        allowBackground,
        yieldWindow,
        signal,
        onUpdate,
      });
    },
  };
}

export const execTool = createExecTool();
