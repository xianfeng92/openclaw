import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { DEFAULT_ASSISTANT_IDENTITY, resolveAssistantIdentity } from "./assistant-identity.js";

describe("resolveAssistantIdentity avatar normalization", () => {
  it("drops sentence-like avatar placeholders", () => {
    const cfg: OpenClawConfig = {
      ui: {
        assistant: {
          avatar: "workspace-relative path, http(s) URL, or data URI",
        },
      },
    };

    expect(resolveAssistantIdentity({ cfg, workspaceDir: "" }).avatar).toBe(
      DEFAULT_ASSISTANT_IDENTITY.avatar,
    );
  });

  it("keeps short text avatars", () => {
    const cfg: OpenClawConfig = {
      ui: {
        assistant: {
          avatar: "PS",
        },
      },
    };

    expect(resolveAssistantIdentity({ cfg, workspaceDir: "" }).avatar).toBe("PS");
  });

  it("keeps path avatars", () => {
    const cfg: OpenClawConfig = {
      ui: {
        assistant: {
          avatar: "avatars/openclaw.png",
        },
      },
    };

    expect(resolveAssistantIdentity({ cfg, workspaceDir: "" }).avatar).toBe("avatars/openclaw.png");
  });
});

describe("resolveAssistantIdentity emoji normalization", () => {
  it("extracts a leading emoji from annotated values", () => {
    const cfg: OpenClawConfig = {
      ui: {
        assistant: {},
      },
      agents: {
        list: [
          {
            id: "main",
            identity: {
              emoji: "🤖 (or ⚠️ when alarmed)",
            },
          },
        ],
      },
    };

    expect(resolveAssistantIdentity({ cfg, agentId: "main", workspaceDir: "" }).emoji).toBe("🤖");
  });

  it("does not accept truncated emoji commentary", () => {
    const cfg: OpenClawConfig = {
      agents: {
        list: [
          {
            id: "main",
            identity: {
              // Previously this could be truncated upstream and still pass max-length checks.
              emoji: "🤖 (or ⚠️ when alarmed)",
            },
          },
        ],
      },
    };

    const res = resolveAssistantIdentity({ cfg, agentId: "main", workspaceDir: "" });
    expect(res.emoji).toBe("🤖");
  });
});
