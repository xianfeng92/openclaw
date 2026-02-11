import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import { setActivePluginRegistry } from "../../plugins/runtime.js";
import {
  createSlackTestPlugin,
  createTelegramTestPlugin,
  createTestRegistry,
} from "../../test-utils/channel-plugins.js";

const mocks = vi.hoisted(() => ({
  executeSendAction: vi.fn(),
  recordSessionMetaFromInbound: vi.fn(async () => ({ ok: true })),
}));

vi.mock("./outbound-send-service.js", async () => {
  const actual = await vi.importActual<typeof import("./outbound-send-service.js")>(
    "./outbound-send-service.js",
  );
  return {
    ...actual,
    executeSendAction: mocks.executeSendAction,
  };
});

vi.mock("../../config/sessions.js", async () => {
  const actual = await vi.importActual<typeof import("../../config/sessions.js")>(
    "../../config/sessions.js",
  );
  return {
    ...actual,
    recordSessionMetaFromInbound: mocks.recordSessionMetaFromInbound,
  };
});

import { runMessageAction } from "./message-action-runner.js";

const slackConfig = {
  channels: {
    slack: {
      botToken: "xoxb-test",
      appToken: "xapp-test",
    },
  },
} as OpenClawConfig;

const telegramConfig = {
  channels: {
    telegram: {
      botToken: "telegram-test",
    },
  },
} as OpenClawConfig;

describe("runMessageAction threading auto-injection", () => {
  beforeEach(async () => {
    setActivePluginRegistry(
      createTestRegistry([
        {
          pluginId: "slack",
          source: "test",
          plugin: createSlackTestPlugin(),
        },
        {
          pluginId: "telegram",
          source: "test",
          plugin: createTelegramTestPlugin(),
        },
      ]),
    );
  });

  afterEach(() => {
    setActivePluginRegistry(createTestRegistry([]));
    mocks.executeSendAction.mockReset();
    mocks.recordSessionMetaFromInbound.mockReset();
  });

  it("uses toolContext thread when auto-threading is active", async () => {
    mocks.executeSendAction.mockResolvedValue({
      handledBy: "plugin",
      payload: {},
    });

    await runMessageAction({
      cfg: slackConfig,
      action: "send",
      params: {
        channel: "slack",
        target: "channel:C123",
        message: "hi",
      },
      toolContext: {
        currentChannelId: "C123",
        currentThreadTs: "111.222",
        replyToMode: "all",
      },
      agentId: "main",
    });

    const call = mocks.executeSendAction.mock.calls[0]?.[0];
    expect(call?.ctx?.mirror?.sessionKey).toBe("agent:main:slack:channel:c123:thread:111.222");
  });

  it("matches auto-threading when channel ids differ in case", async () => {
    mocks.executeSendAction.mockResolvedValue({
      handledBy: "plugin",
      payload: {},
    });

    await runMessageAction({
      cfg: slackConfig,
      action: "send",
      params: {
        channel: "slack",
        target: "channel:c123",
        message: "hi",
      },
      toolContext: {
        currentChannelId: "C123",
        currentThreadTs: "333.444",
        replyToMode: "all",
      },
      agentId: "main",
    });

    const call = mocks.executeSendAction.mock.calls[0]?.[0];
    expect(call?.ctx?.mirror?.sessionKey).toBe("agent:main:slack:channel:c123:thread:333.444");
  });

  it("auto-injects telegram threadId from toolContext when omitted", async () => {
    mocks.executeSendAction.mockResolvedValue({
      handledBy: "plugin",
      payload: {},
    });

    await runMessageAction({
      cfg: telegramConfig,
      action: "send",
      params: {
        channel: "telegram",
        target: "telegram:123",
        message: "hi",
      },
      toolContext: {
        currentChannelId: "telegram:123",
        currentThreadTs: "42",
      },
      agentId: "main",
    });

    const call = mocks.executeSendAction.mock.calls[0]?.[0] as {
      ctx?: { params?: Record<string, unknown> };
    };
    expect(call?.ctx?.params?.threadId).toBe("42");
  });

  it("skips telegram auto-threading when target chat differs", async () => {
    mocks.executeSendAction.mockResolvedValue({
      handledBy: "plugin",
      payload: {},
    });

    await runMessageAction({
      cfg: telegramConfig,
      action: "send",
      params: {
        channel: "telegram",
        target: "telegram:999",
        message: "hi",
      },
      toolContext: {
        currentChannelId: "telegram:123",
        currentThreadTs: "42",
      },
      agentId: "main",
    });

    const call = mocks.executeSendAction.mock.calls[0]?.[0] as {
      ctx?: { params?: Record<string, unknown> };
    };
    expect(call?.ctx?.params?.threadId).toBeUndefined();
  });

  it("matches telegram target with internal prefix variations", async () => {
    mocks.executeSendAction.mockResolvedValue({
      handledBy: "plugin",
      payload: {},
    });

    await runMessageAction({
      cfg: telegramConfig,
      action: "send",
      params: {
        channel: "telegram",
        target: "telegram:group:123",
        message: "hi",
      },
      toolContext: {
        currentChannelId: "telegram:123",
        currentThreadTs: "42",
      },
      agentId: "main",
    });

    const call = mocks.executeSendAction.mock.calls[0]?.[0] as {
      ctx?: { params?: Record<string, unknown> };
    };
    expect(call?.ctx?.params?.threadId).toBe("42");
  });

  it("uses explicit telegram threadId when provided", async () => {
    mocks.executeSendAction.mockResolvedValue({
      handledBy: "plugin",
      payload: {},
    });

    await runMessageAction({
      cfg: telegramConfig,
      action: "send",
      params: {
        channel: "telegram",
        target: "telegram:123",
        message: "hi",
        threadId: "999",
      },
      toolContext: {
        currentChannelId: "telegram:123",
        currentThreadTs: "42",
      },
      agentId: "main",
    });

    const call = mocks.executeSendAction.mock.calls[0]?.[0] as {
      ctx?: { params?: Record<string, unknown> };
    };
    expect(call?.ctx?.params?.threadId).toBe("999");
  });
});
