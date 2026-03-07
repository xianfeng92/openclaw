import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { BashSandboxConfig } from "./bash-tools.shared.js";
import type { ProcessSession, SessionStdin } from "./bash-process-registry.js";
import { logWarn } from "../logger.js";
import { formatSpawnError, spawnWithFallback } from "../process/spawn-utils.js";
import {
  addSession,
  appendOutput,
  createSessionSlug,
  markExited,
} from "./bash-process-registry.js";
import { maybeNotifyOnExit } from "./bash-tools.exec.compat.js";
import {
  buildDockerExecArgs,
  chunkString,
  killSession,
} from "./bash-tools.shared.js";
import { buildCursorPositionResponse, stripDsrRequests } from "./pty-dsr.js";
import { getShellConfig, sanitizeBinaryOutput } from "./shell-utils.js";
type PtyExitEvent = { exitCode: number; signal?: number };
type PtyListener<T> = (event: T) => void;
type PtyHandle = {
  pid: number;
  write: (data: string | Buffer) => void;
  onData: (listener: PtyListener<string>) => void;
  onExit: (listener: PtyListener<PtyExitEvent>) => void;
};
type PtySpawn = (
  file: string,
  args: string[] | string,
  options: {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: Record<string, string>;
  },
) => PtyHandle;

export type ExecProcessOutcome = {
  status: "completed" | "failed";
  exitCode: number | null;
  exitSignal: NodeJS.Signals | number | null;
  durationMs: number;
  aggregated: string;
  timedOut: boolean;
  reason?: string;
};

export type ExecProcessHandle = {
  session: ProcessSession;
  startedAt: number;
  pid?: number;
  promise: Promise<ExecProcessOutcome>;
  kill: () => void;
};
type ExecProcessRunningUpdate = {
  content: Array<{ type: "text"; text: string }>;
  details: {
    status: "running";
    sessionId: string;
    pid?: number;
    startedAt: number;
    cwd: string;
    tail: string;
  };
};
export async function runExecProcess(opts: {
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
  onUpdate?: (partialResult: ExecProcessRunningUpdate) => void;
}): Promise<ExecProcessHandle> {
  const startedAt = Date.now();
  const sessionId = createSessionSlug();
  let child: ChildProcessWithoutNullStreams | null = null;
  let pty: PtyHandle | null = null;
  let stdin: SessionStdin | undefined;

  if (opts.sandbox) {
    const { child: spawned } = await spawnWithFallback({
      argv: [
        "docker",
        ...buildDockerExecArgs({
          containerName: opts.sandbox.containerName,
          command: opts.command,
          workdir: opts.containerWorkdir ?? opts.sandbox.containerWorkdir,
          env: opts.env,
          tty: opts.usePty,
        }),
      ],
      options: {
        cwd: opts.workdir,
        env: process.env,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
      fallbacks: [
        {
          label: "no-detach",
          options: { detached: false },
        },
      ],
      onFallback: (err, fallback) => {
        const errText = formatSpawnError(err);
        const warning = `Warning: spawn failed (${errText}); retrying with ${fallback.label}.`;
        logWarn(`exec: spawn failed (${errText}); retrying with ${fallback.label}.`);
        opts.warnings.push(warning);
      },
    });
    child = spawned as ChildProcessWithoutNullStreams;
    stdin = child.stdin;
  } else if (opts.usePty) {
    const { shell, args: shellArgs } = getShellConfig();
    try {
      const ptyModule = (await import("@lydell/node-pty")) as unknown as {
        spawn?: PtySpawn;
        default?: { spawn?: PtySpawn };
      };
      const spawnPty = ptyModule.spawn ?? ptyModule.default?.spawn;
      if (!spawnPty) {
        throw new Error("PTY support is unavailable (node-pty spawn not found).");
      }
      pty = spawnPty(shell, [...shellArgs, opts.command], {
        cwd: opts.workdir,
        env: opts.env,
        name: process.env.TERM ?? "xterm-256color",
        cols: 120,
        rows: 30,
      });
      stdin = {
        destroyed: false,
        write: (data, cb) => {
          try {
            pty?.write(data);
            cb?.(null);
          } catch (err) {
            cb?.(err as Error);
          }
        },
        end: () => {
          try {
            const eof = process.platform === "win32" ? "\x1a" : "\x04";
            pty?.write(eof);
          } catch {
            // ignore EOF errors
          }
        },
      };
    } catch (err) {
      const errText = String(err);
      const warning = `Warning: PTY spawn failed (${errText}); retrying without PTY for \`${opts.command}\`.`;
      logWarn(`exec: PTY spawn failed (${errText}); retrying without PTY for "${opts.command}".`);
      opts.warnings.push(warning);
      const { child: spawned } = await spawnWithFallback({
        argv: [shell, ...shellArgs, opts.command],
        options: {
          cwd: opts.workdir,
          env: opts.env,
          detached: process.platform !== "win32",
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        },
        fallbacks: [
          {
            label: "no-detach",
            options: { detached: false },
          },
        ],
        onFallback: (fallbackErr, fallback) => {
          const fallbackText = formatSpawnError(fallbackErr);
          const fallbackWarning = `Warning: spawn failed (${fallbackText}); retrying with ${fallback.label}.`;
          logWarn(`exec: spawn failed (${fallbackText}); retrying with ${fallback.label}.`);
          opts.warnings.push(fallbackWarning);
        },
      });
      child = spawned as ChildProcessWithoutNullStreams;
      stdin = child.stdin;
    }
  } else {
    const { shell, args: shellArgs } = getShellConfig();
    const { child: spawned } = await spawnWithFallback({
      argv: [shell, ...shellArgs, opts.command],
      options: {
        cwd: opts.workdir,
        env: opts.env,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
      fallbacks: [
        {
          label: "no-detach",
          options: { detached: false },
        },
      ],
      onFallback: (err, fallback) => {
        const errText = formatSpawnError(err);
        const warning = `Warning: spawn failed (${errText}); retrying with ${fallback.label}.`;
        logWarn(`exec: spawn failed (${errText}); retrying with ${fallback.label}.`);
        opts.warnings.push(warning);
      },
    });
    child = spawned as ChildProcessWithoutNullStreams;
    stdin = child.stdin;
  }

  const session = {
    id: sessionId,
    command: opts.command,
    scopeKey: opts.scopeKey,
    sessionKey: opts.sessionKey,
    notifyOnExit: opts.notifyOnExit,
    exitNotified: false,
    child: child ?? undefined,
    stdin,
    pid: child?.pid ?? pty?.pid,
    startedAt,
    cwd: opts.workdir,
    maxOutputChars: opts.maxOutput,
    pendingMaxOutputChars: opts.pendingMaxOutput,
    totalOutputChars: 0,
    pendingStdout: [],
    pendingStderr: [],
    pendingStdoutChars: 0,
    pendingStderrChars: 0,
    aggregated: "",
    tail: "",
    exited: false,
    exitCode: undefined as number | null | undefined,
    exitSignal: undefined as NodeJS.Signals | number | null | undefined,
    truncated: false,
    backgrounded: false,
  } satisfies ProcessSession;
  addSession(session);

  let settled = false;
  let timeoutTimer: NodeJS.Timeout | null = null;
  let timeoutFinalizeTimer: NodeJS.Timeout | null = null;
  let timedOut = false;
  const timeoutFinalizeMs = 1000;
  let resolveFn: ((outcome: ExecProcessOutcome) => void) | null = null;

  const settle = (outcome: ExecProcessOutcome) => {
    if (settled) {
      return;
    }
    settled = true;
    resolveFn?.(outcome);
  };

  const finalizeTimeout = () => {
    if (session.exited) {
      return;
    }
    markExited(session, null, "SIGKILL", "failed");
    maybeNotifyOnExit({
      session,
      status: "failed",
      tailChars: opts.notifyTailChars,
    });
    const aggregated = session.aggregated.trim();
    const reason = `Command timed out after ${opts.timeoutSec} seconds`;
    settle({
      status: "failed",
      exitCode: null,
      exitSignal: "SIGKILL",
      durationMs: Date.now() - startedAt,
      aggregated,
      timedOut: true,
      reason: aggregated ? `${aggregated}\n\n${reason}` : reason,
    });
  };

  const onTimeout = () => {
    timedOut = true;
    killSession(session);
    if (!timeoutFinalizeTimer) {
      timeoutFinalizeTimer = setTimeout(() => {
        finalizeTimeout();
      }, timeoutFinalizeMs);
    }
  };

  if (opts.timeoutSec > 0) {
    timeoutTimer = setTimeout(() => {
      onTimeout();
    }, opts.timeoutSec * 1000);
  }

  const emitUpdate = () => {
    if (!opts.onUpdate) {
      return;
    }
    const tailText = session.tail || session.aggregated;
    const warningText = opts.warnings.length ? `${opts.warnings.join("\n")}\n\n` : "";
    opts.onUpdate({
      content: [{ type: "text", text: warningText + (tailText || "") }],
      details: {
        status: "running",
        sessionId,
        pid: session.pid ?? undefined,
        startedAt,
        cwd: session.cwd,
        tail: session.tail,
      },
    });
  };

  const stripTrailingNulls = (value: string): string => {
    let end = value.length;
    while (end > 0 && value.charCodeAt(end - 1) === 0) {
      end -= 1;
    }
    return end === value.length ? value : value.slice(0, end);
  };

  const handleStdout = (data: Buffer | string) => {
    // Handle encoding correctly for Windows PowerShell output
    // PowerShell outputs UTF-16 LE on Windows, but Node.js may read it as binary
    let str: string;
    if (Buffer.isBuffer(data)) {
      // Try to detect UTF-16 LE encoding (common for PowerShell output)
      // Check if buffer starts with UTF-16 LE BOM or contains null bytes in even positions
      const isUtf16Le = data.length >= 2 && data[1] === 0 && data[3] === 0;
      if (isUtf16Le && process.platform === "win32") {
        // Remove BOM if present and decode as UTF-16 LE
        let start = 0;
        if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) {
          start = 2; // UTF-16 LE BOM
        }
        str = stripTrailingNulls(data.toString("utf16le", start));
      } else {
        str = data.toString("utf8");
      }
    } else {
      str = String(data);
    }
    const cleaned = sanitizeBinaryOutput(str);
    for (const chunk of chunkString(cleaned)) {
      appendOutput(session, "stdout", chunk);
      emitUpdate();
    }
  };

  const handleStderr = (data: Buffer | string) => {
    // Handle encoding correctly for Windows PowerShell error output
    let str: string;
    if (Buffer.isBuffer(data)) {
      const isUtf16Le = data.length >= 2 && data[1] === 0 && data[3] === 0;
      if (isUtf16Le && process.platform === "win32") {
        let start = 0;
        if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) {
          start = 2;
        }
        str = stripTrailingNulls(data.toString("utf16le", start));
      } else {
        str = data.toString("utf8");
      }
    } else {
      str = String(data);
    }
    const cleaned = sanitizeBinaryOutput(str);
    for (const chunk of chunkString(cleaned)) {
      appendOutput(session, "stderr", chunk);
      emitUpdate();
    }
  };

  if (pty) {
    const cursorResponse = buildCursorPositionResponse();
    pty.onData((data: string | Buffer) => {
      // PTY output may also have encoding issues on Windows
      let raw: string;
      if (typeof data === "string") {
        raw = data;
      } else if (Buffer.isBuffer(data)) {
        // Try UTF-16 LE decoding for Windows PTY output
        const isUtf16Le = data.length >= 2 && data[1] === 0 && data[3] === 0;
        if (isUtf16Le && process.platform === "win32") {
          raw = stripTrailingNulls(data.toString("utf16le"));
        } else {
          raw = data.toString("utf8");
        }
      } else {
        raw = String(data);
      }
      const { cleaned, requests } = stripDsrRequests(raw);
      if (requests > 0) {
        for (let i = 0; i < requests; i += 1) {
          pty.write(cursorResponse);
        }
      }
      handleStdout(cleaned);
    });
  } else if (child) {
    child.stdout.on("data", handleStdout);
    child.stderr.on("data", handleStderr);
  }

  const promise = new Promise<ExecProcessOutcome>((resolve) => {
    resolveFn = resolve;
    const handleExit = (code: number | null, exitSignal: NodeJS.Signals | number | null) => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      if (timeoutFinalizeTimer) {
        clearTimeout(timeoutFinalizeTimer);
      }
      const durationMs = Date.now() - startedAt;
      const wasSignal = exitSignal != null;
      const isSuccess = code === 0 && !wasSignal && !timedOut;
      const status: "completed" | "failed" = isSuccess ? "completed" : "failed";
      markExited(session, code, exitSignal, status);
      maybeNotifyOnExit({ session, status, tailChars: opts.notifyTailChars });
      if (!session.child && session.stdin) {
        session.stdin.destroyed = true;
      }

      if (settled) {
        return;
      }
      const aggregated = session.aggregated.trim();
      if (!isSuccess) {
        const reason = timedOut
          ? `Command timed out after ${opts.timeoutSec} seconds`
          : wasSignal && exitSignal
            ? `Command aborted by signal ${exitSignal}`
            : code === null
              ? "Command aborted before exit code was captured"
              : `Command exited with code ${code}`;
        const message = aggregated ? `${aggregated}\n\n${reason}` : reason;
        settle({
          status: "failed",
          exitCode: code ?? null,
          exitSignal: exitSignal ?? null,
          durationMs,
          aggregated,
          timedOut,
          reason: message,
        });
        return;
      }
      settle({
        status: "completed",
        exitCode: code ?? 0,
        exitSignal: exitSignal ?? null,
        durationMs,
        aggregated,
        timedOut: false,
      });
    };

    if (pty) {
      pty.onExit((event) => {
        const rawSignal = event.signal ?? null;
        const normalizedSignal = rawSignal === 0 ? null : rawSignal;
        handleExit(event.exitCode ?? null, normalizedSignal);
      });
    } else if (child) {
      child.once("close", (code, exitSignal) => {
        handleExit(code, exitSignal);
      });

      child.once("error", (err) => {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
        }
        if (timeoutFinalizeTimer) {
          clearTimeout(timeoutFinalizeTimer);
        }
        markExited(session, null, null, "failed");
        maybeNotifyOnExit({
          session,
          status: "failed",
          tailChars: opts.notifyTailChars,
        });
        const aggregated = session.aggregated.trim();
        const message = aggregated ? `${aggregated}\n\n${String(err)}` : String(err);
        settle({
          status: "failed",
          exitCode: null,
          exitSignal: null,
          durationMs: Date.now() - startedAt,
          aggregated,
          timedOut,
          reason: message,
        });
      });
    }
  });

  return {
    session,
    startedAt,
    pid: session.pid ?? undefined,
    promise,
    kill: () => killSession(session),
  };
}
