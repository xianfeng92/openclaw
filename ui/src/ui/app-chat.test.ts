import { describe, expect, it } from "vitest";
import {
  CHAT_RUN_STALL_TIMEOUT_MS,
  clearStalledRunIfNeeded,
  type ChatHost,
} from "./app-chat.ts";

function createHost(overrides: Partial<ChatHost> = {}): ChatHost {
  return {
    connected: true,
    chatMessage: "",
    chatAttachments: [],
    chatQueue: [],
    chatRunId: "run-1",
    chatStreamStartedAt: Date.now() - CHAT_RUN_STALL_TIMEOUT_MS - 1_000,
    chatSending: false,
    sessionKey: "agent:dev:main",
    basePath: "",
    hello: null,
    chatAvatarUrl: null,
    refreshSessionsAfterChat: new Set<string>(),
    ...overrides,
  };
}

describe("clearStalledRunIfNeeded", () => {
  it("clears a stalled run once timeout is exceeded", () => {
    const host = createHost();
    (host as unknown as { chatStream: string | null }).chatStream = "streaming";

    const recovered = clearStalledRunIfNeeded(host, "run-1", Date.now());

    expect(recovered).toBe(true);
    expect(host.chatRunId).toBe(null);
    expect(host.chatStreamStartedAt).toBe(null);
    expect((host as unknown as { chatStream: string | null }).chatStream).toBe(null);
  });

  it("does not clear when run id does not match", () => {
    const host = createHost();
    const recovered = clearStalledRunIfNeeded(host, "run-2", Date.now());
    expect(recovered).toBe(false);
    expect(host.chatRunId).toBe("run-1");
  });

  it("does not clear before timeout", () => {
    const now = Date.now();
    const host = createHost({
      chatStreamStartedAt: now - Math.floor(CHAT_RUN_STALL_TIMEOUT_MS / 2),
    });
    const recovered = clearStalledRunIfNeeded(host, "run-1", now);
    expect(recovered).toBe(false);
    expect(host.chatRunId).toBe("run-1");
  });
});

