import AjvPkg from "ajv";
import { describe, expect, it, vi } from "vitest";
import { ContextEventSchema } from "../protocol/schema/neuro.js";
import {
  collectActiveWindowSnapshot,
  collectClipboardSnapshot,
  createNeuroContextCaptureService,
} from "./context-capture.js";
import { createNeuroContextRingBuffer } from "./context-ring-buffer.js";

const ajv = new (AjvPkg as unknown as new (opts?: object) => import("ajv").default)({
  allErrors: true,
  strict: false,
});

describe("collectClipboardSnapshot", () => {
  it("uses platform command fallbacks and returns text snapshot", async () => {
    const runner = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "", stderr: "not found", code: 1, killed: false })
      .mockResolvedValueOnce({
        stdout: "secret-token-value",
        stderr: "",
        code: 0,
        killed: false,
      });
    const snapshot = await collectClipboardSnapshot({
      platform: "win32",
      runner,
    });
    expect(snapshot).toEqual({
      text: "secret-token-value",
      type: "text",
    });
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("reads clipboard on macOS via pbpaste", async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: "copied-from-mac",
      stderr: "",
      code: 0,
      killed: false,
    });
    const snapshot = await collectClipboardSnapshot({
      platform: "darwin",
      runner,
    });
    expect(snapshot).toEqual({
      text: "copied-from-mac",
      type: "text",
    });
    expect(runner).toHaveBeenCalledWith(["pbpaste"], expect.objectContaining({ timeoutMs: 1500 }));
  });
});

describe("collectActiveWindowSnapshot", () => {
  it("parses Windows active window payload", async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: "Code\topenclaw\\README.md",
      stderr: "",
      code: 0,
      killed: false,
    });
    const snapshot = await collectActiveWindowSnapshot({
      platform: "win32",
      runner,
    });
    expect(snapshot).toEqual({
      app: "Code",
      title: "openclaw\\README.md",
    });
  });

  it("parses macOS front app/window output", async () => {
    const runner = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: "Safari",
        stderr: "",
        code: 0,
        killed: false,
      })
      .mockResolvedValueOnce({
        stdout: "OpenClaw Dashboard",
        stderr: "",
        code: 0,
        killed: false,
      });
    const snapshot = await collectActiveWindowSnapshot({
      platform: "darwin",
      runner,
    });
    expect(snapshot).toEqual({
      app: "Safari",
      title: "OpenClaw Dashboard",
    });
  });
});

describe("createNeuroContextCaptureService", () => {
  it("emits schema-valid context events and stores them in ring buffer", async () => {
    const validate = ajv.compile(ContextEventSchema);
    const ringBuffer = createNeuroContextRingBuffer();
    const capture = createNeuroContextCaptureService({
      ringBuffer,
      now: () => 1_770_000_001_000,
      eventIdFactory: (() => {
        let i = 0;
        return () => `evt-${++i}`;
      })(),
      sensors: [
        {
          source: "clipboard",
          collect: async () => ({
            text: "OPENAI_API_KEY=sk-live-secret-value-12345",
            type: "text",
          }),
        },
        {
          source: "active_window",
          collect: async () => ({
            app: "Browser",
            title: "Dashboard",
            url: "https://openclaw.ai/dashboard?token=should-hide#anchor",
          }),
        },
      ],
    });

    const result = await capture.captureOnce("agent:main:main");
    expect(result.events).toHaveLength(2);

    for (const event of result.events) {
      expect(validate(event)).toBe(true);
    }

    const clipboard = result.events.find((event) => event.source === "clipboard");
    const activeWindow = result.events.find((event) => event.source === "active_window");

    expect(JSON.stringify(clipboard?.payload ?? {})).not.toContain("sk-live-secret-value-12345");
    expect(clipboard?.redaction.level).toBe("hash");
    expect(activeWindow?.payload.url).toBe("https://openclaw.ai/dashboard");

    const snapshot = ringBuffer.snapshot("agent:main:main", 1_770_000_001_000);
    expect(snapshot.totalEvents).toBe(2);
    expect(snapshot.perSource.clipboard.count).toBe(1);
    expect(snapshot.perSource.active_window.count).toBe(1);
  });

  it("deduplicates repeated payloads in a short window", async () => {
    const ringBuffer = createNeuroContextRingBuffer();
    let nowMs = 1000;
    const capture = createNeuroContextCaptureService({
      ringBuffer,
      dedupeWindowMs: 5000,
      now: () => nowMs,
      eventIdFactory: (() => {
        let i = 0;
        return () => `evt-${++i}`;
      })(),
      sensors: [
        {
          source: "clipboard",
          collect: async () => ({
            text: "same payload",
            type: "text",
          }),
        },
      ],
    });

    const first = await capture.captureOnce("agent:main:main");
    nowMs += 1000;
    const second = await capture.captureOnce("agent:main:main");

    expect(first.events).toHaveLength(1);
    expect(second.events).toHaveLength(0);
    expect(second.skipped).toEqual([{ source: "clipboard", reason: "duplicate" }]);

    const snapshot = ringBuffer.snapshot("agent:main:main", nowMs);
    expect(snapshot.totalEvents).toBe(1);
  });

  it("keeps ring buffer bounded by source caps", async () => {
    const ringBuffer = createNeuroContextRingBuffer({
      maxEventsBySource: {
        clipboard: 1,
        active_window: 1,
        terminal: 10,
        fs: 10,
        editor: 10,
      },
    });

    let iteration = 0;
    const capture = createNeuroContextCaptureService({
      ringBuffer,
      dedupeWindowMs: 0,
      now: () => 10_000 + iteration,
      eventIdFactory: (() => {
        let i = 0;
        return () => `evt-${++i}`;
      })(),
      sensors: [
        {
          source: "clipboard",
          collect: async () => ({
            text: `clipboard-${iteration}`,
          }),
        },
        {
          source: "active_window",
          collect: async () => ({
            app: "Code",
            title: `window-${iteration}`,
          }),
        },
      ],
    });

    iteration = 1;
    await capture.captureOnce("agent:main:main");
    iteration = 2;
    await capture.captureOnce("agent:main:main");

    const snapshot = ringBuffer.snapshot("agent:main:main", 20_000);
    expect(snapshot.perSource.clipboard.count).toBe(1);
    expect(snapshot.perSource.active_window.count).toBe(1);
    expect(snapshot.totalEvents).toBe(2);
  });
});
