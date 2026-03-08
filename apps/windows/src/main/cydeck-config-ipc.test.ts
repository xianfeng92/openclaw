import { describe, expect, it } from "vitest";
import {
  assignConfigPathValue,
  coerceCyDeckConfigValue,
  isCyDeckMutableConfigKey,
} from "./cydeck-config-ipc.js";

describe("cydeck-config-ipc key allowlist", () => {
  it("accepts supported keys", () => {
    expect(isCyDeckMutableConfigKey("gateway.port")).toBe(true);
    expect(isCyDeckMutableConfigKey("workspace.path")).toBe(true);
    expect(isCyDeckMutableConfigKey("ai.providers.openai.model")).toBe(true);
    expect(isCyDeckMutableConfigKey("terminal.allowShell")).toBe(true);
  });

  it("rejects unsupported keys", () => {
    expect(isCyDeckMutableConfigKey("meta.lastTouchedVersion")).toBe(false);
    expect(isCyDeckMutableConfigKey("ai.providers.openai.extra")).toBe(false);
  });
});

describe("cydeck-config-ipc value coercion", () => {
  it("coerces booleans", () => {
    const trueValue = coerceCyDeckConfigValue("gateway.autoStart", "true");
    const falseValue = coerceCyDeckConfigValue("workspace.autoCreate", "0");
    const shellValue = coerceCyDeckConfigValue("terminal.allowShell", "yes");

    expect(trueValue).toEqual({ ok: true, value: true });
    expect(falseValue).toEqual({ ok: true, value: false });
    expect(shellValue).toEqual({ ok: true, value: true });
  });

  it("coerces numeric values", () => {
    const gatewayPort = coerceCyDeckConfigValue("gateway.port", "19001");
    const maxTokens = coerceCyDeckConfigValue("ai.providers.openai.maxTokens", "4096");

    expect(gatewayPort).toEqual({ ok: true, value: 19001 });
    expect(maxTokens).toEqual({ ok: true, value: 4096 });
  });

  it("rejects invalid providers and invalid numbers", () => {
    const provider = coerceCyDeckConfigValue("ai.defaultProvider", "unknown");
    const port = coerceCyDeckConfigValue("gateway.port", "99999");

    expect(provider.ok).toBe(false);
    expect(port.ok).toBe(false);
  });

  it("keeps string values and strips wrapping quotes", () => {
    const quoted = coerceCyDeckConfigValue("workspace.path", "\"./my workspace\"");
    const raw = coerceCyDeckConfigValue("ui.theme", "cydeck");

    expect(quoted).toEqual({ ok: true, value: "./my workspace" });
    expect(raw).toEqual({ ok: true, value: "cydeck" });
  });

  it("rejects model values that contain whitespace", () => {
    const model = coerceCyDeckConfigValue("ai.providers.google.model", "gemini-3-flash-preview /config");
    expect(model.ok).toBe(false);
  });
});

describe("cydeck-config-ipc path assignment", () => {
  it("assigns nested values", () => {
    const target: Record<string, unknown> = {};
    assignConfigPathValue(target, "ai.providers.openai.model", "gpt-4o-mini");
    assignConfigPathValue(target, "gateway.port", 19001);

    expect(target).toEqual({
      ai: {
        providers: {
          openai: {
            model: "gpt-4o-mini",
          },
        },
      },
      gateway: {
        port: 19001,
      },
    });
  });
});
