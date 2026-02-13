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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-neuro-handler-"));
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

function buildSuggestionCard(params: {
  suggestionId: string;
  sessionKey?: string;
  expiresAt?: number;
}): {
  version: "suggestion.card.v1";
  suggestionId: string;
  sessionKey: string;
  confidence: number;
  mode: "safe";
  actions: ["apply", "dismiss", "undo", "explain"];
  expiresAt: number;
} {
  return {
    version: "suggestion.card.v1",
    suggestionId: params.suggestionId,
    sessionKey: params.sessionKey ?? "agent:main:main",
    confidence: 0.82,
    mode: "safe",
    actions: ["apply", "dismiss", "undo", "explain"],
    expiresAt: params.expiresAt ?? Date.now() + 60_000,
  };
}

function makeContext(opts?: {
  loadGatewayModelCatalog?: GatewayRequestContext["loadGatewayModelCatalog"];
  nowMs?: () => number;
  retentionDays?: number;
  pruneIntervalMs?: number;
}): GatewayRequestContext {
  const neuroBehavioralStore = createNeuroBehavioralStore({
    dbPath: makeDbPath(),
    now: opts?.nowMs,
    retentionDays: opts?.retentionDays,
    pruneIntervalMs: opts?.pruneIntervalMs,
  });
  openStores.push(neuroBehavioralStore);
  const neuroPredictionEngine = createNeuroPredictionEngine({
    behavioralStore: neuroBehavioralStore,
    now: opts?.nowMs,
  });

  return {
    neuroContextCache: createNeuroContextRingBuffer(),
    neuroBehavioralStore,
    neuroPredictionEngine,
    neuroSuggestionCards: createNeuroSuggestionCards(),
    neuroUndoJournal: createNeuroUndoJournal(),
    neuroPolicyEngine: createNeuroPolicyEngine(),
    neuroFeatureFlags: createNeuroFeatureFlags(),
    neuroMetrics: createNeuroMetrics(),
    loadGatewayModelCatalog:
      opts?.loadGatewayModelCatalog ??
      (async () => [{ provider: "openai", model: "gpt-5-mini" }] as unknown[]),
    broadcast: vi.fn(),
    logGateway: { warn: vi.fn() },
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

  it("supports suggestion upsert/list and apply->undo->dismiss action loop", async () => {
    const context = makeContext();
    const respond = vi.fn();
    const card = buildSuggestionCard({ suggestionId: "sg-1" });

    await neuroHandlers["neuro.suggestion.upsert"]({
      params: { card },
      respond,
      context,
      req: { type: "req", id: "sg-upsert-1", method: "neuro.suggestion.upsert" },
      client: null,
      isWebchatConnect: noop,
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        sessionKey: "agent:main:main",
        suggestionId: "sg-1",
        inserted: true,
      }),
      undefined,
    );

    respond.mockReset();
    await neuroHandlers["neuro.suggestion.list"]({
      params: { sessionKey: "agent:main:main" },
      respond,
      context,
      req: { type: "req", id: "sg-list-1", method: "neuro.suggestion.list" },
      client: null,
      isWebchatConnect: noop,
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        sessionKey: "agent:main:main",
        total: 1,
      }),
      undefined,
    );

    respond.mockReset();
    await neuroHandlers["neuro.suggestion.action"]({
      params: { sessionKey: "agent:main:main", suggestionId: "sg-1", action: "explain" },
      respond,
      context,
      req: { type: "req", id: "sg-explain-1", method: "neuro.suggestion.action" },
      client: null,
      isWebchatConnect: noop,
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        status: "explained",
      }),
      undefined,
    );

    respond.mockReset();
    await neuroHandlers["neuro.suggestion.action"]({
      params: {
        sessionKey: "agent:main:main",
        suggestionId: "sg-1",
        action: "apply",
        operation: "edit_file",
        groupId: "group-1",
        snapshots: [{ kind: "file_write", target: "README.md", before: "a", after: "b" }],
      },
      respond,
      context,
      req: { type: "req", id: "sg-apply-1", method: "neuro.suggestion.action" },
      client: null,
      isWebchatConnect: noop,
    });
    const applyPayload = respond.mock.calls[0]?.[1] as {
      status: string;
      undoUntilMs?: number;
      journalId?: string;
      groupId?: string;
      policy?: { allowed?: boolean };
    };
    expect(applyPayload.status).toBe("applied");
    expect(typeof applyPayload.undoUntilMs).toBe("number");
    expect(typeof applyPayload.journalId).toBe("string");
    expect(applyPayload.groupId).toBe("group-1");
    expect(applyPayload.policy?.allowed).toBe(true);
    expect(context.neuroUndoJournal.listByGroup("agent:main:main", "group-1")).toHaveLength(1);

    respond.mockReset();
    await neuroHandlers["neuro.suggestion.action"]({
      params: { sessionKey: "agent:main:main", suggestionId: "sg-1", action: "undo" },
      respond,
      context,
      req: { type: "req", id: "sg-undo-1", method: "neuro.suggestion.action" },
      client: null,
      isWebchatConnect: noop,
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        status: "undone",
        groupId: "group-1",
      }),
      undefined,
    );

    respond.mockReset();
    await neuroHandlers["neuro.suggestion.action"]({
      params: { sessionKey: "agent:main:main", suggestionId: "sg-1", action: "dismiss" },
      respond,
      context,
      req: { type: "req", id: "sg-dismiss-1", method: "neuro.suggestion.action" },
      client: null,
      isWebchatConnect: noop,
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        status: "dismissed",
      }),
      undefined,
    );

    respond.mockReset();
    await neuroHandlers["neuro.suggestion.list"]({
      params: { sessionKey: "agent:main:main" },
      respond,
      context,
      req: { type: "req", id: "sg-list-2", method: "neuro.suggestion.list" },
      client: null,
      isWebchatConnect: noop,
    });
    const finalListPayload = respond.mock.calls[0]?.[1] as { total: number };
    expect(finalListPayload.total).toBe(0);
  });

  it("supports behavioral export/delete endpoints after suggestion feedback writes", async () => {
    const context = makeContext();
    const respond = vi.fn();
    const card = buildSuggestionCard({ suggestionId: "sg-behavior-1" });

    await neuroHandlers["neuro.suggestion.upsert"]({
      params: { card },
      respond: vi.fn(),
      context,
      req: { type: "req", id: "sg-upsert-behavior-1", method: "neuro.suggestion.upsert" },
      client: null,
      isWebchatConnect: noop,
    });
    await neuroHandlers["neuro.suggestion.action"]({
      params: {
        sessionKey: "agent:main:main",
        suggestionId: "sg-behavior-1",
        action: "apply",
      },
      respond: vi.fn(),
      context,
      req: { type: "req", id: "sg-apply-behavior-1", method: "neuro.suggestion.action" },
      client: null,
      isWebchatConnect: noop,
    });

    await neuroHandlers["neuro.behavior.export"]({
      params: { sessionKey: "agent:main:main", includePreferences: true },
      respond,
      context,
      req: { type: "req", id: "behavior-export-1", method: "neuro.behavior.export" },
      client: null,
      isWebchatConnect: noop,
    });
    const exportPayload = respond.mock.calls[0]?.[1] as {
      events: Array<{ type: string }>;
      preferences: unknown[];
    };
    expect(exportPayload.events.length).toBeGreaterThanOrEqual(2);
    expect(exportPayload.events.some((event) => event.type === "suggestion")).toBe(true);
    expect(exportPayload.events.some((event) => event.type === "feedback")).toBe(true);
    expect(exportPayload.preferences.length).toBeGreaterThanOrEqual(1);

    respond.mockReset();
    await neuroHandlers["neuro.behavior.delete"]({
      params: { sessionKey: "agent:main:main", deletePreferences: true },
      respond,
      context,
      req: { type: "req", id: "behavior-delete-1", method: "neuro.behavior.delete" },
      client: null,
      isWebchatConnect: noop,
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        deletedEvents: expect.any(Number),
        deletedPreferences: expect.any(Number),
        remainingEvents: 0,
      }),
      undefined,
    );
  });

  it("supports behavioral retention dry-run and execution endpoints", async () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const nowMs = 50 * dayMs;
    const context = makeContext({
      retentionDays: 30,
      pruneIntervalMs: 365 * dayMs,
    });
    const respond = vi.fn();

    context.neuroBehavioralStore.recordSuggestion({
      card: buildSuggestionCard({ suggestionId: "sg-retention-old" }),
      nowMs: 5 * dayMs,
    });
    context.neuroBehavioralStore.recordSuggestion({
      card: buildSuggestionCard({ suggestionId: "sg-retention-fresh" }),
      nowMs: 49 * dayMs,
    });

    await neuroHandlers["neuro.behavior.retention.run"]({
      params: { nowMs, dryRun: true },
      respond,
      context,
      req: { type: "req", id: "behavior-retention-dry", method: "neuro.behavior.retention.run" },
      client: null,
      isWebchatConnect: noop,
    });
    const dryRunPayload = respond.mock.calls[0]?.[1] as { deletedEvents: number; dryRun: boolean };
    expect(dryRunPayload.dryRun).toBe(true);
    expect(dryRunPayload.deletedEvents).toBeGreaterThanOrEqual(1);

    respond.mockReset();
    await neuroHandlers["neuro.behavior.retention.run"]({
      params: { nowMs },
      respond,
      context,
      req: { type: "req", id: "behavior-retention-run", method: "neuro.behavior.retention.run" },
      client: null,
      isWebchatConnect: noop,
    });
    const runPayload = respond.mock.calls[0]?.[1] as { deletedEvents: number; dryRun: boolean };
    expect(runPayload.dryRun).toBe(false);
    expect(runPayload.deletedEvents).toBeGreaterThanOrEqual(1);
  });

  it("supports neuro.predict.preview endpoint", async () => {
    const context = makeContext();
    const respond = vi.fn();

    await neuroHandlers["neuro.predict.preview"]({
      params: {
        sessionKey: "agent:main:main",
        source: "terminal",
        signal: "pnpm test fails with ts error",
      },
      respond,
      context,
      req: { type: "req", id: "predict-preview-1", method: "neuro.predict.preview" },
      client: null,
      isWebchatConnect: noop,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        sessionKey: "agent:main:main",
        action: expect.stringMatching(/suggest|auto_apply|ignore/),
        reasonCodes: expect.any(Array),
      }),
      undefined,
    );
  });

  it("returns fallback status for apply when provider is offline", async () => {
    const context = makeContext({
      loadGatewayModelCatalog: async () => {
        throw new Error("ECONNREFUSED model provider");
      },
    });
    const respond = vi.fn();

    await neuroHandlers["neuro.suggestion.upsert"]({
      params: {
        card: buildSuggestionCard({
          suggestionId: "sg-offline-1",
          expiresAt: Date.now() + 60_000,
        }),
      },
      respond: vi.fn(),
      context,
      req: { type: "req", id: "sg-upsert-offline-1", method: "neuro.suggestion.upsert" },
      client: null,
      isWebchatConnect: noop,
    });

    await neuroHandlers["neuro.suggestion.action"]({
      params: {
        sessionKey: "agent:main:main",
        suggestionId: "sg-offline-1",
        action: "apply",
      },
      respond,
      context,
      req: { type: "req", id: "sg-apply-offline-1", method: "neuro.suggestion.action" },
      client: null,
      isWebchatConnect: noop,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        status: "fallback",
        policy: expect.objectContaining({
          allowed: true,
        }),
        fallback: expect.objectContaining({
          kind: "offline",
        }),
      }),
      undefined,
    );
  });

  it("blocks flow apply when flow mode is disabled", async () => {
    const context = makeContext();
    const respond = vi.fn();
    await neuroHandlers["neuro.suggestion.upsert"]({
      params: {
        card: {
          ...buildSuggestionCard({ suggestionId: "sg-flow-deny" }),
          mode: "flow",
        },
      },
      respond: vi.fn(),
      context,
      req: { type: "req", id: "sg-upsert-flow-deny", method: "neuro.suggestion.upsert" },
      client: null,
      isWebchatConnect: noop,
    });

    await neuroHandlers["neuro.suggestion.action"]({
      params: {
        sessionKey: "agent:main:main",
        suggestionId: "sg-flow-deny",
        action: "apply",
      },
      respond,
      context,
      req: { type: "req", id: "sg-apply-flow-deny", method: "neuro.suggestion.action" },
      client: null,
      isWebchatConnect: noop,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        status: "fallback",
        policy: expect.objectContaining({
          code: "DENY_FLOW_DISABLED",
        }),
      }),
      undefined,
    );
  });

  it("blocks hard deny operations in apply path", async () => {
    const context = makeContext();
    const respond = vi.fn();
    await neuroHandlers["neuro.suggestion.upsert"]({
      params: {
        card: buildSuggestionCard({ suggestionId: "sg-hard-deny" }),
      },
      respond: vi.fn(),
      context,
      req: { type: "req", id: "sg-upsert-hard-deny", method: "neuro.suggestion.upsert" },
      client: null,
      isWebchatConnect: noop,
    });

    await neuroHandlers["neuro.suggestion.action"]({
      params: {
        sessionKey: "agent:main:main",
        suggestionId: "sg-hard-deny",
        action: "apply",
        operation: "drop_database",
      },
      respond,
      context,
      req: { type: "req", id: "sg-apply-hard-deny", method: "neuro.suggestion.action" },
      client: null,
      isWebchatConnect: noop,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        status: "fallback",
        policy: expect.objectContaining({
          code: "DENY_HARD_LIST",
        }),
      }),
      undefined,
    );
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
