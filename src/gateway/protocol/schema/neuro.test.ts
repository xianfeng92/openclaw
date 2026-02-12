import AjvPkg from "ajv";
import { describe, expect, it } from "vitest";
import {
  ContextEventSchema,
  NeuroContextIngestParamsSchema,
  NeuroContextSnapshotParamsSchema,
  NeuroContextSnapshotResultSchema,
  SuggestionCardSchema,
  SuggestionFeedbackSchema,
} from "./neuro.js";

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

  it("validates neuro.context.ingest params", () => {
    const validate = ajv.compile(NeuroContextIngestParamsSchema);
    const payload = {
      events: [
        {
          version: "context.event.v1",
          eventId: "evt-100",
          ts: 1_770_000_000_000,
          sessionKey: "agent:main:main",
          source: "clipboard",
          payload: { text: "hello" },
          redaction: {
            applied: false,
            level: "none",
            reasons: [],
          },
          bounds: {
            bytes: 5,
            dropped: false,
          },
        },
      ],
    };
    expect(validate(payload)).toBe(true);
  });

  it("rejects neuro.context.ingest params when events are missing", () => {
    const validate = ajv.compile(NeuroContextIngestParamsSchema);
    expect(validate({})).toBe(false);
  });

  it("validates neuro.context.snapshot params", () => {
    const validate = ajv.compile(NeuroContextSnapshotParamsSchema);
    expect(
      validate({
        sessionKey: "agent:main:main",
        includeEvents: true,
        maxEvents: 200,
      }),
    ).toBe(true);
  });

  it("validates neuro.context.snapshot result", () => {
    const validate = ajv.compile(NeuroContextSnapshotResultSchema);
    const payload = {
      sessionKey: "agent:main:main",
      totalBytes: 128,
      totalEvents: 1,
      returnedEvents: 1,
      events: [
        {
          version: "context.event.v1",
          eventId: "evt-101",
          ts: 1_770_000_000_000,
          sessionKey: "agent:main:main",
          source: "active_window",
          payload: { app: "Code", title: "README.md" },
          redaction: {
            applied: false,
            level: "none",
            reasons: [],
          },
          bounds: {
            bytes: 28,
            dropped: false,
          },
        },
      ],
      perSource: {
        clipboard: { count: 0, bytes: 0, latestTs: null },
        active_window: { count: 1, bytes: 128, latestTs: 1_770_000_000_000 },
        terminal: { count: 0, bytes: 0, latestTs: null },
        fs: { count: 0, bytes: 0, latestTs: null },
        editor: { count: 0, bytes: 0, latestTs: null },
      },
    };
    expect(validate(payload)).toBe(true);
  });
});
