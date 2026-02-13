import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContextEvent } from "../protocol/index.js";
import type { GatewayRequestContext } from "./types.js";
import { createNeuroBehavioralStore } from "../neuro/behavioral-store.js";
import { createNeuroContextRingBuffer } from "../neuro/context-ring-buffer.js";
import { createNeuroFeatureFlags } from "../neuro/feature-flags.js";
import { createNeuroMetrics } from "../neuro/metrics.js";
import { createNeuroPolicyEngine } from "../neuro/policy-engine.js";
import { createNeuroPredictionEngine } from "../neuro/prediction-engine.js";
import { createNeuroSuggestionCards } from "../neuro/suggestion-cards.js";
import { createNeuroUndoJournal } from "../neuro/undo-journal.js";
import { neuroHandlers } from "./neuro.js";

const noop = () => false;
const tempDirs: string[] = [];
const openStores: Array<{ close: () => void }> = [];

function makeDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-neuro-reliability-"));
  tempDirs.push(dir);
  return path.join(dir, "behavioral.db");
}

afterEach(() => {
  for (const store of openStores.splice(0, openStores.length)) {
    try {
      store.close();
    } catch {
      // ignore cleanup failures in tests
    }
  }
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function buildEvent(id: number, ts: number): ContextEvent {
  return {
    version: "context.event.v1",
    eventId: `evt-${id}`,
    ts,
    sessionKey: "agent:main:main",
    source: "terminal",
    payload: { line: `line-${id}` },
    redaction: {
      applied: false,
      level: "none",
      reasons: [],
    },
    bounds: {
      bytes: 24,
      dropped: false,
    },
  };
}

function makeContext(opts?: {
  loadGatewayModelCatalog?: GatewayRequestContext["loadGatewayModelCatalog"];
  broadcast?: GatewayRequestContext["broadcast"];
}): GatewayRequestContext {
  const neuroBehavioralStore = createNeuroBehavioralStore({ dbPath: makeDbPath() });
  openStores.push(neuroBehavioralStore);
  return {
    neuroContextCache: createNeuroContextRingBuffer(),
    neuroBehavioralStore,
    neuroPredictionEngine: createNeuroPredictionEngine({ behavioralStore: neuroBehavioralStore }),
    neuroSuggestionCards: createNeuroSuggestionCards(),
    neuroUndoJournal: createNeuroUndoJournal(),
    neuroPolicyEngine: createNeuroPolicyEngine(),
    neuroFeatureFlags: createNeuroFeatureFlags(),
    neuroMetrics: createNeuroMetrics(),
    loadGatewayModelCatalog:
      opts?.loadGatewayModelCatalog ??
      (async () => [{ provider: "openai", model: "gpt-5-mini" }] as unknown[]),
    broadcast: opts?.broadcast ?? vi.fn(),
    logGateway: { warn: vi.fn() },
  } as unknown as GatewayRequestContext;
}

describe("neuro reliability suite", () => {
  it("falls back with provider kind for non-network provider failures", async () => {
    const context = makeContext({
      loadGatewayModelCatalog: async () => {
        throw new Error("Provider 500 internal");
      },
    });
    const respond = vi.fn();

    await neuroHandlers["neuro.suggestion.upsert"]({
      params: {
        card: {
          version: "suggestion.card.v1",
          suggestionId: "sg-provider-failure",
          sessionKey: "agent:main:main",
          confidence: 0.8,
          mode: "safe",
          actions: ["apply", "dismiss", "undo", "explain"],
          expiresAt: Date.now() + 30_000,
        },
      },
      respond: vi.fn(),
      context,
      req: { type: "req", id: "upsert-provider-failure", method: "neuro.suggestion.upsert" },
      client: null,
      isWebchatConnect: noop,
    });

    await neuroHandlers["neuro.suggestion.action"]({
      params: {
        sessionKey: "agent:main:main",
        suggestionId: "sg-provider-failure",
        action: "apply",
      },
      respond,
      context,
      req: { type: "req", id: "apply-provider-failure", method: "neuro.suggestion.action" },
      client: null,
      isWebchatConnect: noop,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        status: "fallback",
        fallback: expect.objectContaining({
          kind: "provider",
        }),
      }),
      undefined,
    );
  });

  it("handles websocket disconnect (broadcast throw) without failing requests", async () => {
    const context = makeContext({
      broadcast: vi.fn(() => {
        throw new Error("ws disconnected");
      }),
    });
    const respond = vi.fn();

    await neuroHandlers["neuro.suggestion.upsert"]({
      params: {
        card: {
          version: "suggestion.card.v1",
          suggestionId: "sg-ws-disconnect",
          sessionKey: "agent:main:main",
          confidence: 0.8,
          mode: "safe",
          actions: ["apply", "dismiss", "undo", "explain"],
          expiresAt: Date.now() + 30_000,
        },
      },
      respond,
      context,
      req: { type: "req", id: "upsert-ws-disconnect", method: "neuro.suggestion.upsert" },
      client: null,
      isWebchatConnect: noop,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        suggestionId: "sg-ws-disconnect",
      }),
      undefined,
    );
    expect(context.logGateway.warn).toHaveBeenCalledWith(
      expect.stringContaining("neuro broadcast failed"),
    );
  });

  it("sustains burst ingest load without handler failure", async () => {
    const context = makeContext();
    const respond = vi.fn();
    let eventId = 0;
    const startTs = Date.now();

    for (let batch = 0; batch < 32; batch += 1) {
      const events = Array.from({ length: 256 }, () => {
        eventId += 1;
        return buildEvent(eventId, startTs + eventId);
      });
      await neuroHandlers["neuro.context.ingest"]({
        params: { events },
        respond,
        context,
        req: { type: "req", id: `burst-${batch}`, method: "neuro.context.ingest" },
        client: null,
        isWebchatConnect: noop,
      });
    }

    const lastIngest = respond.mock.calls.at(-1)?.[1] as {
      acceptedEvents: number;
      droppedEvents: number;
    };
    expect(lastIngest.acceptedEvents).toBe(256);
    expect(lastIngest.droppedEvents).toBeGreaterThanOrEqual(0);

    respond.mockReset();
    await neuroHandlers["neuro.context.snapshot"]({
      params: { sessionKey: "agent:main:main", includeEvents: false },
      respond,
      context,
      req: { type: "req", id: "burst-snapshot", method: "neuro.context.snapshot" },
      client: null,
      isWebchatConnect: noop,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        sessionKey: "agent:main:main",
        totalEvents: expect.any(Number),
      }),
      undefined,
    );
  });
});
