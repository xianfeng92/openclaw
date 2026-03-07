import crypto from "node:crypto";
import net from "node:net";
import { DEFAULT_AGENT_ID } from "../routing/session-key.js";
import {
  resolveExecApprovalsPath,
  resolveExecApprovalsSocketPath,
  saveExecApprovals,
} from "./exec-approvals.store.js";
import type {
  ExecApprovalDecision,
  ExecApprovalRequest,
  ExecApprovalResolved,
  ExecApprovalsAgent,
  ExecApprovalsDefaultOverrides,
  ExecApprovalsDefaults,
  ExecApprovalsFile,
  ExecApprovalsResolved,
  ExecApprovalsSnapshot,
  ExecAsk,
  ExecAllowlistEntry,
  ExecHost,
  ExecSecurity,
} from "./exec-approvals.store.js";

export type {
  ExecApprovalDecision,
  ExecApprovalRequest,
  ExecApprovalResolved,
  ExecApprovalsAgent,
  ExecApprovalsDefaultOverrides,
  ExecApprovalsDefaults,
  ExecApprovalsFile,
  ExecApprovalsResolved,
  ExecApprovalsSnapshot,
  ExecAsk,
  ExecAllowlistEntry,
  ExecHost,
  ExecSecurity,
} from "./exec-approvals.store.js";
export {
  ensureExecApprovals,
  loadExecApprovals,
  normalizeExecApprovals,
  readExecApprovalsSnapshot,
  resolveExecApprovals,
  resolveExecApprovalsFromFile,
  resolveExecApprovalsPath,
  resolveExecApprovalsSocketPath,
  saveExecApprovals,
} from "./exec-approvals.store.js";

export * from "./exec-approvals.analysis.js";
export function requiresExecApproval(params: {
  ask: ExecAsk;
  security: ExecSecurity;
  analysisOk: boolean;
  allowlistSatisfied: boolean;
}): boolean {
  return (
    params.ask === "always" ||
    (params.ask === "on-miss" &&
      params.security === "allowlist" &&
      (!params.analysisOk || !params.allowlistSatisfied))
  );
}

export function recordAllowlistUse(
  approvals: ExecApprovalsFile,
  agentId: string | undefined,
  entry: ExecAllowlistEntry,
  command: string,
  resolvedPath?: string,
) {
  const target = agentId ?? DEFAULT_AGENT_ID;
  const agents = approvals.agents ?? {};
  const existing = agents[target] ?? {};
  const allowlist = Array.isArray(existing.allowlist) ? existing.allowlist : [];
  const nextAllowlist = allowlist.map((item) =>
    item.pattern === entry.pattern
      ? {
          ...item,
          id: item.id ?? crypto.randomUUID(),
          lastUsedAt: Date.now(),
          lastUsedCommand: command,
          lastResolvedPath: resolvedPath,
        }
      : item,
  );
  agents[target] = { ...existing, allowlist: nextAllowlist };
  approvals.agents = agents;
  saveExecApprovals(approvals);
}

export function addAllowlistEntry(
  approvals: ExecApprovalsFile,
  agentId: string | undefined,
  pattern: string,
) {
  const target = agentId ?? DEFAULT_AGENT_ID;
  const agents = approvals.agents ?? {};
  const existing = agents[target] ?? {};
  const allowlist = Array.isArray(existing.allowlist) ? existing.allowlist : [];
  const trimmed = pattern.trim();
  if (!trimmed) {
    return;
  }
  if (allowlist.some((entry) => entry.pattern === trimmed)) {
    return;
  }
  allowlist.push({ id: crypto.randomUUID(), pattern: trimmed, lastUsedAt: Date.now() });
  agents[target] = { ...existing, allowlist };
  approvals.agents = agents;
  saveExecApprovals(approvals);
}

export function minSecurity(a: ExecSecurity, b: ExecSecurity): ExecSecurity {
  const order: Record<ExecSecurity, number> = { deny: 0, allowlist: 1, full: 2 };
  return order[a] <= order[b] ? a : b;
}

export function maxAsk(a: ExecAsk, b: ExecAsk): ExecAsk {
  const order: Record<ExecAsk, number> = { off: 0, "on-miss": 1, always: 2 };
  return order[a] >= order[b] ? a : b;
}

export async function requestExecApprovalViaSocket(params: {
  socketPath: string;
  token: string;
  request: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<ExecApprovalDecision | null> {
  const { socketPath, token, request } = params;
  if (!socketPath || !token) {
    return null;
  }
  const timeoutMs = params.timeoutMs ?? 15_000;
  return await new Promise((resolve) => {
    const client = new net.Socket();
    let settled = false;
    let buffer = "";
    const finish = (value: ExecApprovalDecision | null) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        client.destroy();
      } catch {
        // ignore
      }
      resolve(value);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);
    const payload = JSON.stringify({
      type: "request",
      token,
      id: crypto.randomUUID(),
      request,
    });

    client.on("error", () => finish(null));
    client.connect(socketPath, () => {
      client.write(`${payload}\n`);
    });
    client.on("data", (data) => {
      buffer += data.toString("utf8");
      let idx = buffer.indexOf("\n");
      while (idx !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        idx = buffer.indexOf("\n");
        if (!line) {
          continue;
        }
        try {
          const msg = JSON.parse(line) as { type?: string; decision?: ExecApprovalDecision };
          if (msg?.type === "decision" && msg.decision) {
            clearTimeout(timer);
            finish(msg.decision);
            return;
          }
        } catch {
          // ignore
        }
      }
    });
  });
}
