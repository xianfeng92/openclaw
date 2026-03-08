import { ipcMain } from "electron";
import {
  appendTerminalAuditRecord,
  type TerminalHighRiskAuditRecord,
} from "./terminal-audit-log.js";

export function registerTerminalAuditIpcHandlers(): void {
  ipcMain.handle(
    "terminal:audit-high-risk",
    async (_event, record: TerminalHighRiskAuditRecord) => {
      if (!record || typeof record !== "object") {
        return {
          success: false,
          error: "Audit record is required",
        };
      }
      return appendTerminalAuditRecord(record);
    },
  );
}
