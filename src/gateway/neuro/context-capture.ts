import { createHash, randomUUID } from "node:crypto";
import type { SpawnResult } from "../../process/exec.js";
import type { ContextEvent } from "../protocol/schema/types.js";
import { runCommandWithTimeout } from "../../process/exec.js";
import {
  createNeuroContextRingBuffer,
  type NeuroContextRingBuffer,
} from "./context-ring-buffer.js";
import { applyNeuroRedaction, type NeuroContextSource } from "./redaction.js";

type CaptureSource = "clipboard" | "active_window";
type CapturePayload = Record<string, unknown>;

type CaptureDedupState = {
  signature: string;
  ts: number;
};

export type CaptureCommandRunner = (
  argv: string[],
  options: { timeoutMs: number; windowsVerbatimArguments?: boolean },
) => Promise<Pick<SpawnResult, "stdout" | "stderr" | "code" | "killed">>;

export type NeuroContextCaptureSensor = {
  source: CaptureSource;
  collect: () => Promise<CapturePayload | null>;
};

export type NeuroContextCaptureResult = {
  events: ContextEvent[];
  skipped: Array<{ source: CaptureSource; reason: string }>;
};

export type NeuroContextCaptureServiceOptions = {
  sensors?: NeuroContextCaptureSensor[];
  ringBuffer?: NeuroContextRingBuffer;
  now?: () => number;
  eventIdFactory?: () => string;
  dedupeWindowMs?: number;
};

const DEFAULT_CAPTURE_TIMEOUT_MS = 1500;
const DEFAULT_DEDUPE_WINDOW_MS = 1500;

const DARWIN_ACTIVE_WINDOW_APP_SCRIPT = [
  "-e",
  'tell application "System Events" to set frontProc to first application process whose frontmost is true',
  "-e",
  'tell application "System Events" to set frontAppName to name of frontProc',
  "-e",
  "return frontAppName",
];

const DARWIN_ACTIVE_WINDOW_TITLE_SCRIPT = [
  "-e",
  'tell application "System Events" to set frontProc to first application process whose frontmost is true',
  "-e",
  "try",
  "-e",
  'tell application "System Events" to set windowTitle to name of front window of frontProc',
  "-e",
  "on error",
  "-e",
  'set windowTitle to ""',
  "-e",
  "end try",
  "-e",
  "return windowTitle",
];

const WINDOWS_ACTIVE_WINDOW_SCRIPT = [
  'Add-Type @"',
  "using System;",
  "using System.Text;",
  "using System.Runtime.InteropServices;",
  "public static class OpenClawWindowReader {",
  '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);',
  '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);',
  "}",
  '"@;',
  "$hwnd = [OpenClawWindowReader]::GetForegroundWindow();",
  "$titleBuilder = New-Object System.Text.StringBuilder 2048;",
  "[void][OpenClawWindowReader]::GetWindowText($hwnd, $titleBuilder, $titleBuilder.Capacity);",
  "$pid = 0;",
  "[void][OpenClawWindowReader]::GetWindowThreadProcessId($hwnd, [ref]$pid);",
  "$process = Get-Process -Id $pid -ErrorAction SilentlyContinue;",
  '$app = if ($process) { $process.ProcessName } else { "" };',
  'Write-Output ($app + "`t" + $titleBuilder.ToString());',
].join("\n");

function normalizeCommandOutput(value: string): string {
  return value.replaceAll("\0", "").replace(/\r\n/g, "\n").trim();
}

function looksPermissionDenied(text: string): boolean {
  return /(permission denied|access is denied|not authorized|not permitted|requires accessibility)/i.test(
    text,
  );
}

function payloadSignature(payload: CapturePayload): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function createDefaultCommandRunner(): CaptureCommandRunner {
  return async (argv, options) =>
    await runCommandWithTimeout(argv, {
      timeoutMs: options.timeoutMs,
      windowsVerbatimArguments: options.windowsVerbatimArguments,
    });
}

async function runCommandAttempts(
  attempts: Array<{ argv: string[]; windowsVerbatimArguments?: boolean }>,
  runner: CaptureCommandRunner,
): Promise<{ stdout: string; stderr: string } | null> {
  for (const attempt of attempts) {
    try {
      const result = await runner(attempt.argv, {
        timeoutMs: DEFAULT_CAPTURE_TIMEOUT_MS,
        windowsVerbatimArguments: attempt.windowsVerbatimArguments,
      });
      const stdout = normalizeCommandOutput(result.stdout ?? "");
      const stderr = normalizeCommandOutput(result.stderr ?? "");
      if (looksPermissionDenied(stderr)) {
        return null;
      }
      if (result.code === 0 && stdout.length > 0) {
        return { stdout, stderr };
      }
    } catch {
      // Continue to next best-effort attempt.
    }
  }
  return null;
}

export async function collectClipboardSnapshot(params?: {
  platform?: NodeJS.Platform;
  runner?: CaptureCommandRunner;
}): Promise<{ text: string; type: "text" } | null> {
  const platform = params?.platform ?? process.platform;
  const runner = params?.runner ?? createDefaultCommandRunner();

  const attempts: Array<{ argv: string[]; windowsVerbatimArguments?: boolean }> = [];
  if (platform === "darwin") {
    attempts.push({ argv: ["pbpaste"] });
  } else if (platform === "win32") {
    attempts.push(
      { argv: ["powershell", "-NoProfile", "-Command", "Get-Clipboard -Raw"] },
      { argv: ["pwsh", "-NoProfile", "-Command", "Get-Clipboard -Raw"] },
      { argv: ["powershell.exe", "-NoProfile", "-Command", "Get-Clipboard -Raw"] },
    );
  } else {
    attempts.push(
      { argv: ["wl-paste", "-n"] },
      { argv: ["xclip", "-selection", "clipboard", "-o"] },
    );
  }

  const output = await runCommandAttempts(attempts, runner);
  const text = normalizeCommandOutput(output?.stdout ?? "");
  if (!text) {
    return null;
  }
  return {
    text,
    type: "text",
  };
}

export async function collectActiveWindowSnapshot(params?: {
  platform?: NodeJS.Platform;
  runner?: CaptureCommandRunner;
}): Promise<{ app: string; title: string } | null> {
  const platform = params?.platform ?? process.platform;
  const runner = params?.runner ?? createDefaultCommandRunner();

  if (platform === "darwin") {
    const appOutput = await runCommandAttempts(
      [{ argv: ["osascript", ...DARWIN_ACTIVE_WINDOW_APP_SCRIPT] }],
      runner,
    );
    const titleOutput = await runCommandAttempts(
      [{ argv: ["osascript", ...DARWIN_ACTIVE_WINDOW_TITLE_SCRIPT] }],
      runner,
    );
    const app = normalizeCommandOutput(appOutput?.stdout ?? "");
    const title = normalizeCommandOutput(titleOutput?.stdout ?? "");
    if (!app && !title) {
      return null;
    }
    return { app, title };
  }

  if (platform === "win32") {
    const output = await runCommandAttempts(
      [
        { argv: ["powershell", "-NoProfile", "-Command", WINDOWS_ACTIVE_WINDOW_SCRIPT] },
        { argv: ["pwsh", "-NoProfile", "-Command", WINDOWS_ACTIVE_WINDOW_SCRIPT] },
      ],
      runner,
    );
    const line = normalizeCommandOutput(output?.stdout ?? "");
    if (!line) {
      return null;
    }
    const [app = "", title = ""] = line.split("\t", 2);
    if (!app && !title) {
      return null;
    }
    return {
      app: app.trim(),
      title: title.trim(),
    };
  }

  return null;
}

export function createClipboardSensor(params?: {
  platform?: NodeJS.Platform;
  runner?: CaptureCommandRunner;
}): NeuroContextCaptureSensor {
  return {
    source: "clipboard",
    collect: async () => {
      const snapshot = await collectClipboardSnapshot(params);
      if (!snapshot) {
        return null;
      }
      return snapshot;
    },
  };
}

export function createActiveWindowSensor(params?: {
  platform?: NodeJS.Platform;
  runner?: CaptureCommandRunner;
}): NeuroContextCaptureSensor {
  return {
    source: "active_window",
    collect: async () => {
      const snapshot = await collectActiveWindowSnapshot(params);
      if (!snapshot) {
        return null;
      }
      return snapshot;
    },
  };
}

export function createDefaultNeuroCaptureSensors(params?: {
  platform?: NodeJS.Platform;
  runner?: CaptureCommandRunner;
}): NeuroContextCaptureSensor[] {
  return [createClipboardSensor(params), createActiveWindowSensor(params)];
}

function toContextEvent(params: {
  source: NeuroContextSource;
  sessionKey: string;
  payload: CapturePayload;
  ts: number;
  eventId: string;
}): ContextEvent {
  const redacted = applyNeuroRedaction({
    source: params.source,
    payload: params.payload,
  });

  return {
    version: "context.event.v1",
    eventId: params.eventId,
    ts: params.ts,
    sessionKey: params.sessionKey,
    source: params.source,
    payload: redacted.payload,
    redaction: redacted.redaction,
    bounds: redacted.bounds,
  };
}

export function createNeuroContextCaptureService(options?: NeuroContextCaptureServiceOptions) {
  const sensors = options?.sensors ?? createDefaultNeuroCaptureSensors();
  const ringBuffer = options?.ringBuffer ?? createNeuroContextRingBuffer();
  const now = options?.now ?? (() => Date.now());
  const eventIdFactory = options?.eventIdFactory ?? (() => randomUUID());
  const dedupeWindowMs = Math.max(0, options?.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS);
  const dedupeCache = new Map<string, CaptureDedupState>();

  function dedupeKey(sessionKey: string, source: CaptureSource): string {
    return `${sessionKey}::${source}`;
  }

  function shouldSkipDuplicate(
    sessionKey: string,
    source: CaptureSource,
    payload: CapturePayload,
    ts: number,
  ): boolean {
    if (dedupeWindowMs <= 0) {
      return false;
    }
    const key = dedupeKey(sessionKey, source);
    const signature = payloadSignature(payload);
    const previous = dedupeCache.get(key);
    dedupeCache.set(key, { signature, ts });
    if (!previous) {
      return false;
    }
    if (signature !== previous.signature) {
      return false;
    }
    return ts - previous.ts <= dedupeWindowMs;
  }

  return {
    ringBuffer,

    async captureOnce(sessionKey: string): Promise<NeuroContextCaptureResult> {
      const ts = now();
      const events: ContextEvent[] = [];
      const skipped: Array<{ source: CaptureSource; reason: string }> = [];

      for (const sensor of sensors) {
        try {
          const payload = await sensor.collect();
          if (!payload) {
            skipped.push({ source: sensor.source, reason: "no_data" });
            continue;
          }
          const event = toContextEvent({
            source: sensor.source,
            sessionKey,
            payload,
            ts,
            eventId: eventIdFactory(),
          });
          if (shouldSkipDuplicate(sessionKey, sensor.source, event.payload, ts)) {
            skipped.push({ source: sensor.source, reason: "duplicate" });
            continue;
          }
          ringBuffer.append(event, ts);
          events.push(event);
        } catch {
          skipped.push({ source: sensor.source, reason: "collector_error" });
        }
      }

      return { events, skipped };
    },
  };
}
