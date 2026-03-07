import { describe, expect, it } from "vitest";
import {
  getSession,
  resolveMemoryRuntimeConfig,
  type ChatSession,
} from "./embedded-gateway.chat.js";
import {
  handleMemoryGetRequest,
  handleMemorySearchRequest,
  handleSessionRotateRequest,
} from "./embedded-gateway.request-handlers.js";

describe("embedded-gateway request handlers", () => {
  it("returns empty memory search results for non-private sessions", () => {
    const result = handleMemorySearchRequest({
      workspacePath: "C:\\workspace",
      params: {
        sessionKey: "group:team-a",
        query: "hello",
      },
    });

    expect(result).toEqual({
      ok: true,
      payload: { results: [] },
    });
  });

  it("rejects memory.get without a path", () => {
    const result = handleMemoryGetRequest({
      workspacePath: "C:\\workspace",
      params: {},
    });

    expect(result).toEqual({
      ok: false,
      message: "path is required",
      code: 400,
    });
  });

  it("returns session-not-found for missing rotate targets", () => {
    const result = handleSessionRotateRequest({
      sessions: new Map<string, ChatSession>(),
      connectionId: "connection-a",
      workspacePath: "C:\\workspace",
      memoryRuntime: resolveMemoryRuntimeConfig(),
      params: {
        fromSessionKey: "private:missing",
      },
    });

    expect(result).toEqual({
      ok: true,
      payload: { saved: false, reason: "session-not-found" },
    });
  });

  it("rejects session.rotate without fromSessionKey", () => {
    const sessions = new Map<string, ChatSession>();
    getSession(sessions, "connection-a", "private:one");

    const result = handleSessionRotateRequest({
      sessions,
      connectionId: "connection-a",
      workspacePath: "C:\\workspace",
      memoryRuntime: resolveMemoryRuntimeConfig(),
      params: {},
    });

    expect(result).toEqual({
      ok: false,
      message: "fromSessionKey is required",
      code: 400,
    });
  });
});
