import { describe, expect, it } from "vitest";
import { resolveCyDeckChatRuntime } from "./cydeck-chat-runtime.js";

describe("resolveCyDeckChatRuntime", () => {
  it("defaults to gateway when unset", () => {
    expect(resolveCyDeckChatRuntime({})).toBe("gateway");
  });

  it("uses legacy only when explicitly requested", () => {
    expect(resolveCyDeckChatRuntime({ CYDECK_CHAT_RUNTIME: "legacy" })).toBe("legacy");
    expect(resolveCyDeckChatRuntime({ CYDECK_CHAT_RUNTIME: " LEGACY " })).toBe("legacy");
  });

  it("falls back to gateway for unknown values", () => {
    expect(resolveCyDeckChatRuntime({ CYDECK_CHAT_RUNTIME: "providers" })).toBe("gateway");
  });
});
