import { describe, expect, it } from "vitest";
import { flushToolStreamSync, handleAgentEvent } from "./app-tool-stream.ts";

function createHost() {
  return {
    sessionKey: "main",
    chatRunId: "run-1",
    toolStreamById: new Map(),
    toolStreamOrder: [] as string[],
    chatToolMessages: [] as Record<string, unknown>[],
    toolStreamSyncTimer: null as number | null,
  };
}

function readToolResultText(message: Record<string, unknown>): string | undefined {
  const content = message.content;
  if (!Array.isArray(content)) {
    return undefined;
  }
  const result = content.find(
    (item) =>
      item && typeof item === "object" && (item as Record<string, unknown>).type === "toolresult",
  ) as Record<string, unknown> | undefined;
  return typeof result?.text === "string" ? result.text : undefined;
}

describe("app tool stream", () => {
  it("builds tool cards across start/update/result phases", () => {
    const host = createHost();

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "tool",
      ts: Date.now(),
      sessionKey: "main",
      data: { phase: "start", name: "bash.exec", toolCallId: "call-1", args: { command: "ls" } },
    });
    flushToolStreamSync(host);

    expect(host.chatToolMessages).toHaveLength(1);
    expect(host.chatToolMessages[0]?.toolCallId).toBe("call-1");
    expect(host.chatToolMessages[0]?.runId).toBe("run-1");
    expect(readToolResultText(host.chatToolMessages[0])).toBeUndefined();

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 2,
      stream: "tool",
      ts: Date.now(),
      sessionKey: "main",
      data: {
        phase: "update",
        name: "bash.exec",
        toolCallId: "call-1",
        partialResult: { content: [{ type: "text", text: "listing..." }] },
      },
    });
    flushToolStreamSync(host);
    expect(readToolResultText(host.chatToolMessages[0])).toContain("listing");

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 3,
      stream: "tool",
      ts: Date.now(),
      sessionKey: "main",
      data: {
        phase: "result",
        name: "bash.exec",
        toolCallId: "call-1",
        result: { content: [{ type: "text", text: "done" }] },
      },
    });
    expect(readToolResultText(host.chatToolMessages[0])).toContain("done");
  });
});
