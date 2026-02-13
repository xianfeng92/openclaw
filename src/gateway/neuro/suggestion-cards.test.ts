import { describe, expect, it } from "vitest";
import type { SuggestionCard } from "../protocol/schema/types.js";
import { createNeuroSuggestionCards } from "./suggestion-cards.js";

function buildCard(params: {
  suggestionId: string;
  sessionKey?: string;
  expiresAt: number;
}): SuggestionCard {
  return {
    version: "suggestion.card.v1",
    suggestionId: params.suggestionId,
    sessionKey: params.sessionKey ?? "agent:main:main",
    confidence: 0.8,
    mode: "safe",
    actions: ["apply", "dismiss", "undo", "explain"],
    expiresAt: params.expiresAt,
  };
}

describe("createNeuroSuggestionCards", () => {
  it("stores cards per session and prunes expired entries", () => {
    let nowMs = 1_000;
    const store = createNeuroSuggestionCards({ now: () => nowMs });

    store.upsert(buildCard({ suggestionId: "s1", expiresAt: 2_000 }));
    store.upsert(buildCard({ suggestionId: "s2", expiresAt: 4_000 }));

    const initial = store.list("agent:main:main");
    expect(initial.cards.map((card) => card.suggestionId)).toEqual(["s1", "s2"]);
    expect(initial.expiredRemoved).toBe(0);

    nowMs = 2_100;
    const afterExpiry = store.list("agent:main:main");
    expect(afterExpiry.cards.map((card) => card.suggestionId)).toEqual(["s2"]);
    expect(afterExpiry.expiredRemoved).toBe(1);
  });

  it("tracks apply and undo window", () => {
    let nowMs = 1_000;
    const store = createNeuroSuggestionCards({ now: () => nowMs, undoWindowMs: 500 });
    store.upsert(buildCard({ suggestionId: "s-undo", expiresAt: 10_000 }));

    const applied = store.markApplied("agent:main:main", "s-undo");
    expect(applied).toEqual({ undoUntilMs: 1_500 });

    nowMs = 1_400;
    expect(store.undo("agent:main:main", "s-undo")).toBe(true);

    nowMs = 1_450;
    store.markApplied("agent:main:main", "s-undo");
    nowMs = 2_001;
    expect(store.undo("agent:main:main", "s-undo")).toBe(false);
  });

  it("isolates suggestions by session key", () => {
    const store = createNeuroSuggestionCards({ now: () => 1_000 });
    store.upsert(
      buildCard({
        suggestionId: "s-main",
        sessionKey: "agent:main:main",
        expiresAt: 10_000,
      }),
    );
    store.upsert(
      buildCard({
        suggestionId: "s-alt",
        sessionKey: "agent:main:alt",
        expiresAt: 10_000,
      }),
    );

    expect(store.list("agent:main:main").cards.map((card) => card.suggestionId)).toEqual([
      "s-main",
    ]);
    expect(store.list("agent:main:alt").cards.map((card) => card.suggestionId)).toEqual(["s-alt"]);
  });
});
