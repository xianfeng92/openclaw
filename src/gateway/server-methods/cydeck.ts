import {
  appendCyDeckSessionMemorySnapshot,
  extractCyDeckTranscriptMessages,
  isPrivateLandingSession,
} from "../cydeck-memory.js";
import { getCyDeckMemoryManager } from "../cydeck-native-memory.js";
import { resolveCyDeckWorkspacePath } from "../cydeck-runtime.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { loadSessionEntry, readSessionMessages } from "../session-utils.js";
import type { GatewayRequestHandlers } from "./types.js";

function requireWorkspacePath() {
  const workspacePath = resolveCyDeckWorkspacePath();
  if (!workspacePath) {
    return {
      ok: false as const,
      error: errorShape(
        ErrorCodes.UNAVAILABLE,
        "CyDeck workspace is not configured for the current gateway runtime",
      ),
    };
  }
  return {
    ok: true as const,
    workspacePath,
  };
}

export const cydeckHandlers: GatewayRequestHandlers = {
  "tools.memory.search": async ({ params, respond }) => {
    const workspace = requireWorkspacePath();
    if (!workspace.ok) {
      respond(false, undefined, workspace.error);
      return;
    }

    const query = typeof params.query === "string" ? params.query.trim() : "";
    if (!query) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "query is required"));
      return;
    }

    const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey.trim() : "";
    if (sessionKey && !isPrivateLandingSession(sessionKey)) {
      respond(true, { results: [] });
      return;
    }

    const maxResults =
      typeof params.maxResults === "number" && Number.isFinite(params.maxResults)
        ? params.maxResults
        : undefined;
    const minScore =
      typeof params.minScore === "number" && Number.isFinite(params.minScore)
        ? params.minScore
        : undefined;

    try {
      const { manager, error } = await getCyDeckMemoryManager({
        workspacePath: workspace.workspacePath,
        sessionKey,
      });
      if (!manager) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, error ?? "CyDeck memory search is unavailable"),
        );
        return;
      }

      respond(true, {
        results: await manager.search(query, {
          maxResults,
          minScore,
          sessionKey,
        }),
      });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, err instanceof Error ? err.message : String(err)),
      );
    }
  },
  "tools.memory.get": async ({ params, respond }) => {
    const workspace = requireWorkspacePath();
    if (!workspace.ok) {
      respond(false, undefined, workspace.error);
      return;
    }

    const requestedPath = typeof params.path === "string" ? params.path.trim() : "";
    if (!requestedPath) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "path is required"));
      return;
    }

    const from =
      typeof params.from === "number" && Number.isFinite(params.from)
        ? Math.floor(params.from)
        : undefined;
    const lines =
      typeof params.lines === "number" && Number.isFinite(params.lines)
        ? Math.floor(params.lines)
        : undefined;

    try {
      const { manager, error } = await getCyDeckMemoryManager({
        workspacePath: workspace.workspacePath,
      });
      if (!manager) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, error ?? "CyDeck memory read is unavailable"),
        );
        return;
      }

      respond(
        true,
        await manager.readFile({
          relPath: requestedPath,
          from,
          lines,
        }),
      );
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
      );
    }
  },
  "session.rotate": ({ params, respond }) => {
    const workspace = requireWorkspacePath();
    if (!workspace.ok) {
      respond(false, undefined, workspace.error);
      return;
    }

    const fromSessionKey =
      typeof params.fromSessionKey === "string" ? params.fromSessionKey.trim() : "";
    if (!fromSessionKey) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "fromSessionKey is required"),
      );
      return;
    }
    if (!isPrivateLandingSession(fromSessionKey)) {
      respond(true, { saved: false, reason: "session-not-private" });
      return;
    }

    const { storePath, entry } = loadSessionEntry(fromSessionKey);
    const sessionId = entry?.sessionId;
    if (!sessionId || !storePath) {
      respond(true, { saved: false, reason: "session-not-found" });
      return;
    }

    const transcriptMessages = extractCyDeckTranscriptMessages(
      readSessionMessages(sessionId, storePath, entry?.sessionFile),
    );
    try {
      respond(
        true,
        appendCyDeckSessionMemorySnapshot({
          workspacePath: workspace.workspacePath,
          sessionKey: fromSessionKey,
          reason: "session-rotate",
          messages: transcriptMessages,
        }),
      );
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, err instanceof Error ? err.message : String(err)),
      );
    }
  },
};
