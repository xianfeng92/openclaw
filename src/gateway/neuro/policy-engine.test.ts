import { describe, expect, it } from "vitest";
import type { SuggestionCard } from "../protocol/schema/types.js";
import { createNeuroPolicyEngine } from "./policy-engine.js";

function card(mode: SuggestionCard["mode"]): SuggestionCard {
  return {
    version: "suggestion.card.v1",
    suggestionId: "sg-policy",
    sessionKey: "agent:main:main",
    confidence: 0.9,
    mode,
    actions: ["apply", "dismiss", "undo", "explain"],
    expiresAt: Date.now() + 30_000,
  };
}

describe("createNeuroPolicyEngine", () => {
  it("denies apply when kill switch is enabled", () => {
    const policy = createNeuroPolicyEngine();
    const decision = policy.evaluate({
      action: "apply",
      card: card("safe"),
      effectiveFlags: { flowMode: true, killSwitch: true },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("DENY_KILL_SWITCH");
  });

  it("denies flow apply when flow mode is disabled", () => {
    const policy = createNeuroPolicyEngine();
    const decision = policy.evaluate({
      action: "apply",
      card: card("flow"),
      effectiveFlags: { flowMode: false, killSwitch: false },
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("DENY_FLOW_DISABLED");
  });

  it("denies hard-listed operations", () => {
    const policy = createNeuroPolicyEngine({ hardDenyOperations: ["drop_database"] });
    const decision = policy.evaluate({
      action: "apply",
      card: card("safe"),
      effectiveFlags: { flowMode: true, killSwitch: false },
      operation: "drop_database",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe("DENY_HARD_LIST");
  });

  it("allows safe apply when policy checks pass", () => {
    const policy = createNeuroPolicyEngine();
    const decision = policy.evaluate({
      action: "apply",
      card: card("safe"),
      effectiveFlags: { flowMode: false, killSwitch: false },
      operation: "edit_file",
    });
    expect(decision.allowed).toBe(true);
    expect(decision.code).toBe("ALLOW");
  });
});
