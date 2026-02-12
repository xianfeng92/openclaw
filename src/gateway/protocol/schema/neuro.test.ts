import AjvPkg from "ajv";
import { describe, expect, it } from "vitest";
import { ContextEventSchema, SuggestionCardSchema, SuggestionFeedbackSchema } from "./neuro.js";

const ajv = new (AjvPkg as unknown as new (opts?: object) => import("ajv").default)({
  allErrors: true,
  strict: false,
  removeAdditional: false,
});

describe("neuro schemas", () => {
  it("validates context.event.v1 payload", () => {
    const validate = ajv.compile(ContextEventSchema);
    const payload = {
      version: "context.event.v1",
      eventId: "evt-1",
      ts: 1_770_000_000_000,
      sessionKey: "agent:main:main",
      source: "clipboard",
      payload: {
        text: "npm test failed",
        mimeType: "text/plain",
      },
      redaction: {
        applied: true,
        level: "mask",
        reasons: ["api_key_pattern"],
      },
      bounds: {
        bytes: 128,
        dropped: false,
      },
    };
    expect(validate(payload)).toBe(true);
  });

  it("rejects context.event.v1 when required fields are missing", () => {
    const validate = ajv.compile(ContextEventSchema);
    const payload = {
      version: "context.event.v1",
      eventId: "evt-2",
      ts: 1_770_000_000_000,
      sessionKey: "agent:main:main",
      source: "clipboard",
      payload: {},
      bounds: {
        bytes: 42,
        dropped: false,
      },
    };
    expect(validate(payload)).toBe(false);
  });

  it("validates suggestion.card.v1 payload", () => {
    const validate = ajv.compile(SuggestionCardSchema);
    const payload = {
      version: "suggestion.card.v1",
      suggestionId: "sg-1",
      sessionKey: "agent:main:main",
      confidence: 0.82,
      mode: "safe",
      actions: ["apply", "dismiss", "undo", "explain"],
      expiresAt: 1_770_000_030_000,
    };
    expect(validate(payload)).toBe(true);
  });

  it("rejects suggestion.card.v1 invalid confidence", () => {
    const validate = ajv.compile(SuggestionCardSchema);
    const payload = {
      version: "suggestion.card.v1",
      suggestionId: "sg-2",
      sessionKey: "agent:main:main",
      confidence: 1.2,
      mode: "safe",
      actions: ["apply"],
      expiresAt: 1_770_000_030_000,
    };
    expect(validate(payload)).toBe(false);
  });

  it("validates suggestion.feedback.v1 payload", () => {
    const validate = ajv.compile(SuggestionFeedbackSchema);
    const payload = {
      version: "suggestion.feedback.v1",
      suggestionId: "sg-1",
      action: "accept",
      ts: 1_770_000_001_111,
      sessionKey: "agent:main:main",
    };
    expect(validate(payload)).toBe(true);
  });

  it("rejects suggestion.feedback.v1 unknown action", () => {
    const validate = ajv.compile(SuggestionFeedbackSchema);
    const payload = {
      version: "suggestion.feedback.v1",
      suggestionId: "sg-1",
      action: "approve",
      ts: 1_770_000_001_111,
      sessionKey: "agent:main:main",
    };
    expect(validate(payload)).toBe(false);
  });
});
