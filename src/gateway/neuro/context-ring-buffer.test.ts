import { describe, expect, it } from "vitest";
import type { ContextEvent } from "../protocol/schema/types.js";
import { createNeuroContextRingBuffer } from "./context-ring-buffer.js";

function makeEvent(params: {
  eventId: string;
  ts: number;
  sessionKey?: string;
  source?: "clipboard" | "active_window";
  text?: string;
}): ContextEvent {
  return {
    version: "context.event.v1",
    eventId: params.eventId,
    ts: params.ts,
    sessionKey: params.sessionKey ?? "agent:main:main",
    source: params.source ?? "clipboard",
    payload: {
      text: params.text ?? "sample",
    },
    redaction: {
      applied: false,
      level: "none",
      reasons: [],
    },
    bounds: {
      bytes: Buffer.byteLength(params.text ?? "sample", "utf8"),
      dropped: false,
    },
  };
}

describe("createNeuroContextRingBuffer", () => {
  it("enforces max events per source", () => {
    const ring = createNeuroContextRingBuffer({
      maxEventsBySource: {
        clipboard: 2,
        active_window: 2,
        terminal: 2,
        fs: 2,
        editor: 2,
      },
    });
    ring.append(makeEvent({ eventId: "e1", ts: 1, text: "one" }), 1);
    ring.append(makeEvent({ eventId: "e2", ts: 2, text: "two" }), 2);
    ring.append(makeEvent({ eventId: "e3", ts: 3, text: "three" }), 3);
    const snapshot = ring.snapshot("agent:main:main", 3);
    expect(snapshot.perSource.clipboard.count).toBe(2);
    expect(snapshot.events.map((event) => event.eventId)).toEqual(["e2", "e3"]);
  });

  it("enforces ttl by source", () => {
    const ring = createNeuroContextRingBuffer({
      ttlMsBySource: {
        clipboard: 10,
        active_window: 10,
        terminal: 10,
        fs: 10,
        editor: 10,
      },
    });
    ring.append(makeEvent({ eventId: "old", ts: 1, text: "old" }), 1);
    ring.append(makeEvent({ eventId: "new", ts: 20, text: "new" }), 20);
    const snapshot = ring.snapshot("agent:main:main", 20);
    expect(snapshot.events.map((event) => event.eventId)).toEqual(["new"]);
  });

  it("enforces byte caps", () => {
    const ring = createNeuroContextRingBuffer({
      maxBytesBySource: {
        clipboard: 450,
        active_window: 512,
        terminal: 512,
        fs: 512,
        editor: 512,
      },
    });
    ring.append(makeEvent({ eventId: "b1", ts: 1, text: "A".repeat(160) }), 1);
    ring.append(makeEvent({ eventId: "b2", ts: 2, text: "B".repeat(160) }), 2);
    const snapshot = ring.snapshot("agent:main:main", 2);
    expect(snapshot.perSource.clipboard.bytes).toBeLessThanOrEqual(450);
    expect(snapshot.events.map((event) => event.eventId)).toEqual(["b2"]);
  });
});
