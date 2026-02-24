import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import { setActiveWebListener } from "../../web/active-listener.js";
import { handleWhatsAppAction } from "./whatsapp-actions.js";

const sendReactionDefault = vi.fn(async () => undefined);
const sendReactionWork = vi.fn(async () => undefined);

const defaultListener = {
  sendMessage: vi.fn(async () => ({ messageId: "msg-default" })),
  sendPoll: vi.fn(async () => ({ messageId: "poll-default" })),
  sendReaction: (...args: Parameters<typeof sendReactionDefault>) => sendReactionDefault(...args),
  sendComposingTo: vi.fn(async () => undefined),
};

const workListener = {
  sendMessage: vi.fn(async () => ({ messageId: "msg-work" })),
  sendPoll: vi.fn(async () => ({ messageId: "poll-work" })),
  sendReaction: (...args: Parameters<typeof sendReactionWork>) => sendReactionWork(...args),
  sendComposingTo: vi.fn(async () => undefined),
};

const enabledConfig = {
  channels: { whatsapp: { actions: { reactions: true } } },
} as OpenClawConfig;

describe("handleWhatsAppAction", () => {
  beforeEach(() => {
    setActiveWebListener(defaultListener);
    setActiveWebListener("work", workListener);
    vi.clearAllMocks();
  });

  afterEach(() => {
    setActiveWebListener(null);
    setActiveWebListener("work", null);
  });

  it("adds reactions", async () => {
    await handleWhatsAppAction(
      {
        action: "react",
        chatJid: "123@s.whatsapp.net",
        messageId: "msg1",
        emoji: "✅",
      },
      enabledConfig,
    );
    expect(sendReactionDefault).toHaveBeenCalledWith(
      "123@s.whatsapp.net",
      "msg1",
      "✅",
      false,
      undefined,
    );
  });

  it("removes reactions on empty emoji", async () => {
    await handleWhatsAppAction(
      {
        action: "react",
        chatJid: "123@s.whatsapp.net",
        messageId: "msg1",
        emoji: "",
      },
      enabledConfig,
    );
    expect(sendReactionDefault).toHaveBeenCalledWith(
      "123@s.whatsapp.net",
      "msg1",
      "",
      false,
      undefined,
    );
  });

  it("removes reactions when remove flag set", async () => {
    await handleWhatsAppAction(
      {
        action: "react",
        chatJid: "123@s.whatsapp.net",
        messageId: "msg1",
        emoji: "✅",
        remove: true,
      },
      enabledConfig,
    );
    expect(sendReactionDefault).toHaveBeenCalledWith(
      "123@s.whatsapp.net",
      "msg1",
      "",
      false,
      undefined,
    );
  });

  it("passes account scope and sender flags", async () => {
    await handleWhatsAppAction(
      {
        action: "react",
        chatJid: "123@s.whatsapp.net",
        messageId: "msg1",
        emoji: "🎉",
        accountId: "work",
        fromMe: true,
        participant: "999@s.whatsapp.net",
      },
      enabledConfig,
    );
    expect(sendReactionWork).toHaveBeenCalledWith(
      "123@s.whatsapp.net",
      "msg1",
      "🎉",
      true,
      "999@s.whatsapp.net",
    );
  });

  it("respects reaction gating", async () => {
    const cfg = {
      channels: { whatsapp: { actions: { reactions: false } } },
    } as OpenClawConfig;
    await expect(
      handleWhatsAppAction(
        {
          action: "react",
          chatJid: "123@s.whatsapp.net",
          messageId: "msg1",
          emoji: "✅",
        },
        cfg,
      ),
    ).rejects.toThrow(/WhatsApp reactions are disabled/);
  });
});
