import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNeuroBehavioralStore } from "./behavioral-store.js";
import {
  buildPredictionPatternKey,
  createNeuroPredictionEngine,
  normalizePredictionSignal,
} from "./prediction-engine.js";

const tempDirs: string[] = [];
const openStores: Array<{ close: () => void }> = [];

function makeDbPath(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-neuro-predict-"));
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

describe("createNeuroPredictionEngine", () => {
  it("ignores too-short signals", () => {
    const store = createNeuroBehavioralStore({ dbPath: makeDbPath("short") });
    openStores.push(store);
    const engine = createNeuroPredictionEngine({ behavioralStore: store, minSignalChars: 5 });
    const decision = engine.predict({
      sessionKey: "agent:main:main",
      source: "clipboard",
      signal: "fix",
    });
    expect(decision.action).toBe("ignore");
    expect(decision.reasonCodes).toContain("SIGNAL_TOO_SHORT");
  });

  it("uses similarity lookup and preference to escalate to auto_apply", () => {
    const store = createNeuroBehavioralStore({ dbPath: makeDbPath("auto") });
    openStores.push(store);
    const engine = createNeuroPredictionEngine({ behavioralStore: store });
    const patternKey = buildPredictionPatternKey("terminal", "pnpm test failing on type error");

    for (let i = 0; i < 5; i += 1) {
      const ts = 10_000 + i;
      store.recordSuggestion({
        card: {
          version: "suggestion.card.v1",
          suggestionId: patternKey,
          sessionKey: "agent:main:main",
          confidence: 0.8,
          mode: "safe",
          actions: ["apply", "dismiss", "undo", "explain"],
          expiresAt: ts + 60_000,
        },
        nowMs: ts,
      });
      store.recordFeedback({
        feedback: {
          version: "suggestion.feedback.v1",
          suggestionId: patternKey,
          sessionKey: "agent:main:main",
          action: "accept",
          ts,
        },
        nowMs: ts,
      });
    }

    const decision = engine.predict({
      sessionKey: "agent:main:main",
      source: "terminal",
      signal: "pnpm   test failing  on type error",
      nowMs: 20_000,
    });

    expect(decision.normalizedSignal).toBe("pnpm test failing on type error");
    expect(decision.action).toBe("auto_apply");
    expect(decision.similarCount).toBeGreaterThanOrEqual(5);
    expect(decision.acceptRate).toBeGreaterThanOrEqual(0.8);
  });

  it("suppresses repeated predictions within suppression window", () => {
    const store = createNeuroBehavioralStore({ dbPath: makeDbPath("suppress") });
    openStores.push(store);
    const engine = createNeuroPredictionEngine({
      behavioralStore: store,
      suppressionWindowMs: 60_000,
    });

    const first = engine.predict({
      sessionKey: "agent:main:main",
      source: "clipboard",
      signal: "typescript no overload matches this call",
      nowMs: 100_000,
    });
    expect(first.action).toBe("suggest");
    expect(first.suppressed).toBe(false);

    const second = engine.predict({
      sessionKey: "agent:main:main",
      source: "clipboard",
      signal: "TypeScript   no overload matches this call",
      nowMs: 100_500,
    });
    expect(second.action).toBe("ignore");
    expect(second.suppressed).toBe(true);
    expect(second.reasonCodes).toContain("SUPPRESSED_RECENT_SIGNAL");
  });

  it("normalizes prediction signals deterministically", () => {
    expect(normalizePredictionSignal("  A   B  C  ")).toBe("a b c");
  });
});
