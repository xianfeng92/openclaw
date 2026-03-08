import fs from "node:fs";
import path from "node:path";
import { resolveCyDeckStateDir } from "./cydeck-config.js";

export type TerminalHighRiskAuditPhase =
  | "queued"
  | "armed"
  | "confirmed"
  | "cancelled"
  | "expired"
  | "completed"
  | "failed";

export type TerminalHighRiskAuditRecord = {
  actionType: string;
  commandPreview: string;
  riskSummary: string;
  secondSummary?: string;
  phase: TerminalHighRiskAuditPhase;
  sessionKey?: string;
  agent?: string;
  metadata?: Record<string, unknown>;
};

type PersistedTerminalHighRiskAuditRecord = TerminalHighRiskAuditRecord & {
  ts: string;
  tsMs: number;
};

const AUDIT_DIRNAME = "audit";
const AUDIT_FILENAME = "high-risk-actions.jsonl";

export function resolveTerminalAuditLogPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveCyDeckStateDir(env), AUDIT_DIRNAME, AUDIT_FILENAME);
}

export function appendTerminalAuditRecord(
  record: TerminalHighRiskAuditRecord,
  env: NodeJS.ProcessEnv = process.env,
): { success: true; auditPath: string } | { success: false; auditPath: string; error: string } {
  const auditPath = resolveTerminalAuditLogPath(env);
  const payload: PersistedTerminalHighRiskAuditRecord = {
    ...record,
    ts: new Date().toISOString(),
    tsMs: Date.now(),
  };

  try {
    fs.mkdirSync(path.dirname(auditPath), { recursive: true });
    fs.appendFileSync(auditPath, `${JSON.stringify(payload)}\n`, "utf-8");
    return { success: true, auditPath };
  } catch (err) {
    return {
      success: false,
      auditPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
