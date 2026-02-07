import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tab } from "./navigation.ts";
import { applySettingsFromUrl } from "./app-settings.ts";

type SettingsHost = Parameters<typeof applySettingsFromUrl>[0] & {
  logsPollInterval: number | null;
  debugPollInterval: number | null;
};

const createHost = (tab: Tab): SettingsHost => ({
  settings: {
    gatewayUrl: "ws://127.0.0.1:19001",
    token: "",
    sessionKey: "main",
    lastActiveSessionKey: "main",
    theme: "system",
    chatFocusMode: false,
    chatShowThinking: true,
    splitRatio: 0.6,
    navCollapsed: false,
    navGroupsCollapsed: {},
  },
  theme: "system",
  themeResolved: "dark",
  applySessionKey: "main",
  sessionKey: "main",
  tab,
  connected: false,
  chatHasAutoScrolled: false,
  logsAtBottom: false,
  eventLog: [],
  eventLogBuffer: [],
  basePath: "",
  themeMedia: null,
  themeMediaHandler: null,
  logsPollInterval: null,
  debugPollInterval: null,
});

describe("applySettingsFromUrl", () => {
  const originalHref = window.location.href;

  afterEach(() => {
    window.history.replaceState({}, "", originalHref);
  });

  it("applies token from URL query and clears it from address bar", () => {
    window.history.pushState({}, "", "/?token=openclaw-dev-token");
    const replaceState = vi.spyOn(window.history, "replaceState");

    const host = createHost("chat");
    applySettingsFromUrl(host);

    expect(host.settings.token).toBe("openclaw-dev-token");
    expect(replaceState).toHaveBeenCalledTimes(1);
    const [, , replacedUrl] = replaceState.mock.calls[0] ?? [];
    expect(String(replacedUrl)).not.toContain("token=");
  });
});
