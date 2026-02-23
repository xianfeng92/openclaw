import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderDebug, type DebugProps } from "./debug.ts";

function createProps(overrides: Partial<DebugProps> = {}): DebugProps {
  return {
    loading: false,
    status: null,
    health: null,
    models: [],
    heartbeat: null,
    neuroFlags: null,
    neuroMetrics: null,
    neuroSaving: false,
    neuroError: null,
    eventLog: [],
    callMethod: "",
    callParams: "{}",
    callResult: null,
    callError: null,
    onToggleFlag: () => undefined,
    onCallMethodChange: () => undefined,
    onCallParamsChange: () => undefined,
    onRefresh: () => undefined,
    onCall: () => undefined,
    ...overrides,
  };
}

describe("debug neuro panel", () => {
  it("renders neuro metrics summary when payload exists", () => {
    const container = document.createElement("div");
    render(
      renderDebug(
        createProps({
          neuroMetrics: {
            ts: 1_700_000_000_000,
            invoke: {
              uiReadyMs: { count: 3, min: 25, max: 61, avg: 40, p50: 39, p95: 58 },
              firstTokenMs: {
                count: 2,
                min: 350,
                max: 900,
                avg: 625,
                p50: 625,
                p95: 890,
              },
            },
            memory: {
              gatewayMb: { rss: 170.2, heapUsed: 88.1, heapTotal: 120.3, external: 6.2 },
              desktopMb: 240.4,
              desktopUpdatedAtMs: 1_700_000_000_000,
            },
            redaction: { maskCount: 2, blockCount: 1 },
          },
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Neuro Metrics");
    expect(container.textContent).toContain("mask=2");
    expect(container.textContent).toContain("block=1");
    expect(container.textContent).toContain("UI Ready Latency");
    expect(container.textContent).toContain("First Token Latency");
  });

  it("calls toggle handler when flag checkbox changes", () => {
    const container = document.createElement("div");
    const onToggleFlag = vi.fn();
    render(
      renderDebug(
        createProps({
          neuroFlags: {
            version: 3,
            updatedAtMs: Date.now(),
            configured: {
              proactiveCards: false,
              flowMode: false,
              preferenceSync: false,
              killSwitch: false,
            },
            effective: {
              proactiveCards: false,
              flowMode: false,
              preferenceSync: false,
              killSwitch: false,
            },
          },
          onToggleFlag,
        }),
      ),
      container,
    );

    const input = container.querySelector<HTMLInputElement>(
      'input[data-neuro-flag="proactiveCards"]',
    );
    expect(input).not.toBeNull();
    if (!input) {
      return;
    }
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onToggleFlag).toHaveBeenCalledWith("proactiveCards", true);
  });
});
