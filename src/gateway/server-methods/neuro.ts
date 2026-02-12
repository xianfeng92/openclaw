import type { GatewayRequestHandlers } from "./types.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  type NeuroContextSnapshotParams,
  validateNeuroContextIngestParams,
  validateNeuroContextSnapshotParams,
  validateNeuroFlagsGetParams,
  validateNeuroFlagsSetParams,
  validateNeuroMetricsGetParams,
  validateNeuroMetricsObserveParams,
} from "../protocol/index.js";

const DEFAULT_SNAPSHOT_MAX_EVENTS = 200;
const SNAPSHOT_MAX_EVENTS_UPPER_BOUND = 1000;

function resolveSnapshotEventLimit(params: NeuroContextSnapshotParams): number {
  if (typeof params.maxEvents !== "number" || !Number.isFinite(params.maxEvents)) {
    return DEFAULT_SNAPSHOT_MAX_EVENTS;
  }
  return Math.max(1, Math.min(SNAPSHOT_MAX_EVENTS_UPPER_BOUND, Math.floor(params.maxEvents)));
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
    context.broadcast("neuro.flags.changed", snapshot, { dropIfSlow: true });
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
