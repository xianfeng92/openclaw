import {
  getExistingSession,
  persistSessionMemorySnapshot,
  type ChatSession,
  type MemoryRuntimeConfig,
} from "./embedded-gateway.chat.js";
import { isPrivateLandingSession } from "./landing.js";
import { memoryGet, memorySearch } from "./memory-runtime.js";

export type RequestHandlerResult =
  | { ok: true; payload: unknown }
  | { ok: false; message: string; code: number };

export function handleMemorySearchRequest(input: {
  workspacePath: string;
  params: Record<string, unknown>;
}): RequestHandlerResult {
  const { workspacePath, params } = input;
  const query = typeof params.query === "string" ? params.query : "";
  if (!query.trim()) {
    return {
      ok: false,
      message: "query is required",
      code: 400,
    };
  }

  const sessionKey = typeof params.sessionKey === "string" ? params.sessionKey.trim() : "";
  if (sessionKey && !isPrivateLandingSession(sessionKey)) {
    return {
      ok: true,
      payload: { results: [] },
    };
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
    const results = memorySearch(workspacePath, query, { maxResults, minScore });
    return {
      ok: true,
      payload: { results },
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      code: 500,
    };
  }
}

export function handleMemoryGetRequest(input: {
  workspacePath: string;
  params: Record<string, unknown>;
}): RequestHandlerResult {
  const { workspacePath, params } = input;
  const requestedPath = typeof params.path === "string" ? params.path : "";
  if (!requestedPath.trim()) {
    return {
      ok: false,
      message: "path is required",
      code: 400,
    };
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
    const result = memoryGet(workspacePath, {
      path: requestedPath,
      from,
      lines,
    });
    return {
      ok: true,
      payload: result,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      code: 400,
    };
  }
}

export function handleSessionRotateRequest(input: {
  sessions: Map<string, ChatSession>;
  connectionId: string;
  workspacePath: string;
  memoryRuntime: MemoryRuntimeConfig;
  params: Record<string, unknown>;
}): RequestHandlerResult {
  const { sessions, connectionId, workspacePath, memoryRuntime, params } = input;
  const fromSessionKey =
    typeof params.fromSessionKey === "string" ? params.fromSessionKey.trim() : "";
  if (!fromSessionKey) {
    return {
      ok: false,
      message: "fromSessionKey is required",
      code: 400,
    };
  }

  const session = getExistingSession(sessions, connectionId, fromSessionKey);
  if (!session) {
    return {
      ok: true,
      payload: { saved: false, reason: "session-not-found" },
    };
  }

  try {
    const result = persistSessionMemorySnapshot({
      session,
      workspacePath,
      memoryRuntime,
      reason: "session-rotate",
      force: true,
    });
    return {
      ok: true,
      payload: result,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      code: 500,
    };
  }
}
