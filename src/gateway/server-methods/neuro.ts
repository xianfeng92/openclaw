import type { GatewayRequestHandlers } from "./types.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  type NeuroContextSnapshotParams,
  validateNeuroContextIngestParams,
  validateNeuroContextSnapshotParams,
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
};
