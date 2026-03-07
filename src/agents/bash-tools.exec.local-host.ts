import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { markBackgrounded } from "./bash-process-registry.js";
import { runExecProcess } from "./bash-tools.exec.process.js";
import type { ExecToolDetails } from "./bash-tools.exec.types.js";
import type { BashSandboxConfig } from "./bash-tools.shared.js";

type RunUpdateCallback = Parameters<typeof runExecProcess>[0]["onUpdate"];

type ExecuteLocalExecHostParams = {
  command: string;
  workdir: string;
  env: Record<string, string>;
  sandbox?: BashSandboxConfig;
  containerWorkdir?: string | null;
  usePty: boolean;
  warnings: string[];
  maxOutput: number;
  pendingMaxOutput: number;
  notifyOnExit: boolean;
  scopeKey?: string;
  sessionKey?: string;
  timeoutSec: number;
  notifyTailChars: number;
  allowBackground: boolean;
  yieldWindow: number | null;
  signal?: AbortSignal;
  onUpdate?: RunUpdateCallback;
};

export async function executeLocalExecHost(
  params: ExecuteLocalExecHostParams,
): Promise<AgentToolResult<ExecToolDetails>> {
  const run = await runExecProcess({
    command: params.command,
    workdir: params.workdir,
    env: params.env,
    sandbox: params.sandbox,
    containerWorkdir: params.containerWorkdir,
    usePty: params.usePty,
    warnings: params.warnings,
    maxOutput: params.maxOutput,
    pendingMaxOutput: params.pendingMaxOutput,
    notifyOnExit: params.notifyOnExit,
    scopeKey: params.scopeKey,
    sessionKey: params.sessionKey,
    timeoutSec: params.timeoutSec,
    notifyTailChars: params.notifyTailChars,
    onUpdate: params.onUpdate,
  });

  const getWarningText = () => (params.warnings.length ? `${params.warnings.join("\n")}\n\n` : "");
  let yielded = false;
  let yieldTimer: NodeJS.Timeout | null = null;

  const onAbortSignal = () => {
    if (yielded || run.session.backgrounded) {
      return;
    }
    run.kill();
  };

  if (params.signal?.aborted) {
    onAbortSignal();
  } else if (params.signal) {
    params.signal.addEventListener("abort", onAbortSignal, { once: true });
  }

  return await new Promise<AgentToolResult<ExecToolDetails>>((resolve, reject) => {
    const resolveRunning = () =>
      resolve({
        content: [
          {
            type: "text",
            text: `${getWarningText()}Command still running (session ${run.session.id}, pid ${
              run.session.pid ?? "n/a"
            }). Use process (list/poll/log/write/kill/clear/remove) for follow-up.`,
          },
        ],
        details: {
          status: "running",
          sessionId: run.session.id,
          pid: run.session.pid ?? undefined,
          startedAt: run.startedAt,
          cwd: run.session.cwd,
          tail: run.session.tail,
        },
      });

    const onYieldNow = () => {
      if (yieldTimer) {
        clearTimeout(yieldTimer);
      }
      if (yielded) {
        return;
      }
      yielded = true;
      markBackgrounded(run.session);
      resolveRunning();
    };

    if (params.allowBackground && params.yieldWindow !== null) {
      if (params.yieldWindow === 0) {
        onYieldNow();
      } else {
        yieldTimer = setTimeout(() => {
          if (yielded) {
            return;
          }
          yielded = true;
          markBackgrounded(run.session);
          resolveRunning();
        }, params.yieldWindow);
      }
    }

    run.promise
      .then((outcome) => {
        if (yieldTimer) {
          clearTimeout(yieldTimer);
        }
        if (yielded || run.session.backgrounded) {
          return;
        }
        if (outcome.status === "failed") {
          reject(new Error(outcome.reason ?? "Command failed."));
          return;
        }
        resolve({
          content: [
            {
              type: "text",
              text: `${getWarningText()}${outcome.aggregated || "(no output)"}`,
            },
          ],
          details: {
            status: "completed",
            exitCode: outcome.exitCode ?? 0,
            durationMs: outcome.durationMs,
            aggregated: outcome.aggregated,
            cwd: run.session.cwd,
          },
        });
      })
      .catch((err) => {
        if (yieldTimer) {
          clearTimeout(yieldTimer);
        }
        if (yielded || run.session.backgrounded) {
          return;
        }
        reject(err as Error);
      });
  });
}
