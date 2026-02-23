import { describe, expect, it } from "vitest";
import { resolveDesktopMvpSlimMode } from "./desktop-mvp.js";

describe("resolveDesktopMvpSlimMode", () => {
  it("returns false by default", () => {
    expect(resolveDesktopMvpSlimMode({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("accepts OPENCLAW_DESKTOP_MVP_SLIM", () => {
    expect(
      resolveDesktopMvpSlimMode({
        OPENCLAW_DESKTOP_MVP_SLIM: "1",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it("accepts CLAWDBOT_DESKTOP_MVP_SLIM", () => {
    expect(
      resolveDesktopMvpSlimMode({
        CLAWDBOT_DESKTOP_MVP_SLIM: "true",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });
});
