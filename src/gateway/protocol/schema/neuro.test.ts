import AjvPkg from "ajv";
import { describe, expect, it } from "vitest";
import {
  ContextEventSchema,
  NeuroContextIngestParamsSchema,
  NeuroSuggestionActionParamsSchema,
  NeuroSuggestionActionResultSchema,
  NeuroBehaviorDeleteParamsSchema,
  NeuroBehaviorDeleteResultSchema,
  NeuroBehaviorExportParamsSchema,
  NeuroBehaviorExportResultSchema,
  NeuroBehaviorRetentionRunParamsSchema,
  NeuroBehaviorRetentionRunResultSchema,
  NeuroPredictPreviewParamsSchema,
  NeuroPredictPreviewResultSchema,
  NeuroSuggestionListParamsSchema,
  NeuroSuggestionListResultSchema,
  NeuroSuggestionUpsertParamsSchema,
  NeuroSuggestionUpsertResultSchema,
  NeuroContextSnapshotParamsSchema,
  NeuroContextSnapshotResultSchema,
  NeuroFlagsGetParamsSchema,
  NeuroFlagsGetResultSchema,
  NeuroFlagsSetParamsSchema,
  NeuroMetricsGetParamsSchema,
  NeuroMetricsGetResultSchema,
  NeuroMetricsObserveParamsSchema,
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

  it("validates neuro.suggestion.upsert params/result", () => {
    const validateParams = ajv.compile(NeuroSuggestionUpsertParamsSchema);
    const validateResult = ajv.compile(NeuroSuggestionUpsertResultSchema);
    const params = {
      card: {
        version: "suggestion.card.v1",
        suggestionId: "sg-upsert-1",
        sessionKey: "agent:main:main",
        confidence: 0.81,
        mode: "safe",
        actions: ["apply", "dismiss", "undo", "explain"],
        expiresAt: 1_770_000_111_000,
      },
    };
    const result = {
      sessionKey: "agent:main:main",
      suggestionId: "sg-upsert-1",
      inserted: true,
      replaced: false,
    };
    expect(validateParams(params)).toBe(true);
    expect(validateResult(result)).toBe(true);
  });

  it("validates neuro.suggestion.list params/result", () => {
    const validateParams = ajv.compile(NeuroSuggestionListParamsSchema);
    const validateResult = ajv.compile(NeuroSuggestionListResultSchema);
    expect(validateParams({ sessionKey: "agent:main:main" })).toBe(true);
    expect(
      validateResult({
        sessionKey: "agent:main:main",
        total: 1,
        cards: [
          {
            version: "suggestion.card.v1",
            suggestionId: "sg-list-1",
            sessionKey: "agent:main:main",
            confidence: 0.7,
            mode: "flow",
            actions: ["apply", "undo"],
            expiresAt: 1_770_000_222_000,
          },
        ],
      }),
    ).toBe(true);
  });

  it("validates neuro.suggestion.action params/result", () => {
    const validateParams = ajv.compile(NeuroSuggestionActionParamsSchema);
    const validateResult = ajv.compile(NeuroSuggestionActionResultSchema);
    expect(
      validateParams({
        sessionKey: "agent:main:main",
        suggestionId: "sg-action-1",
        action: "apply",
        operation: "edit_file",
        groupId: "group-1",
        snapshots: [
          {
            kind: "file_write",
            target: "README.md",
            before: "a",
            after: "b",
          },
        ],
      }),
    ).toBe(true);

    expect(
      validateResult({
        sessionKey: "agent:main:main",
        suggestionId: "sg-action-1",
        action: "apply",
        status: "applied",
        message: "Suggestion applied.",
        undoUntilMs: 1_770_000_333_000,
        journalId: "undo-1",
        groupId: "group-1",
        policy: {
          allowed: true,
          code: "ALLOW",
          reason: "Action passes safe/flow policy checks.",
        },
        feedback: {
          version: "suggestion.feedback.v1",
          suggestionId: "sg-action-1",
          action: "accept",
          ts: 1_770_000_300_000,
          sessionKey: "agent:main:main",
        },
      }),
    ).toBe(true);
  });

  it("validates neuro.behavior.export params/result", () => {
    const validateParams = ajv.compile(NeuroBehaviorExportParamsSchema);
    const validateResult = ajv.compile(NeuroBehaviorExportResultSchema);
    expect(
      validateParams({
        sessionKey: "agent:main:main",
        fromTs: 1_770_000_000_000,
        toTs: 1_770_000_500_000,
        limit: 100,
        includePreferences: true,
      }),
    ).toBe(true);

    expect(
      validateResult({
        exportedAtMs: 1_770_000_999_000,
        events: [
          {
            id: "evt-1",
            ts: 1_770_000_100_000,
            sessionKey: "agent:main:main",
            type: "feedback",
            patternHash: "abcd",
            suggestionId: "sg-1",
            mode: null,
            userAction: "accept",
            confidence: null,
            workspace: null,
            filePath: null,
            appName: null,
            metadata: { status: "applied" },
          },
        ],
        preferences: [
          {
            patternHash: "abcd",
            preference: "suggest",
            score: 0.5,
            updatedAtMs: 1_770_000_100_000,
          },
        ],
      }),
    ).toBe(true);
  });

  it("validates neuro.behavior.delete params/result", () => {
    const validateParams = ajv.compile(NeuroBehaviorDeleteParamsSchema);
    const validateResult = ajv.compile(NeuroBehaviorDeleteResultSchema);
    expect(
      validateParams({
        sessionKey: "agent:main:main",
        beforeTs: 1_770_000_200_000,
        deletePreferences: true,
      }),
    ).toBe(true);
    expect(
      validateResult({
        deletedEvents: 12,
        deletedPreferences: 2,
        remainingEvents: 3,
        remainingPreferences: 1,
      }),
    ).toBe(true);
  });

  it("validates neuro.behavior.retention.run params/result", () => {
    const validateParams = ajv.compile(NeuroBehaviorRetentionRunParamsSchema);
    const validateResult = ajv.compile(NeuroBehaviorRetentionRunResultSchema);
    expect(validateParams({ nowMs: 1_770_001_000_000, dryRun: true })).toBe(true);
    expect(
      validateResult({
        cutoffTs: 1_769_000_000_000,
        deletedEvents: 44,
        remainingEvents: 9,
        retentionDays: 30,
        dryRun: true,
      }),
    ).toBe(true);
  });

  it("validates neuro.predict.preview params/result", () => {
    const validateParams = ajv.compile(NeuroPredictPreviewParamsSchema);
    const validateResult = ajv.compile(NeuroPredictPreviewResultSchema);
    expect(
      validateParams({
        sessionKey: "agent:main:main",
        source: "terminal",
        signal: "pnpm test",
      }),
    ).toBe(true);
    expect(
      validateResult({
        sessionKey: "agent:main:main",
        source: "terminal",
        signal: "pnpm test",
        normalizedSignal: "pnpm test",
        patternKey: "terminal:pnpm test",
        patternHash: "abcd",
        action: "suggest",
        suppressed: false,
        confidence: 0.55,
        similarCount: 3,
        acceptRate: 0.66,
        reasonCodes: ["SIMILAR_HISTORY"],
        preference: "suggest",
        lastEventTs: 1_770_000_000_000,
      }),
    ).toBe(true);
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

  it("validates neuro.flags.get params", () => {
    const validate = ajv.compile(NeuroFlagsGetParamsSchema);
    expect(validate({})).toBe(true);
  });

  it("validates neuro.flags.get result", () => {
    const validate = ajv.compile(NeuroFlagsGetResultSchema);
    expect(
      validate({
        version: 2,
        updatedAtMs: 1_770_000_000_000,
        configured: {
          proactiveCards: true,
          flowMode: true,
          preferenceSync: false,
          killSwitch: false,
        },
        effective: {
          proactiveCards: true,
          flowMode: true,
          preferenceSync: false,
          killSwitch: false,
        },
      }),
    ).toBe(true);
  });

  it("rejects neuro.flags.set params with empty patch", () => {
    const validate = ajv.compile(NeuroFlagsSetParamsSchema);
    expect(validate({})).toBe(false);
  });

  it("validates neuro.flags.set params with patch", () => {
    const validate = ajv.compile(NeuroFlagsSetParamsSchema);
    expect(validate({ proactiveCards: true, killSwitch: false })).toBe(true);
  });

  it("validates neuro.metrics.get params", () => {
    const validate = ajv.compile(NeuroMetricsGetParamsSchema);
    expect(validate({})).toBe(true);
  });

  it("validates neuro.metrics.observe params", () => {
    const validate = ajv.compile(NeuroMetricsObserveParamsSchema);
    expect(validate({ uiReadyMs: 42, desktopMemoryMb: 120.5 })).toBe(true);
  });

  it("rejects neuro.metrics.observe params when payload is empty", () => {
    const validate = ajv.compile(NeuroMetricsObserveParamsSchema);
    expect(validate({})).toBe(false);
  });

  it("validates neuro.metrics.get result", () => {
    const validate = ajv.compile(NeuroMetricsGetResultSchema);
    expect(
      validate({
        ts: 1_770_000_000_000,
        invoke: {
          uiReadyMs: { count: 1, min: 50, max: 50, avg: 50, p50: 50, p95: 50 },
          firstTokenMs: { count: 0, min: null, max: null, avg: null, p50: null, p95: null },
        },
        memory: {
          gatewayMb: {
            rss: 100.2,
            heapUsed: 40.1,
            heapTotal: 80.2,
            external: 3.5,
          },
          desktopMb: 155.3,
          desktopUpdatedAtMs: 1_770_000_000_000,
        },
        redaction: {
          maskCount: 2,
          blockCount: 1,
        },
      }),
    ).toBe(true);
  });
});
