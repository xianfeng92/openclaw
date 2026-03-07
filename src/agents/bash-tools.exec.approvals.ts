import type { ExecAsk, ExecSecurity } from "../infra/exec-approvals.js";
import { requestHeartbeatNow } from "../infra/heartbeat-wake.js";
import { enqueueSystemEvent } from "../infra/system-events.js";

type GatewayToolCaller = <T = Record<string, unknown>>(
  method: string,
  opts: { timeoutMs: number },
  params?: unknown,
  extra?: { expectFinal?: boolean },
) => Promise<T>;

export type ExecApprovalRegistration = {
  id: string;
  expiresAtMs: number;
  finalDecision?: string | null;
};

type ParsedApprovalDecision = { present: boolean; value: string | null };

function parseApprovalDecision(value: unknown): ParsedApprovalDecision {
  if (!value || typeof value !== "object") {
    return { present: false, value: null };
  }
  if (!Object.hasOwn(value, "decision")) {
    return { present: false, value: null };
  }
  const decision = (value as { decision?: unknown }).decision;
  return { present: true, value: typeof decision === "string" ? decision : null };
}

function parseApprovalId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseApprovalExpiresAtMs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function createApprovalSlug(id: string, slugLength: number) {
  return id.slice(0, slugLength);
}

export function resolveApprovalRunningNoticeMs(value: number | undefined, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  if (value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

export async function registerExecApprovalRequest(params: {
  callGatewayTool: GatewayToolCaller;
  id: string;
  command: string;
  cwd: string;
  nodeId?: string;
  host: "gateway" | "node";
  security: ExecSecurity;
  ask: ExecAsk;
  agentId?: string;
  resolvedPath?: string;
  sessionKey?: string;
  approvalTimeoutMs: number;
  requestTimeoutMs: number;
}): Promise<ExecApprovalRegistration> {
  const registrationResult = await params.callGatewayTool<{
    id?: string;
    expiresAtMs?: number;
    decision?: string;
  }>(
    "exec.approval.request",
    { timeoutMs: params.requestTimeoutMs },
    {
      id: params.id,
      command: params.command,
      cwd: params.cwd,
      nodeId: params.nodeId,
      host: params.host,
      security: params.security,
      ask: params.ask,
      agentId: params.agentId,
      resolvedPath: params.resolvedPath,
      sessionKey: params.sessionKey,
      timeoutMs: params.approvalTimeoutMs,
      twoPhase: true,
    },
    { expectFinal: false },
  );
  const decision = parseApprovalDecision(registrationResult);
  const id = parseApprovalId(registrationResult?.id) ?? params.id;
  const expiresAtMs =
    parseApprovalExpiresAtMs(registrationResult?.expiresAtMs) ??
    Date.now() + params.approvalTimeoutMs;
  if (decision.present) {
    return { id, expiresAtMs, finalDecision: decision.value };
  }
  return { id, expiresAtMs };
}

export async function waitForExecApprovalDecision(
  id: string,
  requestTimeoutMs: number,
  callGatewayTool: GatewayToolCaller,
): Promise<string | null> {
  try {
    const decisionResult = await callGatewayTool<{ decision: string }>(
      "exec.approval.waitDecision",
      { timeoutMs: requestTimeoutMs },
      { id },
    );
    return parseApprovalDecision(decisionResult).value;
  } catch (err) {
    const message = String(err).toLowerCase();
    if (message.includes("approval expired or not found")) {
      return null;
    }
    throw err;
  }
}

export function emitExecSystemEvent(text: string, opts: { sessionKey?: string; contextKey?: string }) {
  const sessionKey = opts.sessionKey?.trim();
  if (!sessionKey) {
    return;
  }
  enqueueSystemEvent(text, { sessionKey, contextKey: opts.contextKey });
  requestHeartbeatNow({ reason: "exec-event" });
}
