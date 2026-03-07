import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import crypto from "node:crypto";
import type { ExecAsk, ExecSecurity } from "../infra/exec-approvals.js";
import {
  addAllowlistEntry,
  evaluateShellAllowlist,
  maxAsk,
  minSecurity,
  recordAllowlistUse,
  requiresExecApproval,
  resolveAllowAlwaysPatterns,
  resolveExecApprovals,
} from "../infra/exec-approvals.js";
import { detectCommandObfuscation } from "../infra/exec-obfuscation-detect.js";
import { logInfo } from "../logger.js";
import { markBackgrounded, tail } from "./bash-process-registry.js";
import {
  createApprovalSlug,
  emitExecSystemEvent,
  registerExecApprovalRequest,
  waitForExecApprovalDecision,
} from "./bash-tools.exec.approvals.js";
import { normalizeNotifyOutput } from "./bash-tools.exec.compat.js";
import { runExecProcess } from "./bash-tools.exec.process.js";
import type {
  ExecGatewayCallTool,
  ExecToolDetails,
  ExecToolParams,
} from "./bash-tools.exec.types.js";

type ExecuteGatewayHostParams = {
  params: ExecToolParams;
  agentId?: string;
  security: ExecSecurity;
  ask: ExecAsk;
  workdir: string;
  env: Record<string, string>;
  warnings: string[];
  safeBins: Set<string>;
  trustedSafeBinDirs: ReadonlySet<string>;
  defaultTimeoutSec: number;
  approvalRunningNoticeMs: number;
  approvalTimeoutMs: number;
  approvalRequestTimeoutMs: number;
  approvalSlugLength: number;
  notifyTailChars: number;
  commandForLocalShell: string;
  usePty: boolean;
  maxOutput: number;
  pendingMaxOutput: number;
  scopeKey?: string;
  sessionKey?: string;
  notifySessionKey?: string;
  gatewayCallTool: ExecGatewayCallTool;
};

export async function maybeExecuteGatewayHost(
  params: ExecuteGatewayHostParams,
): Promise<AgentToolResult<ExecToolDetails> | null> {
  const approvals = resolveExecApprovals(params.agentId, {
    security: params.security,
    ask: params.ask,
  });
  const hostSecurity = minSecurity(params.security, approvals.agent.security);
  const hostAsk = maxAsk(params.ask, approvals.agent.ask);
  const askFallback = approvals.agent.askFallback;
  if (hostSecurity === "deny") {
    throw new Error("exec denied: host=gateway security=deny");
  }

  const allowlistEval = evaluateShellAllowlist({
    command: params.params.command,
    allowlist: approvals.allowlist,
    safeBins: params.safeBins,
    trustedSafeBinDirs: params.trustedSafeBinDirs,
    cwd: params.workdir,
    env: params.env,
    platform: process.platform,
  });
  const allowlistMatches = allowlistEval.allowlistMatches;
  const analysisOk = allowlistEval.analysisOk;
  const allowlistSatisfied =
    hostSecurity === "allowlist" && analysisOk ? allowlistEval.allowlistSatisfied : false;
  const obfuscation = detectCommandObfuscation(params.params.command);
  if (obfuscation.detected) {
    logInfo(`exec: obfuscation detected (gateway): ${obfuscation.reasons.join(", ")}`);
    params.warnings.push(`⚠️ Obfuscated command detected: ${obfuscation.reasons.join("; ")}`);
  }

  const requiresAsk =
    requiresExecApproval({
      ask: hostAsk,
      security: hostSecurity,
      analysisOk,
      allowlistSatisfied,
    }) || obfuscation.detected;

  if (requiresAsk) {
    const approvalId = crypto.randomUUID();
    const approvalSlug = createApprovalSlug(approvalId, params.approvalSlugLength);
    const contextKey = `exec:${approvalId}`;
    const resolvedPath = allowlistEval.segments[0]?.resolution?.resolvedPath;
    const noticeSeconds = Math.max(1, Math.round(params.approvalRunningNoticeMs / 1000));
    const commandText = params.params.command;
    const effectiveTimeout =
      typeof params.params.timeout === "number" ? params.params.timeout : params.defaultTimeoutSec;
    const warningText = params.warnings.length ? `${params.warnings.join("\n")}\n\n` : "";
    let expiresAtMs = Date.now() + params.approvalTimeoutMs;
    let preResolvedDecision: string | null | undefined;

    try {
      const registration = await registerExecApprovalRequest({
        callGatewayTool: params.gatewayCallTool,
        id: approvalId,
        command: commandText,
        cwd: params.workdir,
        host: "gateway",
        security: hostSecurity,
        ask: hostAsk,
        agentId: params.agentId,
        resolvedPath,
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
        emitExecSystemEvent(`Exec denied (gateway id=${approvalId}, approval-request-failed): ${commandText}`, {
          sessionKey: params.notifySessionKey,
          contextKey,
        });
        return;
      }

      let approvedByAsk = false;
      let deniedReason: string | null = null;

      if (decision === "deny") {
        deniedReason = "user-denied";
      } else if (!decision) {
        if (obfuscation.detected) {
          deniedReason = "approval-timeout (obfuscation-detected)";
        } else if (askFallback === "full") {
          approvedByAsk = true;
        } else if (askFallback === "allowlist") {
          if (!analysisOk || !allowlistSatisfied) {
            deniedReason = "approval-timeout (allowlist-miss)";
          } else {
            approvedByAsk = true;
          }
        } else {
          deniedReason = "approval-timeout";
        }
      } else if (decision === "allow-once") {
        approvedByAsk = true;
      } else if (decision === "allow-always") {
        approvedByAsk = true;
        if (hostSecurity === "allowlist") {
          const patterns = resolveAllowAlwaysPatterns({
            segments: allowlistEval.segments,
            cwd: params.workdir,
            env: params.env,
            platform: process.platform,
          });
          for (const pattern of patterns) {
            addAllowlistEntry(approvals.file, params.agentId, pattern);
          }
        }
      }

      if (hostSecurity === "allowlist" && (!analysisOk || !allowlistSatisfied) && !approvedByAsk) {
        deniedReason = deniedReason ?? "allowlist-miss";
      }

      if (deniedReason) {
        emitExecSystemEvent(`Exec denied (gateway id=${approvalId}, ${deniedReason}): ${commandText}`, {
          sessionKey: params.notifySessionKey,
          contextKey,
        });
        return;
      }

      if (allowlistMatches.length > 0) {
        const seen = new Set<string>();
        for (const match of allowlistMatches) {
          if (seen.has(match.pattern)) {
            continue;
          }
          seen.add(match.pattern);
          recordAllowlistUse(
            approvals.file,
            params.agentId,
            match,
            commandText,
            resolvedPath ?? undefined,
          );
        }
      }

      let run;
      try {
        run = await runExecProcess({
          command: params.commandForLocalShell,
          workdir: params.workdir,
          env: params.env,
          sandbox: undefined,
          containerWorkdir: null,
          usePty: params.usePty,
          warnings: params.warnings,
          maxOutput: params.maxOutput,
          pendingMaxOutput: params.pendingMaxOutput,
          notifyOnExit: false,
          scopeKey: params.scopeKey,
          sessionKey: params.notifySessionKey,
          timeoutSec: effectiveTimeout,
          notifyTailChars: params.notifyTailChars,
        });
      } catch {
        emitExecSystemEvent(`Exec denied (gateway id=${approvalId}, spawn-failed): ${commandText}`, {
          sessionKey: params.notifySessionKey,
          contextKey,
        });
        return;
      }

      markBackgrounded(run.session);

      let runningTimer: NodeJS.Timeout | null = null;
      if (params.approvalRunningNoticeMs > 0) {
        runningTimer = setTimeout(() => {
          emitExecSystemEvent(
            `Exec running (gateway id=${approvalId}, session=${run?.session.id}, >${noticeSeconds}s): ${commandText}`,
            { sessionKey: params.notifySessionKey, contextKey },
          );
        }, params.approvalRunningNoticeMs);
      }

      const outcome = await run.promise;
      if (runningTimer) {
        clearTimeout(runningTimer);
      }
      const output = normalizeNotifyOutput(tail(outcome.aggregated || "", params.notifyTailChars));
      const exitLabel = outcome.timedOut ? "timeout" : `code ${outcome.exitCode ?? "?"}`;
      const summary = output
        ? `Exec finished (gateway id=${approvalId}, session=${run.session.id}, ${exitLabel})\n${output}`
        : `Exec finished (gateway id=${approvalId}, session=${run.session.id}, ${exitLabel})`;
      emitExecSystemEvent(summary, { sessionKey: params.notifySessionKey, contextKey });
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
        host: "gateway",
        command: commandText,
        cwd: params.workdir,
      },
    };
  }

  if (hostSecurity === "allowlist" && (!analysisOk || !allowlistSatisfied)) {
    throw new Error("exec denied: allowlist miss");
  }

  if (allowlistMatches.length > 0) {
    const seen = new Set<string>();
    for (const match of allowlistMatches) {
      if (seen.has(match.pattern)) {
        continue;
      }
      seen.add(match.pattern);
      recordAllowlistUse(
        approvals.file,
        params.agentId,
        match,
        params.params.command,
        allowlistEval.segments[0]?.resolution?.resolvedPath,
      );
    }
  }

  return null;
}
