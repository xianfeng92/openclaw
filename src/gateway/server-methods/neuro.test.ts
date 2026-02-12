import { describe, expect, it, vi } from "vitest";
import type { ContextEvent } from "../protocol/index.js";
import type { GatewayRequestContext } from "./types.js";
import { createNeuroContextRingBuffer } from "../neuro/context-ring-buffer.js";
import { neuroHandlers } from "./neuro.js";

const noop = () => false;

function buildEvent(params: {
  eventId: string;
  ts: number;
  sessionKey?: string;
  source?: ContextEvent["source"];
}): ContextEvent {
  return {
    version: "context.event.v1",
    eventId: params.eventId,
    ts: params.ts,
    sessionKey: params.sessionKey ?? "agent:main:main",
    source: params.source ?? "clipboard",
    payload: { text: params.eventId },
    redaction: {
      applied: false,
      level: "none",
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
