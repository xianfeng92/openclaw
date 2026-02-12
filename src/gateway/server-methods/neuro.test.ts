import { describe, expect, it, vi } from "vitest";
import type { ContextEvent } from "../protocol/index.js";
import type { GatewayRequestContext } from "./types.js";
import { createNeuroContextRingBuffer } from "../neuro/context-ring-buffer.js";
import { createNeuroFeatureFlags } from "../neuro/feature-flags.js";
import { createNeuroMetrics } from "../neuro/metrics.js";
import { neuroHandlers } from "./neuro.js";

const noop = () => false;

function buildEvent(params: {
  eventId: string;
  ts: number;
  sessionKey?: string;
  source?: ContextEvent["source"];
  redactionLevel?: ContextEvent["redaction"]["level"];
}): ContextEvent {
  return {
    version: "context.event.v1",
    eventId: params.eventId,
    ts: params.ts,
    sessionKey: params.sessionKey ?? "agent:main:main",
    source: params.source ?? "clipboard",
    payload: { text: params.eventId },
    redaction: {
      applied: params.redactionLevel != null && params.redactionLevel !== "none",
      level: params.redactionLevel ?? "none",
      reasons: [],
    },
    bounds: {
      bytes: 16,
      dropped: false,
    },
  };
}

function makeContext(): GatewayRequestContext {
  return {
    neuroContextCache: createNeuroContextRingBuffer(),
    neuroFeatureFlags: createNeuroFeatureFlags(),
    neuroMetrics: createNeuroMetrics(),
    broadcast: vi.fn(),
  } as unknown as GatewayRequestContext;
}

describe("neuro gateway handlers", () => {
  it("ingests events and returns per-session snapshot", async () => {
    const context = makeContext();
    const respond = vi.fn();
    const now = Date.now();
    const event = buildEvent({ eventId: "evt-1", ts: now });

    await neuroHandlers["neuro.context.ingest"]({
      params: { events: [event] },
      respond,
      context,
      req: { type: "req", id: "ing-1", method: "neuro.context.ingest" },
      client: null,
      isWebchatConnect: noop,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        acceptedEvents: 1,
        droppedEvents: 0,
      }),
      undefined,
    );

    respond.mockReset();
    await neuroHandlers["neuro.context.snapshot"]({
      params: { sessionKey: "agent:main:main" },
      respond,
      context,
      req: { type: "req", id: "snap-1", method: "neuro.context.snapshot" },
      client: null,
      isWebchatConnect: noop,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        sessionKey: "agent:main:main",
        totalEvents: 1,
        returnedEvents: 1,
      }),
      undefined,
    );

    const payload = respond.mock.calls[0]?.[1] as { events: ContextEvent[] };
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0]?.eventId).toBe("evt-1");
  });

  it("supports snapshot truncation and metadata-only mode", async () => {
    const context = makeContext();
    const respond = vi.fn();
    const now = Date.now();

    await neuroHandlers["neuro.context.ingest"]({
      params: {
        events: [
          buildEvent({ eventId: "evt-1", ts: now }),
          buildEvent({ eventId: "evt-2", ts: now + 1 }),
          buildEvent({ eventId: "evt-3", ts: now + 2 }),
        ],
      },
      respond,
      context,
      req: { type: "req", id: "ing-2", method: "neuro.context.ingest" },
      client: null,
      isWebchatConnect: noop,
    });

    respond.mockReset();
    await neuroHandlers["neuro.context.snapshot"]({
      params: { sessionKey: "agent:main:main", maxEvents: 2 },
      respond,
      context,
      req: { type: "req", id: "snap-2", method: "neuro.context.snapshot" },
      client: null,
      isWebchatConnect: noop,
    });

    const truncated = respond.mock.calls[0]?.[1] as {
      events: ContextEvent[];
      returnedEvents: number;
    };
    expect(truncated.returnedEvents).toBe(2);
    expect(truncated.events.map((event) => event.eventId)).toEqual(["evt-2", "evt-3"]);

    respond.mockReset();
    await neuroHandlers["neuro.context.snapshot"]({
      params: { sessionKey: "agent:main:main", includeEvents: false },
      respond,
      context,
      req: { type: "req", id: "snap-3", method: "neuro.context.snapshot" },
      client: null,
      isWebchatConnect: noop,
    });

    const metadataOnly = respond.mock.calls[0]?.[1] as {
      totalEvents: number;
      returnedEvents: number;
      events: ContextEvent[];
    };
    expect(metadataOnly.totalEvents).toBe(3);
    expect(metadataOnly.returnedEvents).toBe(0);
    expect(metadataOnly.events).toHaveLength(0);
  });

  it("updates flags and broadcasts change events", async () => {
    const context = makeContext();
    const respond = vi.fn();

    await neuroHandlers["neuro.flags.set"]({
      params: { proactiveCards: true, flowMode: true },
      respond,
      context,
      req: { type: "req", id: "flags-set-1", method: "neuro.flags.set" },
      client: null,
      isWebchatConnect: noop,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        configured: expect.objectContaining({
          proactiveCards: true,
          flowMode: true,
        }),
      }),
      undefined,
    );
    expect(context.broadcast).toHaveBeenCalledWith(
      "neuro.flags.changed",
      expect.objectContaining({
        configured: expect.objectContaining({ proactiveCards: true }),
      }),
      { dropIfSlow: true },
    );

    respond.mockReset();
    await neuroHandlers["neuro.flags.get"]({
      params: {},
      respond,
      context,
      req: { type: "req", id: "flags-get-1", method: "neuro.flags.get" },
      client: null,
      isWebchatConnect: noop,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        configured: expect.objectContaining({
          proactiveCards: true,
        }),
      }),
      undefined,
    );
  });

  it("records metrics observations and redaction counters", async () => {
    const context = makeContext();
    const respond = vi.fn();
    const now = Date.now();

    await neuroHandlers["neuro.metrics.observe"]({
      params: { uiReadyMs: 123, desktopMemoryMb: 256.2 },
      respond,
      context,
      req: { type: "req", id: "metrics-observe-1", method: "neuro.metrics.observe" },
      client: null,
      isWebchatConnect: noop,
    });

    await neuroHandlers["neuro.context.ingest"]({
      params: {
        events: [
          buildEvent({ eventId: "evt-mask", ts: now, redactionLevel: "mask" }),
          buildEvent({ eventId: "evt-block", ts: now + 1, redactionLevel: "block" }),
        ],
      },
      respond: vi.fn(),
      context,
      req: { type: "req", id: "ing-3", method: "neuro.context.ingest" },
      client: null,
      isWebchatConnect: noop,
    });

    respond.mockReset();
    await neuroHandlers["neuro.metrics.get"]({
      params: {},
      respond,
      context,
      req: { type: "req", id: "metrics-get-1", method: "neuro.metrics.get" },
      client: null,
      isWebchatConnect: noop,
    });

    const snapshot = respond.mock.calls[0]?.[1] as {
      invoke: { uiReadyMs: { count: number } };
      memory: { desktopMb: number | null };
      redaction: { maskCount: number; blockCount: number };
    };
    expect(snapshot.invoke.uiReadyMs.count).toBe(1);
    expect(snapshot.memory.desktopMb).toBe(256.2);
    expect(snapshot.redaction.maskCount).toBe(1);
    expect(snapshot.redaction.blockCount).toBe(1);
  });

  it("returns INVALID_REQUEST when params are invalid", async () => {
    const context = makeContext();
    const respond = vi.fn();

    await neuroHandlers["neuro.context.ingest"]({
      params: {},
      respond,
      context,
      req: { type: "req", id: "bad-ing", method: "neuro.context.ingest" },
      client: null,
      isWebchatConnect: noop,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
      }),
    );
  });
});
