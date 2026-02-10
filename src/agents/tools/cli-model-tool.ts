import { Type } from "@sinclair/typebox";
import { execFile, type ExecException, type ExecFileOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { OpenClawConfig } from "../../config/config.js";
import {
  addAllowlistEntry,
  analyzeArgvCommand,
  evaluateExecAllowlist,
  maxAsk,
  minSecurity,
  recordAllowlistUse,
  requiresExecApproval,
  resolveExecApprovals,
  resolveSafeBins,
} from "../../infra/exec-approvals.js";
import { requestHeartbeatNow } from "../../infra/heartbeat-wake.js";
import { enqueueSystemEvent } from "../../infra/system-events.js";
import { parseAgentSessionKey, resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import { stringEnum } from "../schema/typebox.js";
import type { AnyAgentTool } from "./common.js";
import { callGatewayTool } from "./gateway.js";

function execFileText(
  file: string,
  args: string[],
  options: ExecFileOptions,
): Promise<{ stdout: string; stderr: string }> {
  const toText = (value: string | Buffer) => (typeof value === "string" ? value : value.toString());
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        (error as ExecException & { stdout?: unknown; stderr?: unknown }).stdout = stdout;
        (error as ExecException & { stdout?: unknown; stderr?: unknown }).stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout: toText(stdout), stderr: toText(stderr) });
    });
  });
}

const APPROVAL_SLUG_LENGTH = 8;
const DEFAULT_APPROVAL_TIMEOUT_MS = 120_000;
const DEFAULT_APPROVAL_REQUEST_TIMEOUT_MS = 130_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BUFFER_BYTES = 512_000;
const DEFAULT_MAX_OUTPUT_CHARS = 50_000;

const CLI_MODEL_ACTIONS = [
  "claude",
  "gpt",
] as const;

const CliModelToolSchema = Type.Object({
  action: stringEnum(CLI_MODEL_ACTIONS),
  prompt: Type.String(),
});

/**
 * CLI Model Tool - 允许 Agent 调用本地命令行 AI 工具
 *
 * 使用场景：
 * - 你有 claude 命令行工具但没有 API Key
 * - 你有 gpt 命令行工具但没有 API Key
 * - 想用本地工具替代昂贵的 API 调用
 *
 * 前置条件：
 * - 确保 claude 或 gpt 命令在 PATH 中可用
 * - 在 PowerShell 中测试：claude "hello"
 */
export function createCliModelTool(opts?: {
  agentSessionKey?: string;
  config?: OpenClawConfig;
}): AnyAgentTool {
  const createApprovalSlug = (id: string) => id.slice(0, APPROVAL_SLUG_LENGTH);
  const sessionKey = opts?.agentSessionKey?.trim() || undefined;
  // Derive agentId only when the session key is explicitly an agent session key.
  const parsedAgentSession = parseAgentSessionKey(sessionKey);
  const agentId = parsedAgentSession ? resolveAgentIdFromSessionKey(sessionKey) : undefined;
  const execCfg = opts?.config?.tools?.exec;
  const configuredSecurity = execCfg?.security ?? "allowlist";
  const configuredAsk = execCfg?.ask ?? "on-miss";

  const truncateOutput = (text: string) => {
    const cleaned = text.trim();
    if (cleaned.length <= DEFAULT_MAX_OUTPUT_CHARS) {
      return { text: cleaned, truncated: false };
    }
    return { text: cleaned.slice(0, DEFAULT_MAX_OUTPUT_CHARS).trimEnd(), truncated: true };
  };

  const runCliBinary = async (
    command: string,
    prompt: string,
  ): Promise<{
    stdout: string;
    stderr: string;
    errorMessage: string | null;
    truncatedByMaxBuffer: boolean;
  }> => {
    const candidates =
      process.platform === "win32" && !command.includes(".")
        ? [command, `${command}.cmd`]
        : [command];
    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        const res = await execFileText(candidate, [prompt], {
          timeout: DEFAULT_TIMEOUT_MS,
          maxBuffer: DEFAULT_MAX_BUFFER_BYTES,
          windowsHide: true,
          encoding: "utf8",
        });
        return { stdout: res.stdout, stderr: res.stderr, errorMessage: null, truncatedByMaxBuffer: false };
      } catch (err) {
        lastError = err;
        const code =
          err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : "";
        if (code === "ENOENT") {
          continue;
        }
        const errObj = err as ExecException & { stdout?: unknown; stderr?: unknown };
        const stdout = typeof errObj.stdout === "string" ? errObj.stdout : "";
        const stderr = typeof errObj.stderr === "string" ? errObj.stderr : "";
        const truncatedByMaxBuffer = code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
        // Non-zero exit/timeout/maxBuffer should still return whatever output we captured.
        return {
          stdout,
          stderr,
          errorMessage: err instanceof Error ? err.message : String(err),
          truncatedByMaxBuffer,
        };
      }
    }
    const message = lastError instanceof Error ? lastError.message : lastError ? String(lastError) : "ENOENT";
    return { stdout: "", stderr: "", errorMessage: message, truncatedByMaxBuffer: false };
  };

  return {
    label: "CLI Model",
    name: "cli_model",
    description:
      "Call local CLI AI tools (claude, gpt) when API keys are not available. " +
      "Actions: 'claude' for Claude CLI, 'gpt' for GPT CLI. " +
      "Use this when you need Claude/GPT capabilities but only have Gemini API key configured.",
    parameters: CliModelToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = params.action as string;
      const prompt = params.prompt as string;

      if (!action || !prompt) {
        return {
          content: [
            {
              type: "text",
              text: "Error: action and prompt are required",
            },
          ],
          details: { error: "Missing parameters" },
        };
      }

      const command = action === "claude" ? "claude" : action === "gpt" ? "gpt" : null;
      if (!command) {
        return {
          content: [
            {
              type: "text",
              text: `Error: unknown action "${action}". Supported actions: claude, gpt`,
            },
          ],
          details: { error: `Unknown action: ${action}` },
        };
      }

      try {
        const approvals = resolveExecApprovals(agentId, {
          security: configuredSecurity,
          ask: configuredAsk,
        });
        const hostSecurity = minSecurity(configuredSecurity, approvals.agent.security);
        const hostAsk = maxAsk(configuredAsk, approvals.agent.ask);
        const askFallback = approvals.agent.askFallback;
        if (hostSecurity === "deny") {
          return {
            content: [{ type: "text", text: "Error: cli_model denied (tools.exec.security=deny)" }],
            details: { error: "Denied by exec policy" },
          };
        }

        // Evaluate allowlist for the binary only (prompt is argv data, not a shell command).
        const allowlistAnalysis = analyzeArgvCommand({ argv: [command], env: process.env });
        const safeBins = resolveSafeBins(execCfg?.safeBins);
        const allowlistEval = evaluateExecAllowlist({
          analysis: allowlistAnalysis,
          allowlist: approvals.allowlist,
          safeBins,
        });
        const analysisOk = allowlistAnalysis.ok;
        const allowlistSatisfied =
          hostSecurity === "allowlist" && analysisOk ? allowlistEval.allowlistSatisfied : false;
        const requiresAsk = requiresExecApproval({
          ask: hostAsk,
          security: hostSecurity,
          analysisOk,
          allowlistSatisfied,
        });

        const resolvedPath = allowlistAnalysis.segments[0]?.resolution?.resolvedPath;

        const recordMatches = () => {
          if (allowlistEval.allowlistMatches.length === 0) {
            return;
          }
          const seen = new Set<string>();
          for (const match of allowlistEval.allowlistMatches) {
            if (seen.has(match.pattern)) {
              continue;
            }
            seen.add(match.pattern);
            recordAllowlistUse(approvals.file, agentId, match, command, resolvedPath ?? undefined);
          }
        };

        if (requiresAsk) {
          if (!sessionKey) {
            return {
              content: [{ type: "text", text: "Error: cli_model approval requires a sessionKey" }],
              details: { error: "Missing sessionKey" },
            };
          }
          const approvalId = randomUUID();
          const approvalSlug = createApprovalSlug(approvalId);
          const expiresAtMs = Date.now() + DEFAULT_APPROVAL_TIMEOUT_MS;
          const contextKey = `cli_model:${approvalId}`;

          void (async () => {
            let decision: string | null = null;
            try {
              const decisionResult = await callGatewayTool<{ decision: string }>(
                "exec.approval.request",
                { timeoutMs: DEFAULT_APPROVAL_REQUEST_TIMEOUT_MS },
                {
                  id: approvalId,
                  command,
                  cwd: process.cwd(),
                  host: "gateway",
                  security: hostSecurity,
                  ask: hostAsk,
                  agentId,
                  resolvedPath: resolvedPath ?? null,
                  sessionKey,
                  timeoutMs: DEFAULT_APPROVAL_TIMEOUT_MS,
                },
              );
              const decisionValue =
                decisionResult && typeof decisionResult === "object"
                  ? (decisionResult as { decision?: unknown }).decision
                  : undefined;
              decision = typeof decisionValue === "string" ? decisionValue : null;
            } catch {
              enqueueSystemEvent(
                `cli_model denied (gateway id=${approvalId}, approval-request-failed): ${command}`,
                { sessionKey, contextKey },
              );
              requestHeartbeatNow({ reason: "cli-model-approval" });
              return;
            }

            let approvedByAsk = false;
            let deniedReason: string | null = null;
            let approvalDecision: "allow-once" | "allow-always" | null = null;

            if (decision === "deny") {
              deniedReason = "user-denied";
            } else if (!decision) {
              if (askFallback === "full") {
                approvedByAsk = true;
                approvalDecision = "allow-once";
              } else if (askFallback === "allowlist") {
                if (!analysisOk || !allowlistSatisfied) {
                  deniedReason = "approval-timeout (allowlist-miss)";
                } else {
                  approvedByAsk = true;
                  approvalDecision = "allow-once";
                }
              } else {
                deniedReason = "approval-timeout";
              }
            } else if (decision === "allow-once") {
              approvedByAsk = true;
              approvalDecision = "allow-once";
            } else if (decision === "allow-always") {
              approvedByAsk = true;
              approvalDecision = "allow-always";
              if (hostSecurity === "allowlist" && resolvedPath) {
                addAllowlistEntry(approvals.file, agentId, resolvedPath);
              }
            }

            if (
              hostSecurity === "allowlist" &&
              (!analysisOk || !allowlistSatisfied) &&
              !approvedByAsk
            ) {
              deniedReason = deniedReason ?? "allowlist-miss";
            }
            if (deniedReason) {
              enqueueSystemEvent(
                `cli_model denied (gateway id=${approvalId}, ${deniedReason}): ${command}`,
                { sessionKey, contextKey },
              );
              requestHeartbeatNow({ reason: "cli-model-denied" });
              return;
            }

            // Record allowlist hits for observability (no content).
            recordMatches();

            const res = await runCliBinary(command, prompt);
            const truncatedByMaxBuffer = res.truncatedByMaxBuffer;
            const outputText = (res.stdout || res.stderr).trim() || (res.errorMessage ?? "");

            const truncated = truncateOutput(outputText);
            const note = [
              `cli_model result (action=${action}, id=${approvalSlug}, decision=${approvalDecision ?? "unknown"})`,
              truncated.truncated || truncatedByMaxBuffer ? "Note: output truncated." : null,
              "",
              truncated.text || "(no output)",
            ]
              .filter((line): line is string => Boolean(line))
              .join("\n");
            enqueueSystemEvent(note, { sessionKey, contextKey });
            requestHeartbeatNow({ reason: `cli-model:${approvalId}:exit` });
          })();

          return {
            content: [
              {
                type: "text",
                text:
                  `Approval required (id ${approvalSlug}). ` +
                  "Approve to run; updates will arrive after completion.",
              },
            ],
            details: {
              status: "approval-pending",
              approvalId,
              approvalSlug,
              expiresAtMs,
              host: "gateway",
              command,
            },
          };
        }

        if (hostSecurity === "allowlist" && (!analysisOk || !allowlistSatisfied)) {
          return {
            content: [{ type: "text", text: "Error: cli_model denied (allowlist miss)" }],
            details: { error: "Allowlist miss" },
          };
        }

        recordMatches();

        const run = await runCliBinary(command, prompt);
        const output = (run.stdout || run.stderr).trim();
        if (!output && run.errorMessage) {
          return {
            content: [{ type: "text", text: `Error calling CLI tool: ${run.errorMessage}` }],
            details: {
              action,
              error: run.errorMessage,
            },
          };
        }

        const truncated = truncateOutput(output);
        const result = truncated.text || "No output from command";
        const truncatedNote =
          truncated.truncated || run.truncatedByMaxBuffer ? "\n\n[Output truncated]" : "";

        return {
          content: [
            {
              type: "text",
              text: result + truncatedNote,
            },
          ],
          details: {
            action,
            outputChars: result.length,
            truncated: truncated.truncated || run.truncatedByMaxBuffer,
            ...(run.errorMessage ? { warning: "CLI returned non-zero exit status" } : {}),
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: `Error calling CLI tool: ${errorMessage}`,
            },
          ],
          details: {
            action,
            error: errorMessage,
          },
        };
      }
    },
  };
}
