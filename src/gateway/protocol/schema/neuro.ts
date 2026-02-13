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

const SuggestionActionStatusSchema = Type.Union([
  Type.Literal("applied"),
  Type.Literal("dismissed"),
  Type.Literal("undone"),
  Type.Literal("explained"),
  Type.Literal("fallback"),
]);

const SuggestionFallbackKindSchema = Type.Union([
  Type.Literal("offline"),
  Type.Literal("provider"),
  Type.Literal("unavailable"),
]);

const SuggestionActionFallbackSchema = Type.Object(
  {
    kind: SuggestionFallbackKindSchema,
    retryable: Type.Boolean(),
    message: NonEmptyString,
  },
  { additionalProperties: false },
);

const NeuroActionSnapshotSchema = Type.Object(
  {
    snapshotId: Type.Optional(NonEmptyString),
    kind: NonEmptyString,
    target: NonEmptyString,
    before: Type.Optional(Type.Unknown()),
    after: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);

const SuggestionPolicyDecisionSchema = Type.Object(
  {
    allowed: Type.Boolean(),
    code: NonEmptyString,
    reason: NonEmptyString,
  },
  { additionalProperties: false },
);

const NeuroBehaviorEventTypeSchema = Type.Union([
  Type.Literal("suggestion"),
  Type.Literal("feedback"),
]);

const NeuroPreferenceSchema = Type.Union([
  Type.Literal("auto_apply"),
  Type.Literal("suggest"),
  Type.Literal("ignore"),
]);

const NeuroBehaviorEventSchema = Type.Object(
  {
    id: NonEmptyString,
    ts: Type.Integer({ minimum: 0 }),
    sessionKey: NonEmptyString,
    type: NeuroBehaviorEventTypeSchema,
    patternHash: NonEmptyString,
    suggestionId: Type.Union([NonEmptyString, Type.Null()]),
    mode: Type.Union([Type.Literal("safe"), Type.Literal("flow"), Type.Null()]),
    userAction: Type.Union([FeedbackActionSchema, Type.Null()]),
    confidence: Type.Union([Type.Number({ minimum: 0, maximum: 1 }), Type.Null()]),
    workspace: Type.Union([Type.String(), Type.Null()]),
    filePath: Type.Union([Type.String(), Type.Null()]),
    appName: Type.Union([Type.String(), Type.Null()]),
    metadata: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
);

const NeuroBehaviorPreferenceSchema = Type.Object(
  {
    patternHash: NonEmptyString,
    preference: NeuroPreferenceSchema,
    score: Type.Number(),
    updatedAtMs: Type.Integer({ minimum: 0 }),
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

export const NeuroSuggestionUpsertParamsSchema = Type.Object(
  {
    card: SuggestionCardSchema,
  },
  { additionalProperties: false },
);

export const NeuroSuggestionUpsertResultSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    suggestionId: NonEmptyString,
    inserted: Type.Boolean(),
    replaced: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const NeuroSuggestionListParamsSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
  },
  { additionalProperties: false },
);

export const NeuroSuggestionListResultSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    total: Type.Integer({ minimum: 0 }),
    cards: Type.Array(SuggestionCardSchema),
  },
  { additionalProperties: false },
);

export const NeuroSuggestionActionParamsSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    suggestionId: NonEmptyString,
    action: SuggestionActionSchema,
    operation: Type.Optional(NonEmptyString),
    groupId: Type.Optional(NonEmptyString),
    snapshots: Type.Optional(Type.Array(NeuroActionSnapshotSchema, { maxItems: 64 })),
  },
  { additionalProperties: false },
);

export const NeuroSuggestionActionResultSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    suggestionId: NonEmptyString,
    action: SuggestionActionSchema,
    status: SuggestionActionStatusSchema,
    message: NonEmptyString,
    undoUntilMs: Type.Optional(Type.Integer({ minimum: 0 })),
    journalId: Type.Optional(NonEmptyString),
    groupId: Type.Optional(NonEmptyString),
    policy: Type.Optional(SuggestionPolicyDecisionSchema),
    feedback: SuggestionFeedbackSchema,
    fallback: Type.Optional(SuggestionActionFallbackSchema),
  },
  { additionalProperties: false },
);

export const NeuroBehaviorExportParamsSchema = Type.Object(
  {
    sessionKey: Type.Optional(NonEmptyString),
    fromTs: Type.Optional(Type.Integer({ minimum: 0 })),
    toTs: Type.Optional(Type.Integer({ minimum: 0 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
    includePreferences: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const NeuroBehaviorExportResultSchema = Type.Object(
  {
    exportedAtMs: Type.Integer({ minimum: 0 }),
    events: Type.Array(NeuroBehaviorEventSchema),
    preferences: Type.Array(NeuroBehaviorPreferenceSchema),
  },
  { additionalProperties: false },
);

export const NeuroBehaviorDeleteParamsSchema = Type.Object(
  {
    sessionKey: Type.Optional(NonEmptyString),
    beforeTs: Type.Optional(Type.Integer({ minimum: 0 })),
    deletePreferences: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const NeuroBehaviorDeleteResultSchema = Type.Object(
  {
    deletedEvents: Type.Integer({ minimum: 0 }),
    deletedPreferences: Type.Integer({ minimum: 0 }),
    remainingEvents: Type.Integer({ minimum: 0 }),
    remainingPreferences: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const NeuroBehaviorRetentionRunParamsSchema = Type.Object(
  {
    nowMs: Type.Optional(Type.Integer({ minimum: 0 })),
    dryRun: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const NeuroBehaviorRetentionRunResultSchema = Type.Object(
  {
    cutoffTs: Type.Integer({ minimum: 0 }),
    deletedEvents: Type.Integer({ minimum: 0 }),
    remainingEvents: Type.Integer({ minimum: 0 }),
    retentionDays: Type.Integer({ minimum: 1 }),
    dryRun: Type.Boolean(),
  },
  { additionalProperties: false },
);

const NeuroPredictionActionSchema = Type.Union([
  Type.Literal("suggest"),
  Type.Literal("auto_apply"),
  Type.Literal("ignore"),
]);

const NeuroPredictionSourceSchema = ContextSourceSchema;

export const NeuroPredictPreviewParamsSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    source: NeuroPredictionSourceSchema,
    signal: NonEmptyString,
  },
  { additionalProperties: false },
);

export const NeuroPredictPreviewResultSchema = Type.Object(
  {
    sessionKey: NonEmptyString,
    source: NeuroPredictionSourceSchema,
    signal: NonEmptyString,
    normalizedSignal: NonEmptyString,
    patternKey: NonEmptyString,
    patternHash: NonEmptyString,
    action: NeuroPredictionActionSchema,
    suppressed: Type.Boolean(),
    confidence: Type.Number({ minimum: 0, maximum: 1 }),
    similarCount: Type.Integer({ minimum: 0 }),
    acceptRate: Type.Number({ minimum: 0, maximum: 1 }),
    reasonCodes: Type.Array(NonEmptyString),
    preference: Type.Union([
      Type.Literal("auto_apply"),
      Type.Literal("suggest"),
      Type.Literal("ignore"),
      Type.Null(),
    ]),
    lastEventTs: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
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
