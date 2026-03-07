import type { BashSandboxConfig } from "./bash-tools.shared.js";
import type { ExecAsk, ExecHost, ExecSecurity } from "../infra/exec-approvals.js";

export type ExecGatewayCallTool = typeof import("./tools/gateway.js").callGatewayTool;
export type ExecListNodesTool = typeof import("./tools/nodes-utils.js").listNodes;
export type ExecResolveNodeIdFromListTool =
  typeof import("./tools/nodes-utils.js").resolveNodeIdFromList;

export type ExecElevatedDefaults = {
  enabled: boolean;
  allowed: boolean;
  defaultLevel: "on" | "off" | "ask" | "full";
};

export type ExecToolDefaults = {
  host?: ExecHost;
  security?: ExecSecurity;
  ask?: ExecAsk;
  gatewayCallTool?: ExecGatewayCallTool;
  listNodesTool?: ExecListNodesTool;
  resolveNodeIdFromListTool?: ExecResolveNodeIdFromListTool;
  node?: string;
  pathPrepend?: string[];
  safeBins?: string[];
  safeBinTrustedDirs?: string[];
  agentId?: string;
  backgroundMs?: number;
  timeoutSec?: number;
  approvalRunningNoticeMs?: number;
  sandbox?: BashSandboxConfig;
  elevated?: ExecElevatedDefaults;
  allowBackground?: boolean;
  scopeKey?: string;
  sessionKey?: string;
  messageProvider?: string;
  notifyOnExit?: boolean;
  cwd?: string;
};

export type ExecToolParams = {
  command: string;
  workdir?: string;
  env?: Record<string, string>;
  yieldMs?: number;
  background?: boolean;
  timeout?: number;
  pty?: boolean;
  elevated?: boolean;
  host?: string;
  security?: string;
  ask?: string;
  node?: string;
};

export type ExecToolDetails =
  | {
      status: "running";
      sessionId: string;
      pid?: number;
      startedAt: number;
      cwd?: string;
      tail?: string;
    }
  | {
      status: "completed" | "failed";
      exitCode: number | null;
      durationMs: number;
      aggregated: string;
      cwd?: string;
    }
  | {
      status: "approval-pending";
      approvalId: string;
      approvalSlug: string;
      expiresAtMs: number;
      host: ExecHost;
      command: string;
      cwd?: string;
      nodeId?: string;
    };
