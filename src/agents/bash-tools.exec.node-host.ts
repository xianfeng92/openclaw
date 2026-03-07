import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import crypto from "node:crypto";
import type {
  ExecApprovalsFile,
  ExecAsk,
  ExecSecurity,
} from "../infra/exec-approvals.js";
import {
  evaluateShellAllowlist,
  maxAsk,
  minSecurity,
  requiresExecApproval,
  resolveExecApprovals,
  resolveExecApprovalsFromFile,
} from "../infra/exec-approvals.js";
import { detectCommandObfuscation } from "../infra/exec-obfuscation-detect.js";
import { buildNodeShellCommand } from "../infra/node-shell.js";
import { logInfo } from "../logger.js";
import {
  createApprovalSlug,
  emitExecSystemEvent,
  registerExecApprovalRequest,
  waitForExecApprovalDecision,
} from "./bash-tools.exec.approvals.js";
import { applyPathPrepend } from "./bash-tools.exec.compat.js";
import type {
  ExecGatewayCallTool,
  ExecListNodesTool,
  ExecResolveNodeIdFromListTool,
  ExecToolDetails,
  ExecToolParams,
} from "./bash-tools.exec.types.js";

type ExecuteNodeHostParams = {
  params: ExecToolParams;
  agentId?: string;
  security: ExecSecurity;
  ask: ExecAsk;
  workdir: string;
  env: Record<string, string>;
  warnings: string[];
  defaultPathPrepend: string[];
  defaultTimeoutSec: number;
  approvalRunningNoticeMs: number;
  approvalTimeoutMs: number;
  approvalRequestTimeoutMs: number;
  approvalSlugLength: number;
  boundNode?: string;
  sessionKey?: string;
  notifySessionKey?: string;
  gatewayCallTool: ExecGatewayCallTool;
  listNodesTool: ExecListNodesTool;
  resolveNodeIdFromListTool: ExecResolveNodeIdFromListTool;
};

export async function executeNodeExecHost(
  params: ExecuteNodeHostParams,
): Promise<AgentToolResult<ExecToolDetails>> {
  const approvals = resolveExecApprovals(params.agentId, {
    security: params.security,
    ask: params.ask,
  });
  const hostSecurity = minSecurity(params.security, approvals.agent.security);
  const hostAsk = maxAsk(params.ask, approvals.agent.ask);
  const askFallback = approvals.agent.askFallback;
  if (hostSecurity === "deny") {
    throw new Error("exec denied: host=node security=deny");
  }

  const requestedNode = params.params.node?.trim();
  if (params.boundNode && requestedNode && params.boundNode !== requestedNode) {
    throw new Error(`exec node not allowed (bound to ${params.boundNode})`);
  }

  const nodeQuery = params.boundNode || requestedNode;
  const nodes = await params.listNodesTool({});
  if (nodes.length === 0) {
    throw new Error(
      "exec host=node requires a paired node (none available). This requires a companion app or node host.",
    );
  }

  let nodeId: string;
  try {
    nodeId = params.resolveNodeIdFromListTool(nodes, nodeQuery, !nodeQuery);
  } catch (err) {
    if (!nodeQuery && String(err).includes("node required")) {
      throw new Error(
        "exec host=node requires a node id when multiple nodes are available (set tools.exec.node or exec.node).",
        { cause: err },
      );
    }
    throw err;
  }

  const nodeInfo = nodes.find((entry) => entry.nodeId === nodeId);
  const supportsSystemRun = Array.isArray(nodeInfo?.commands)
    ? nodeInfo.commands.includes("system.run")
    : false;
  if (!supportsSystemRun) {
    throw new Error(
      "exec host=node requires a node that supports system.run (companion app or node host).",
    );
  }

  const argv = buildNodeShellCommand(params.params.command, nodeInfo?.platform);
  const nodeEnv = params.params.env ? { ...params.params.env } : undefined;
  if (nodeEnv) {
    applyPathPrepend(nodeEnv, params.defaultPathPrepend, { requireExisting: true });
  }

  const baseAllowlistEval = evaluateShellAllowlist({
    command: params.params.command,
    allowlist: [],
    safeBins: new Set(),
    cwd: params.workdir,
    env: params.env,
    platform: nodeInfo?.platform,
  });
  let analysisOk = baseAllowlistEval.analysisOk;
  let allowlistSatisfied = false;

  if (hostAsk === "on-miss" && hostSecurity === "allowlist" && analysisOk) {
    try {
      const approvalsSnapshot = await params.gatewayCallTool<{ file: string }>(
        "exec.approvals.node.get",
        { timeoutMs: 10_000 },
        { nodeId },
      );
      const approvalsFile =
        approvalsSnapshot && typeof approvalsSnapshot === "object"
          ? approvalsSnapshot.file
          : undefined;
      if (approvalsFile && typeof approvalsFile === "object") {
        const resolved = resolveExecApprovalsFromFile({
          file: approvalsFile as ExecApprovalsFile,
          agentId: params.agentId,
          overrides: { security: "allowlist" },
        });
        const allowlistEval = evaluateShellAllowlist({
          command: params.params.command,
          allowlist: resolved.allowlist,
          safeBins: new Set(),
          cwd: params.workdir,
          env: params.env,
          platform: nodeInfo?.platform,
        });
        allowlistSatisfied = allowlistEval.allowlistSatisfied;
        analysisOk = allowlistEval.analysisOk;
      }
    } catch {
      // Fall back to requiring approval if node approvals cannot be fetched.
    }
  }

  const obfuscation = detectCommandObfuscation(params.params.command);
  if (obfuscation.detected) {
    logInfo(
      `exec: obfuscation detected (node=${nodeQuery ?? "default"}): ${obfuscation.reasons.join(", ")}`,
    );
    params.warnings.push(`⚠️ Obfuscated command detected: ${obfuscation.reasons.join("; ")}`);
  }

  const requiresAsk =
    requiresExecApproval({
      ask: hostAsk,
      security: hostSecurity,
      analysisOk,
      allowlistSatisfied,
    }) || obfuscation.detected;
  const commandText = params.params.command;
  const invokeTimeoutMs = Math.max(
    10_000,
    (typeof params.params.timeout === "number" ? params.params.timeout : params.defaultTimeoutSec) *
      1000 +
      5_000,
  );

  const buildInvokeParams = (
    approvedByAsk: boolean,
    approvalDecision: "allow-once" | "allow-always" | null,
    runId?: string,
  ) =>
    ({
      nodeId,
      command: "system.run",
      params: {
        command: argv,
        rawCommand: params.params.command,
        cwd: params.workdir,
        env: nodeEnv,
        timeoutMs:
          typeof params.params.timeout === "number" ? params.params.timeout * 1000 : undefined,
        agentId: params.agentId,
        sessionKey: params.sessionKey,
        approved: approvedByAsk,
        approvalDecision: approvalDecision ?? undefined,
        runId: runId ?? undefined,
      },
      idempotencyKey: crypto.randomUUID(),
    }) satisfies Record<string, unknown>;

  if (requiresAsk) {
    const approvalId = crypto.randomUUID();
    const approvalSlug = createApprovalSlug(approvalId, params.approvalSlugLength);
    const contextKey = `exec:${approvalId}`;
    const noticeSeconds = Math.max(1, Math.round(params.approvalRunningNoticeMs / 1000));
    const warningText = params.warnings.length ? `${params.warnings.join("\n")}\n\n` : "";
    let expiresAtMs = Date.now() + params.approvalTimeoutMs;
    let preResolvedDecision: string | null | undefined;

    try {
      const registration = await registerExecApprovalRequest({
        callGatewayTool: params.gatewayCallTool,
        id: approvalId,
        command: commandText,
        cwd: params.workdir,
        host: "node",
        nodeId,
        security: hostSecurity,
        ask: hostAsk,
        agentId: params.agentId,
        sessionKey: params.sessionKey,
        approvalTimeoutMs: params.approvalTimeoutMs,
        requestTimeoutMs: params.approvalRequestTimeoutMs,
      });
      expiresAtMs = registration.expiresAtMs;
      preResolvedDecision = registration.finalDecision;
    } catch (err) {
      throw new Error(`Exec approval registration failed: ${String(err)}`, { cause: err });
    }

    void (async () => {
      let decision: string | null = preResolvedDecision ?? null;
      try {
        if (preResolvedDecision === undefined) {
          decision = await waitForExecApprovalDecision(
            approvalId,
            params.approvalRequestTimeoutMs,
            params.gatewayCallTool,
          );
        }
      } catch {
        emitExecSystemEvent(
          `Exec denied (node=${nodeId} id=${approvalId}, approval-request-failed): ${commandText}`,
          { sessionKey: params.notifySessionKey, contextKey },
        );
        return;
      }

      let approvedByAsk = false;
      let approvalDecision: "allow-once" | "allow-always" | null = null;
      let deniedReason: string | null = null;

      if (decision === "deny") {
        deniedReason = "user-denied";
      } else if (!decision) {
        if (obfuscation.detected) {
          deniedReason = "approval-timeout (obfuscation-detected)";
        } else if (askFallback === "full") {
          approvedByAsk = true;
          approvalDecision = "allow-once";
        } else if (askFallback === "allowlist") {
          // Defer allowlist enforcement to the node host.
        } else {
          deniedReason = "approval-timeout";
        }
      } else if (decision === "allow-once") {
        approvedByAsk = true;
        approvalDecision = "allow-once";
      } else if (decision === "allow-always") {
        approvedByAsk = true;
        approvalDecision = "allow-always";
      }

      if (deniedReason) {
        emitExecSystemEvent(`Exec denied (node=${nodeId} id=${approvalId}, ${deniedReason}): ${commandText}`, {
          sessionKey: params.notifySessionKey,
          contextKey,
        });
        return;
      }

      let runningTimer: NodeJS.Timeout | null = null;
      if (params.approvalRunningNoticeMs > 0) {
        runningTimer = setTimeout(() => {
          emitExecSystemEvent(
            `Exec running (node=${nodeId} id=${approvalId}, >${noticeSeconds}s): ${commandText}`,
            { sessionKey: params.notifySessionKey, contextKey },
          );
        }, params.approvalRunningNoticeMs);
      }

      try {
        await params.gatewayCallTool(
          "node.invoke",
          { timeoutMs: invokeTimeoutMs },
          buildInvokeParams(approvedByAsk, approvalDecision, approvalId),
        );
      } catch {
        emitExecSystemEvent(`Exec denied (node=${nodeId} id=${approvalId}, invoke-failed): ${commandText}`, {
          sessionKey: params.notifySessionKey,
          contextKey,
        });
      } finally {
        if (runningTimer) {
          clearTimeout(runningTimer);
        }
      }
    })();

    return {
      content: [
        {
          type: "text",
          text:
            `${warningText}Approval required (id ${approvalSlug}). ` +
            "Approve to run; updates will arrive after completion.",
        },
      ],
      details: {
        status: "approval-pending",
        approvalId,
        approvalSlug,
        expiresAtMs,
        host: "node",
        command: commandText,
        cwd: params.workdir,
        nodeId,
      },
    };
  }

  const startedAt = Date.now();
  const raw = await params.gatewayCallTool(
    "node.invoke",
    { timeoutMs: invokeTimeoutMs },
    buildInvokeParams(false, null),
  );
  const payload = raw && typeof raw === "object" ? (raw as { payload?: unknown }).payload : undefined;
  const payloadObj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const stdout = typeof payloadObj.stdout === "string" ? payloadObj.stdout : "";
  const stderr = typeof payloadObj.stderr === "string" ? payloadObj.stderr : "";
  const errorText = typeof payloadObj.error === "string" ? payloadObj.error : "";
  const success = typeof payloadObj.success === "boolean" ? payloadObj.success : false;
  const exitCode = typeof payloadObj.exitCode === "number" ? payloadObj.exitCode : null;

  return {
    content: [
      {
        type: "text",
        text: stdout || stderr || errorText || "",
      },
    ],
    details: {
      status: success ? "completed" : "failed",
      exitCode,
      durationMs: Date.now() - startedAt,
      aggregated: [stdout, stderr, errorText].filter(Boolean).join("\n"),
      cwd: params.workdir,
    } satisfies ExecToolDetails,
  };
}
