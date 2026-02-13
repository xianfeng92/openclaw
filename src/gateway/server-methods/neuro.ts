import type { GatewayRequestContext, GatewayRequestHandlers } from "./types.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  type NeuroContextSnapshotParams,
  validateNeuroBehaviorDeleteParams,
  validateNeuroBehaviorExportParams,
  validateNeuroPredictPreviewParams,
  validateNeuroBehaviorRetentionRunParams,
  validateNeuroSuggestionActionParams,
  validateNeuroSuggestionListParams,
  validateNeuroSuggestionUpsertParams,
  validateNeuroContextIngestParams,
  validateNeuroContextSnapshotParams,
  validateNeuroFlagsGetParams,
  validateNeuroFlagsSetParams,
  validateNeuroMetricsGetParams,
  validateNeuroMetricsObserveParams,
} from "../protocol/index.js";

const DEFAULT_SNAPSHOT_MAX_EVENTS = 200;
const SNAPSHOT_MAX_EVENTS_UPPER_BOUND = 1000;
const NETWORK_ERROR_RE =
  /\b(ECONN[A-Z_]*|ENET[A-Z_]*|EHOST[A-Z_]*|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|offline|network)\b/i;

type SuggestionAction = "apply" | "dismiss" | "undo" | "explain";
type FeedbackAction = "accept" | "dismiss" | "modify" | "ignore";
type SuggestionFallback = {
  kind: "offline" | "provider" | "unavailable";
  retryable: boolean;
  message: string;
};
type SuggestionPolicyDecision = {
  allowed: boolean;
  code: string;
  reason: string;
};

function toFeedbackAction(action: SuggestionAction): FeedbackAction {
  if (action === "apply") {
    return "accept";
  }
  if (action === "dismiss") {
    return "dismiss";
  }
  if (action === "undo") {
    return "modify";
  }
  return "ignore";
}

function buildFeedback(params: {
  sessionKey: string;
  suggestionId: string;
  action: FeedbackAction;
  nowMs?: number;
}) {
  return {
    version: "suggestion.feedback.v1" as const,
    suggestionId: params.suggestionId,
    action: params.action,
    ts: params.nowMs ?? Date.now(),
    sessionKey: params.sessionKey,
  };
}

async function resolveProviderFallback(
  context: GatewayRequestContext,
): Promise<SuggestionFallback | null> {
  try {
    const catalog = await context.loadGatewayModelCatalog();
    if (catalog.length > 0) {
      return null;
    }
    return {
      kind: "provider",
      retryable: true,
      message: "No model provider is currently configured for this action.",
    };
  } catch (err) {
    const text = String(err);
    if (NETWORK_ERROR_RE.test(text)) {
      return {
        kind: "offline",
        retryable: true,
        message: "Provider appears offline. Check connectivity and try again.",
      };
    }
    return {
      kind: "provider",
      retryable: true,
      message: "Provider is temporarily unavailable. Please retry shortly.",
    };
  }
}

function resolvePolicyFallback(policy: SuggestionPolicyDecision): SuggestionFallback {
  if (policy.code === "DENY_FLOW_DISABLED") {
    return {
      kind: "unavailable",
      retryable: true,
      message: "Flow mode is disabled. Enable flow mode or run in safe mode.",
    };
  }
  if (policy.code === "DENY_KILL_SWITCH") {
    return {
      kind: "unavailable",
      retryable: false,
      message: "Neuro kill switch is enabled. Apply actions are blocked.",
    };
  }
  if (policy.code === "DENY_HARD_LIST") {
    return {
      kind: "unavailable",
      retryable: false,
      message: policy.reason,
    };
  }
  return {
    kind: "unavailable",
    retryable: false,
    message: policy.reason,
  };
}

function resolveSnapshotEventLimit(params: NeuroContextSnapshotParams): number {
  if (typeof params.maxEvents !== "number" || !Number.isFinite(params.maxEvents)) {
    return DEFAULT_SNAPSHOT_MAX_EVENTS;
  }
  return Math.max(1, Math.min(SNAPSHOT_MAX_EVENTS_UPPER_BOUND, Math.floor(params.maxEvents)));
}

function writeBehaviorSuggestion(
  context: GatewayRequestContext,
  params: {
    card: Parameters<GatewayRequestContext["neuroBehavioralStore"]["recordSuggestion"]>[0]["card"];
    nowMs: number;
  },
) {
  try {
    context.neuroBehavioralStore.recordSuggestion({
      card: params.card,
      nowMs: params.nowMs,
    });
  } catch (err) {
    context.logGateway.warn(`neuro behavioral write failed (suggestion): ${String(err)}`);
  }
}

function writeBehaviorFeedback(
  context: GatewayRequestContext,
  params: {
    feedback: Parameters<
      GatewayRequestContext["neuroBehavioralStore"]["recordFeedback"]
    >[0]["feedback"];
    nowMs: number;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    context.neuroBehavioralStore.recordFeedback({
      feedback: params.feedback,
      nowMs: params.nowMs,
      metadata: params.metadata,
    });
  } catch (err) {
    context.logGateway.warn(`neuro behavioral write failed (feedback): ${String(err)}`);
  }
}

function safeBroadcast(
  context: GatewayRequestContext,
  event: string,
  payload: unknown,
  opts?: { dropIfSlow?: boolean },
) {
  try {
    context.broadcast(event, payload, opts);
  } catch (err) {
    context.logGateway.warn(`neuro broadcast failed event=${event}: ${String(err)}`);
  }
}

export const neuroHandlers: GatewayRequestHandlers = {
  "neuro.context.ingest": ({ params, respond, context }) => {
    if (!validateNeuroContextIngestParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid neuro.context.ingest params: ${formatValidationErrors(
            validateNeuroContextIngestParams.errors,
          )}`,
        ),
      );
      return;
    }

    let droppedEvents = 0;
    for (const event of params.events) {
      droppedEvents += context.neuroContextCache.append(event).dropped;
      context.neuroMetrics.recordRedactionLevel(event.redaction.level);
    }

    const cache = context.neuroContextCache.stats();
    respond(
      true,
      {
        acceptedEvents: params.events.length,
        droppedEvents,
        cache,
      },
      undefined,
    );
  },

  "neuro.context.snapshot": ({ params, respond, context }) => {
    if (!validateNeuroContextSnapshotParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid neuro.context.snapshot params: ${formatValidationErrors(
            validateNeuroContextSnapshotParams.errors,
          )}`,
        ),
      );
      return;
    }

    const includeEvents = params.includeEvents !== false;
    const maxEvents = resolveSnapshotEventLimit(params);
    const snapshot = context.neuroContextCache.snapshot(params.sessionKey);
    const events = includeEvents ? snapshot.events.slice(-maxEvents) : [];

    respond(
      true,
      {
        sessionKey: snapshot.sessionKey,
        totalBytes: snapshot.totalBytes,
        totalEvents: snapshot.totalEvents,
        returnedEvents: events.length,
        events,
        perSource: snapshot.perSource,
      },
      undefined,
    );
  },

  "neuro.suggestion.upsert": ({ params, respond, context }) => {
    if (!validateNeuroSuggestionUpsertParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid neuro.suggestion.upsert params: ${formatValidationErrors(
            validateNeuroSuggestionUpsertParams.errors,
          )}`,
        ),
      );
      return;
    }

    const nowMs = Date.now();
    const stored = context.neuroSuggestionCards.upsert(params.card);
    writeBehaviorSuggestion(context, { card: params.card, nowMs });
    safeBroadcast(
      context,
      "neuro.suggestion.card",
      {
        op: "upsert",
        card: params.card,
      },
      { dropIfSlow: true },
    );
    respond(
      true,
      {
        sessionKey: params.card.sessionKey,
        suggestionId: params.card.suggestionId,
        inserted: stored.inserted,
        replaced: stored.replaced,
      },
      undefined,
    );
  },

  "neuro.suggestion.list": ({ params, respond, context }) => {
    if (!validateNeuroSuggestionListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid neuro.suggestion.list params: ${formatValidationErrors(
            validateNeuroSuggestionListParams.errors,
          )}`,
        ),
      );
      return;
    }
    const { cards } = context.neuroSuggestionCards.list(params.sessionKey);
    respond(
      true,
      {
        sessionKey: params.sessionKey,
        total: cards.length,
        cards,
      },
      undefined,
    );
  },

  "neuro.suggestion.action": async ({ params, respond, context }) => {
    if (!validateNeuroSuggestionActionParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid neuro.suggestion.action params: ${formatValidationErrors(
            validateNeuroSuggestionActionParams.errors,
          )}`,
        ),
      );
      return;
    }

    const action = params.action as SuggestionAction;
    const operation = typeof params.operation === "string" ? params.operation : undefined;
    const groupId = typeof params.groupId === "string" ? params.groupId : undefined;
    const snapshots = Array.isArray(params.snapshots)
      ? params.snapshots.map((snapshot) => {
          const value =
            snapshot && typeof snapshot === "object"
              ? (snapshot as Record<string, unknown>)
              : ({} as Record<string, unknown>);
          return {
            snapshotId: typeof value.snapshotId === "string" ? value.snapshotId : undefined,
            kind: typeof value.kind === "string" ? value.kind : "",
            target: typeof value.target === "string" ? value.target : "",
            before: "before" in value ? value.before : undefined,
            after: "after" in value ? value.after : undefined,
          };
        })
      : undefined;
    const nowMs = Date.now();
    const card = context.neuroSuggestionCards.get(params.sessionKey, params.suggestionId, nowMs);
    const baseFeedback = buildFeedback({
      sessionKey: params.sessionKey,
      suggestionId: params.suggestionId,
      action: "ignore",
      nowMs,
    });

    if (!card) {
      const fallbackMessage = "Suggestion is no longer available.";
      safeBroadcast(context, "neuro.suggestion.feedback", baseFeedback, { dropIfSlow: true });
      writeBehaviorFeedback(context, {
        feedback: baseFeedback,
        nowMs,
        metadata: {
          status: "fallback",
          requestedAction: action,
          fallbackKind: "unavailable",
          message: fallbackMessage,
        },
      });
      respond(
        true,
        {
          sessionKey: params.sessionKey,
          suggestionId: params.suggestionId,
          action,
          status: "fallback",
          message: fallbackMessage,
          feedback: baseFeedback,
          fallback: {
            kind: "unavailable",
            retryable: false,
            message: fallbackMessage,
          },
        },
        undefined,
      );
      return;
    }

    if (!card.actions.includes(action)) {
      const fallbackMessage = `Action '${action}' is not available for this suggestion.`;
      safeBroadcast(context, "neuro.suggestion.feedback", baseFeedback, { dropIfSlow: true });
      writeBehaviorFeedback(context, {
        feedback: baseFeedback,
        nowMs,
        metadata: {
          status: "fallback",
          requestedAction: action,
          fallbackKind: "unavailable",
          message: fallbackMessage,
        },
      });
      respond(
        true,
        {
          sessionKey: params.sessionKey,
          suggestionId: params.suggestionId,
          action,
          status: "fallback",
          message: fallbackMessage,
          feedback: baseFeedback,
          fallback: {
            kind: "unavailable",
            retryable: false,
            message: fallbackMessage,
          },
        },
        undefined,
      );
      return;
    }

    if (action === "dismiss") {
      context.neuroSuggestionCards.remove(params.sessionKey, params.suggestionId, nowMs);
      const feedback = buildFeedback({
        sessionKey: params.sessionKey,
        suggestionId: params.suggestionId,
        action: "dismiss",
        nowMs,
      });
      safeBroadcast(
        context,
        "neuro.suggestion.card",
        {
          op: "remove",
          sessionKey: params.sessionKey,
          suggestionId: params.suggestionId,
        },
        { dropIfSlow: true },
      );
      safeBroadcast(context, "neuro.suggestion.feedback", feedback, { dropIfSlow: true });
      writeBehaviorFeedback(context, {
        feedback,
        nowMs,
        metadata: {
          status: "dismissed",
        },
      });
      respond(
        true,
        {
          sessionKey: params.sessionKey,
          suggestionId: params.suggestionId,
          action,
          status: "dismissed",
          message: "Suggestion dismissed.",
          feedback,
        },
        undefined,
      );
      return;
    }

    if (action === "undo") {
      const journalEntry = context.neuroUndoJournal.undoLatestBySuggestion(
        params.sessionKey,
        params.suggestionId,
        nowMs,
      );
      if (!journalEntry) {
        const fallbackMessage = "Undo window expired or no undo snapshot exists.";
        safeBroadcast(context, "neuro.suggestion.feedback", baseFeedback, { dropIfSlow: true });
        writeBehaviorFeedback(context, {
          feedback: baseFeedback,
          nowMs,
          metadata: {
            status: "fallback",
            requestedAction: action,
            fallbackKind: "unavailable",
            message: fallbackMessage,
          },
        });
        respond(
          true,
          {
            sessionKey: params.sessionKey,
            suggestionId: params.suggestionId,
            action,
            status: "fallback",
            message: fallbackMessage,
            feedback: baseFeedback,
            fallback: {
              kind: "unavailable",
              retryable: false,
              message: fallbackMessage,
            },
          },
          undefined,
        );
        return;
      }

      const undone = context.neuroSuggestionCards.undo(
        params.sessionKey,
        params.suggestionId,
        nowMs,
      );
      if (!undone) {
        // Suggestion card may have expired while undo journal still has a valid snapshot.
      }
      const feedback = buildFeedback({
        sessionKey: params.sessionKey,
        suggestionId: params.suggestionId,
        action: "modify",
        nowMs,
      });
      safeBroadcast(context, "neuro.suggestion.feedback", feedback, { dropIfSlow: true });
      writeBehaviorFeedback(context, {
        feedback,
        nowMs,
        metadata: {
          status: "undone",
          journalId: journalEntry.journalId,
          groupId: journalEntry.groupId,
          snapshotCount: journalEntry.snapshots.length,
        },
      });
      respond(
        true,
        {
          sessionKey: params.sessionKey,
          suggestionId: params.suggestionId,
          action,
          status: "undone",
          message: `Suggestion changes reverted (${journalEntry.snapshots.length} snapshot(s)).`,
          journalId: journalEntry.journalId,
          groupId: journalEntry.groupId,
          feedback,
        },
        undefined,
      );
      return;
    }

    if (action === "apply" || action === "explain") {
      const flags = context.neuroFeatureFlags.getSnapshot();
      const policy = context.neuroPolicyEngine.evaluate({
        action,
        card,
        effectiveFlags: {
          flowMode: flags.effective.flowMode,
          killSwitch: flags.effective.killSwitch,
        },
        operation,
      });
      if (!policy.allowed) {
        const fallback = resolvePolicyFallback(policy);
        safeBroadcast(context, "neuro.suggestion.feedback", baseFeedback, { dropIfSlow: true });
        writeBehaviorFeedback(context, {
          feedback: baseFeedback,
          nowMs,
          metadata: {
            status: "fallback",
            requestedAction: action,
            fallbackKind: fallback.kind,
            message: fallback.message,
            policyCode: policy.code,
          },
        });
        respond(
          true,
          {
            sessionKey: params.sessionKey,
            suggestionId: params.suggestionId,
            action,
            status: "fallback",
            message: fallback.message,
            policy,
            feedback: baseFeedback,
            fallback,
          },
          undefined,
        );
        return;
      }

      const fallback = await resolveProviderFallback(context);
      if (fallback) {
        safeBroadcast(context, "neuro.suggestion.feedback", baseFeedback, { dropIfSlow: true });
        writeBehaviorFeedback(context, {
          feedback: baseFeedback,
          nowMs,
          metadata: {
            status: "fallback",
            requestedAction: action,
            fallbackKind: fallback.kind,
            message: fallback.message,
            policyCode: policy.code,
          },
        });
        respond(
          true,
          {
            sessionKey: params.sessionKey,
            suggestionId: params.suggestionId,
            action,
            status: "fallback",
            message: fallback.message,
            policy,
            feedback: baseFeedback,
            fallback,
          },
          undefined,
        );
        return;
      }

      if (action === "apply") {
        const undoEntry = context.neuroUndoJournal.recordApply(
          {
            sessionKey: params.sessionKey,
            suggestionId: params.suggestionId,
            mode: card.mode,
            groupId,
            snapshots,
          },
          nowMs,
        );
        const applyMeta = context.neuroSuggestionCards.markApplied(
          params.sessionKey,
          params.suggestionId,
          nowMs,
        );
        const feedback = buildFeedback({
          sessionKey: params.sessionKey,
          suggestionId: params.suggestionId,
          action: toFeedbackAction(action),
          nowMs,
        });
        safeBroadcast(context, "neuro.suggestion.feedback", feedback, { dropIfSlow: true });
        writeBehaviorFeedback(context, {
          feedback,
          nowMs,
          metadata: {
            status: "applied",
            journalId: undoEntry.journalId,
            groupId: undoEntry.groupId,
            policyCode: policy.code,
            undoUntilMs: applyMeta?.undoUntilMs ?? undoEntry.expiresAtMs,
          },
        });
        respond(
          true,
          {
            sessionKey: params.sessionKey,
            suggestionId: params.suggestionId,
            action,
            status: "applied",
            message: "Suggestion applied.",
            undoUntilMs: applyMeta?.undoUntilMs ?? undoEntry.expiresAtMs,
            journalId: undoEntry.journalId,
            groupId: undoEntry.groupId,
            policy,
            feedback,
          },
          undefined,
        );
        return;
      }

      const feedback = buildFeedback({
        sessionKey: params.sessionKey,
        suggestionId: params.suggestionId,
        action: toFeedbackAction(action),
        nowMs,
      });
      safeBroadcast(context, "neuro.suggestion.feedback", feedback, { dropIfSlow: true });
      writeBehaviorFeedback(context, {
        feedback,
        nowMs,
        metadata: {
          status: "explained",
          policyCode: policy.code,
          confidence: card.confidence,
          mode: card.mode,
        },
      });
      respond(
        true,
        {
          sessionKey: params.sessionKey,
          suggestionId: params.suggestionId,
          action,
          status: "explained",
          message: `Confidence ${(card.confidence * 100).toFixed(0)}% in ${card.mode} mode.`,
          policy,
          feedback,
        },
        undefined,
      );
    }
  },

  "neuro.behavior.export": ({ params, respond, context }) => {
    if (!validateNeuroBehaviorExportParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid neuro.behavior.export params: ${formatValidationErrors(
            validateNeuroBehaviorExportParams.errors,
          )}`,
        ),
      );
      return;
    }

    try {
      const result = context.neuroBehavioralStore.exportData({
        sessionKey: params.sessionKey,
        fromTs: params.fromTs,
        toTs: params.toTs,
        limit: params.limit,
        includePreferences: params.includePreferences,
      });
      respond(true, result, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `neuro.behavior.export failed: ${String(err)}`),
      );
    }
  },

  "neuro.behavior.delete": ({ params, respond, context }) => {
    if (!validateNeuroBehaviorDeleteParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid neuro.behavior.delete params: ${formatValidationErrors(
            validateNeuroBehaviorDeleteParams.errors,
          )}`,
        ),
      );
      return;
    }

    try {
      const result = context.neuroBehavioralStore.deleteData({
        sessionKey: params.sessionKey,
        beforeTs: params.beforeTs,
        deletePreferences: params.deletePreferences,
      });
      respond(true, result, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `neuro.behavior.delete failed: ${String(err)}`),
      );
    }
  },

  "neuro.behavior.retention.run": ({ params, respond, context }) => {
    if (!validateNeuroBehaviorRetentionRunParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid neuro.behavior.retention.run params: ${formatValidationErrors(
            validateNeuroBehaviorRetentionRunParams.errors,
          )}`,
        ),
      );
      return;
    }

    try {
      const result = context.neuroBehavioralStore.pruneExpiredEvents({
        nowMs: params.nowMs,
        dryRun: params.dryRun,
      });
      respond(true, result, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `neuro.behavior.retention.run failed: ${String(err)}`),
      );
    }
  },

  "neuro.predict.preview": ({ params, respond, context }) => {
    if (!validateNeuroPredictPreviewParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid neuro.predict.preview params: ${formatValidationErrors(
            validateNeuroPredictPreviewParams.errors,
          )}`,
        ),
      );
      return;
    }

    try {
      const decision = context.neuroPredictionEngine.predict({
        sessionKey: params.sessionKey,
        source: params.source,
        signal: params.signal,
      });
      respond(true, decision, undefined);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `neuro.predict.preview failed: ${String(err)}`),
      );
    }
  },

  "neuro.flags.get": ({ params, respond, context }) => {
    if (!validateNeuroFlagsGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid neuro.flags.get params: ${formatValidationErrors(validateNeuroFlagsGetParams.errors)}`,
        ),
      );
      return;
    }

    respond(true, context.neuroFeatureFlags.getSnapshot(), undefined);
  },

  "neuro.flags.set": ({ params, respond, context }) => {
    if (!validateNeuroFlagsSetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid neuro.flags.set params: ${formatValidationErrors(validateNeuroFlagsSetParams.errors)}`,
        ),
      );
      return;
    }

    const snapshot = context.neuroFeatureFlags.set(params);
    safeBroadcast(context, "neuro.flags.changed", snapshot, { dropIfSlow: true });
    respond(true, snapshot, undefined);
  },

  "neuro.metrics.get": ({ params, respond, context }) => {
    if (!validateNeuroMetricsGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid neuro.metrics.get params: ${formatValidationErrors(validateNeuroMetricsGetParams.errors)}`,
        ),
      );
      return;
    }

    respond(true, context.neuroMetrics.getSnapshot(), undefined);
  },

  "neuro.metrics.observe": ({ params, respond, context }) => {
    if (!validateNeuroMetricsObserveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid neuro.metrics.observe params: ${formatValidationErrors(
            validateNeuroMetricsObserveParams.errors,
          )}`,
        ),
      );
      return;
    }

    if (typeof params.uiReadyMs === "number") {
      context.neuroMetrics.recordInvokeUiReady(params.uiReadyMs);
    }
    if (typeof params.desktopMemoryMb === "number") {
      context.neuroMetrics.recordDesktopMemoryMb(params.desktopMemoryMb);
    }
    respond(true, context.neuroMetrics.getSnapshot(), undefined);
  },
};
