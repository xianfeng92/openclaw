import { Type } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

const ContextSourceSchema = Type.Union([
  Type.Literal("clipboard"),
  Type.Literal("active_window"),
  Type.Literal("terminal"),
  Type.Literal("fs"),
  Type.Literal("editor"),
]);

const RedactionLevelSchema = Type.Union([
  Type.Literal("none"),
  Type.Literal("mask"),
  Type.Literal("hash"),
  Type.Literal("block"),
]);

const SuggestionActionSchema = Type.Union([
  Type.Literal("apply"),
  Type.Literal("dismiss"),
  Type.Literal("undo"),
  Type.Literal("explain"),
]);

const FeedbackActionSchema = Type.Union([
  Type.Literal("accept"),
  Type.Literal("dismiss"),
  Type.Literal("modify"),
  Type.Literal("ignore"),
]);

const PerSourceSnapshotStatsSchema = Type.Object(
  {
    count: Type.Integer({ minimum: 0 }),
    bytes: Type.Integer({ minimum: 0 }),
    latestTs: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  },
  { additionalProperties: false },
);

export const ContextEventSchema = Type.Object(
  {
    version: Type.Literal("context.event.v1"),
    eventId: NonEmptyString,
    ts: Type.Integer({ minimum: 0 }),
    sessionKey: NonEmptyString,
    source: ContextSourceSchema,
    payload: Type.Record(Type.String(), Type.Unknown()),
    redaction: Type.Object(
      {
        applied: Type.Boolean(),
        level: RedactionLevelSchema,
        reasons: Type.Array(Type.String()),
      },
      { additionalProperties: false },
    ),
    bounds: Type.Object(
      {
        bytes: Type.Integer({ minimum: 0 }),
        dropped: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const SuggestionCardSchema = Type.Object(
  {
    version: Type.Literal("suggestion.card.v1"),
    suggestionId: NonEmptyString,
    sessionKey: NonEmptyString,
    confidence: Type.Number({ minimum: 0, maximum: 1 }),
    mode: Type.Union([Type.Literal("safe"), Type.Literal("flow")]),
    actions: Type.Array(SuggestionActionSchema, {
      minItems: 1,
      uniqueItems: true,
    }),
    expiresAt: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const SuggestionFeedbackSchema = Type.Object(
  {
    version: Type.Literal("suggestion.feedback.v1"),
    suggestionId: NonEmptyString,
    action: FeedbackActionSchema,
    ts: Type.Integer({ minimum: 0 }),
    sessionKey: NonEmptyString,
  },
  { additionalProperties: false },
);

export const NeuroContextIngestParamsSchema = Type.Object(
  {
    events: Type.Array(ContextEventSchema, {
      minItems: 1,
      maxItems: 256,
    }),
  },
  { additionalProperties: false },
);

export const NeuroContextIngestResultSchema = Type.Object(
  {
    acceptedEvents: Type.Integer({ minimum: 0 }),
    droppedEvents: Type.Integer({ minimum: 0 }),
    cache: Type.Object(
      {
        sessions: Type.Integer({ minimum: 0 }),
        totalEvents: Type.Integer({ minimum: 0 }),
        totalBytes: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const NeuroContextSnapshotParamsSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    includeEvents: Type.Optional(Type.Boolean()),
    maxEvents: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
  },
  { additionalProperties: false },
);

export const NeuroContextSnapshotResultSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    totalBytes: Type.Integer({ minimum: 0 }),
    totalEvents: Type.Integer({ minimum: 0 }),
    returnedEvents: Type.Integer({ minimum: 0 }),
    events: Type.Array(ContextEventSchema),
    perSource: Type.Object(
      {
        clipboard: PerSourceSnapshotStatsSchema,
        active_window: PerSourceSnapshotStatsSchema,
        terminal: PerSourceSnapshotStatsSchema,
        fs: PerSourceSnapshotStatsSchema,
        editor: PerSourceSnapshotStatsSchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const NeuroFeatureFlagsStateSchema = Type.Object(
  {
    proactiveCards: Type.Boolean(),
    flowMode: Type.Boolean(),
    preferenceSync: Type.Boolean(),
    killSwitch: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const NeuroFlagsSnapshotSchema = Type.Object(
  {
    version: Type.Integer({ minimum: 1 }),
    updatedAtMs: Type.Integer({ minimum: 0 }),
    configured: NeuroFeatureFlagsStateSchema,
    effective: NeuroFeatureFlagsStateSchema,
  },
  { additionalProperties: false },
);

export const NeuroFlagsGetParamsSchema = Type.Object({}, { additionalProperties: false });

export const NeuroFlagsGetResultSchema = NeuroFlagsSnapshotSchema;

export const NeuroFlagsSetParamsSchema = Type.Object(
  {
    proactiveCards: Type.Optional(Type.Boolean()),
    flowMode: Type.Optional(Type.Boolean()),
    preferenceSync: Type.Optional(Type.Boolean()),
    killSwitch: Type.Optional(Type.Boolean()),
  },
  {
    additionalProperties: false,
    minProperties: 1,
  },
);

export const NeuroFlagsSetResultSchema = NeuroFlagsSnapshotSchema;

const NeuroDistributionStatsSchema = Type.Object(
  {
    count: Type.Integer({ minimum: 0 }),
    min: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
    max: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
    avg: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
    p50: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
    p95: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  },
  { additionalProperties: false },
);

export const NeuroMetricsSnapshotSchema = Type.Object(
  {
    ts: Type.Integer({ minimum: 0 }),
    invoke: Type.Object(
      {
        uiReadyMs: NeuroDistributionStatsSchema,
        firstTokenMs: NeuroDistributionStatsSchema,
      },
      { additionalProperties: false },
    ),
    memory: Type.Object(
      {
        gatewayMb: Type.Object(
          {
            rss: Type.Number({ minimum: 0 }),
            heapUsed: Type.Number({ minimum: 0 }),
            heapTotal: Type.Number({ minimum: 0 }),
            external: Type.Number({ minimum: 0 }),
          },
          { additionalProperties: false },
        ),
        desktopMb: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
        desktopUpdatedAtMs: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
      },
      { additionalProperties: false },
    ),
    redaction: Type.Object(
      {
        maskCount: Type.Integer({ minimum: 0 }),
        blockCount: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const NeuroMetricsGetParamsSchema = Type.Object({}, { additionalProperties: false });

export const NeuroMetricsGetResultSchema = NeuroMetricsSnapshotSchema;

export const NeuroMetricsObserveParamsSchema = Type.Object(
  {
    uiReadyMs: Type.Optional(Type.Number({ minimum: 0 })),
    desktopMemoryMb: Type.Optional(Type.Number({ minimum: 0 })),
  },
  {
    additionalProperties: false,
    minProperties: 1,
  },
);

export const NeuroMetricsObserveResultSchema = NeuroMetricsSnapshotSchema;
