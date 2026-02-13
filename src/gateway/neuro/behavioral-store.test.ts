import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SuggestionCard, SuggestionFeedback } from "../protocol/schema/types.js";
import { createNeuroBehavioralStore } from "./behavioral-store.js";

function makeSuggestion(params: {
  suggestionId: string;
  sessionKey?: string;
  confidence?: number;
  mode?: SuggestionCard["mode"];
  ts?: number;
}): { card: SuggestionCard; feedback: SuggestionFeedback } {
  const ts = params.ts ?? 1_000;
  const suggestionId = params.suggestionId;
  const sessionKey = params.sessionKey ?? "agent:main:main";
  return {
    card: {
      version: "suggestion.card.v1",
      suggestionId,
      sessionKey,
      confidence: params.confidence ?? 0.8,
      mode: params.mode ?? "safe",
      actions: ["apply", "dismiss", "undo", "explain"],
      expiresAt: ts + 60_000,
    },
    feedback: {
      version: "suggestion.feedback.v1",
      suggestionId,
      sessionKey,
      action: "accept",
      ts,
    },
  };
}

const tempDirs: string[] = [];
const openStores: Array<{ close: () => void }> = [];

function makeDbPath(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-neuro-behavior-"));
  tempDirs.push(dir);
  return path.join(dir, `${name}.db`);
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

describe("createNeuroBehavioralStore", () => {
  it("applies schema migration and supports write/read export", () => {
    let nowMs = 10_000;
    const store = createNeuroBehavioralStore({
      dbPath: makeDbPath("migration"),
      now: () => nowMs,
    });
    openStores.push(store);

    const suggestion = makeSuggestion({ suggestionId: "sg-1", ts: nowMs });
    store.recordSuggestion({ card: suggestion.card, nowMs });
    store.recordFeedback({ feedback: suggestion.feedback, nowMs });

    const stats = store.getStats();
    expect(stats.schemaVersion).toBe(1);
    expect(stats.totalEvents).toBe(2);
    expect(stats.totalPreferences).toBe(1);

    const exported = store.exportData({ sessionKey: "agent:main:main" });
    expect(exported.events).toHaveLength(2);
    expect(exported.events.some((event) => event.type === "suggestion")).toBe(true);
    expect(exported.events.some((event) => event.type === "feedback")).toBe(true);
    expect(exported.preferences).toHaveLength(1);

    store.close();
  });

  it("supports retention prune (dry-run and execute)", () => {
    let nowMs = 50 * 24 * 60 * 60 * 1000;
    const store = createNeuroBehavioralStore({
      dbPath: makeDbPath("retention"),
      now: () => nowMs,
      retentionDays: 30,
      pruneIntervalMs: 365 * 24 * 60 * 60 * 1000,
    });
    openStores.push(store);

    const oldSuggestion = makeSuggestion({
      suggestionId: "sg-old",
      ts: nowMs - 40 * 24 * 60 * 60 * 1000,
    });
    const freshSuggestion = makeSuggestion({
      suggestionId: "sg-fresh",
      ts: nowMs - 5 * 24 * 60 * 60 * 1000,
    });
    store.recordSuggestion({ card: oldSuggestion.card, nowMs: oldSuggestion.feedback.ts });
    store.recordSuggestion({ card: freshSuggestion.card, nowMs: freshSuggestion.feedback.ts });

    const dryRun = store.pruneExpiredEvents({ nowMs, dryRun: true });
    expect(dryRun.deletedEvents).toBe(1);
    expect(dryRun.remainingEvents).toBe(2);
    expect(dryRun.dryRun).toBe(true);

    const pruned = store.pruneExpiredEvents({ nowMs });
    expect(pruned.deletedEvents).toBe(1);
    expect(pruned.remainingEvents).toBe(1);
    expect(pruned.dryRun).toBe(false);

    store.close();
  });

  it("supports filtered export and delete endpoints behavior", () => {
    let nowMs = 100_000;
    const store = createNeuroBehavioralStore({
      dbPath: makeDbPath("delete"),
      now: () => nowMs,
    });
    openStores.push(store);

    const a = makeSuggestion({ suggestionId: "sg-a", sessionKey: "agent:main:main", ts: nowMs });
    const b = makeSuggestion({ suggestionId: "sg-b", sessionKey: "agent:main:alt", ts: nowMs + 1 });
    store.recordSuggestion({ card: a.card, nowMs: nowMs });
    store.recordFeedback({ feedback: a.feedback, nowMs: nowMs + 1 });
    store.recordSuggestion({ card: b.card, nowMs: nowMs + 2 });

    const exportedMain = store.exportData({ sessionKey: "agent:main:main" });
    expect(exportedMain.events.every((event) => event.sessionKey === "agent:main:main")).toBe(true);

    const deleted = store.deleteData({ sessionKey: "agent:main:main", deletePreferences: true });
    expect(deleted.deletedEvents).toBe(2);
    expect(deleted.deletedPreferences).toBe(1);
    expect(deleted.remainingEvents).toBe(1);

    store.close();
  });
});
