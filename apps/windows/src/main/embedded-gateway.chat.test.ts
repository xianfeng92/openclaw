import { describe, expect, it } from "vitest";
import {
  buildMessagesForProvider,
  clearConnectionSessions,
  getSession,
  normalizeAgentHint,
  resolveMemoryRuntimeConfig,
  trimSessionMessages,
  type ChatSession,
} from "./embedded-gateway.chat.js";

describe("embedded-gateway chat helpers", () => {
  it("normalizes supported agent hints", () => {
    expect(normalizeAgentHint(" gpt ")).toBe("openai");
    expect(normalizeAgentHint("claude")).toBe("claude");
    expect(normalizeAgentHint("main")).toBeUndefined();
    expect(normalizeAgentHint(42)).toBeUndefined();
  });

  it("preserves managed landing prompt when trimming session history", () => {
    const session: ChatSession = {
      sessionKey: "default",
      messages: [
        { role: "system", content: "[cydeck:landing-system-prompt]\nlanding" },
        ...Array.from({ length: 45 }, (_, index) => ({
          role: "user" as const,
          content: `message-${index + 1}`,
        })),
      ],
      lastMemoryWriteMessageCount: 0,
      lastPreCompactionFlushMessageCount: 0,
    };

    trimSessionMessages(session);

    expect(session.messages).toHaveLength(40);
    expect(session.messages[0]).toEqual({
      role: "system",
      content: "[cydeck:landing-system-prompt]\nlanding",
    });
    expect(session.messages[1]?.content).toBe("message-7");
    expect(session.messages.at(-1)?.content).toBe("message-45");
  });

  it("inserts agent hint after managed landing prompt", () => {
    const session: ChatSession = {
      sessionKey: "default",
      messages: [
        { role: "system", content: "[cydeck:landing-system-prompt]\nlanding" },
        { role: "user", content: "hello" },
      ],
      lastMemoryWriteMessageCount: 0,
      lastPreCompactionFlushMessageCount: 0,
      agentHint: "claude",
    };

    const result = buildMessagesForProvider({
      session,
      userMessage: "hello",
      workspacePath: "C:\\workspace",
      memoryRuntime: resolveMemoryRuntimeConfig({ enabled: false }),
    });

    expect(result.memoryResults).toEqual([]);
    expect(result.messages.map((message) => message.role)).toEqual([
      "system",
      "system",
      "user",
    ]);
    expect(result.messages[1]?.content).toContain("[cydeck:agent-hint]");
    expect(result.messages[1]?.content).toContain("Preferred agent profile: claude.");
  });

  it("clears only sessions for the requested connection", () => {
    const sessions = new Map<string, ChatSession>();
    getSession(sessions, "connection-a", "default");
    getSession(sessions, "connection-a", "private:one");
    getSession(sessions, "connection-b", "default");

    clearConnectionSessions(sessions, "connection-a");

    expect(Array.from(sessions.keys())).toEqual(["connection-b::default"]);
  });
});
