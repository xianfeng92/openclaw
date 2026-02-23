import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginRegistry } from "../plugins/registry.js";

const loadOpenClawPlugins = vi.hoisted(() => vi.fn());

vi.mock("../plugins/loader.js", () => ({
  loadOpenClawPlugins,
}));

const createRegistry = (): PluginRegistry => ({
  plugins: [],
  tools: [],
  hooks: [],
  typedHooks: [],
  channels: [],
  providers: [],
  gatewayHandlers: {},
  httpHandlers: [],
  httpRoutes: [],
  cliRegistrars: [],
  services: [],
  commands: [],
  diagnostics: [],
});

afterEach(() => {
  delete process.env.OPENCLAW_DESKTOP_MVP_SLIM;
  delete process.env.CLAWDBOT_DESKTOP_MVP_SLIM;
  loadOpenClawPlugins.mockReset();
  vi.resetModules();
});

describe("loadGatewayPlugins in desktop MVP slim mode", () => {
  it("forces plugins.enabled=false when slim mode is enabled", async () => {
    process.env.OPENCLAW_DESKTOP_MVP_SLIM = "1";
    loadOpenClawPlugins.mockReturnValue(createRegistry());
    const { loadGatewayPlugins } = await import("./server-plugins.js");
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    loadGatewayPlugins({
      cfg: {
        plugins: {
          enabled: true,
        },
      },
      workspaceDir: "/tmp",
      log,
      coreGatewayHandlers: {},
      baseMethods: [],
    });

    expect(loadOpenClawPlugins).toHaveBeenCalledTimes(1);
    const call = loadOpenClawPlugins.mock.calls[0]?.[0] as { config?: { plugins?: { enabled?: boolean } } };
    expect(call.config?.plugins?.enabled).toBe(false);
    expect(log.info).toHaveBeenCalledWith("desktop MVP slim mode: plugin ecosystem disabled");
  });

  it("passes through plugin config when slim mode is disabled", async () => {
    loadOpenClawPlugins.mockReturnValue(createRegistry());
    const { loadGatewayPlugins } = await import("./server-plugins.js");
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    loadGatewayPlugins({
      cfg: {
        plugins: {
          enabled: true,
        },
      },
      workspaceDir: "/tmp",
      log,
      coreGatewayHandlers: {},
      baseMethods: [],
    });

    expect(loadOpenClawPlugins).toHaveBeenCalledTimes(1);
    const call = loadOpenClawPlugins.mock.calls[0]?.[0] as { config?: { plugins?: { enabled?: boolean } } };
    expect(call.config?.plugins?.enabled).toBe(true);
    expect(log.info).not.toHaveBeenCalledWith("desktop MVP slim mode: plugin ecosystem disabled");
  });
});
