import { describe, expect, it } from "vitest";
import { createNeuroMetrics } from "./metrics.js";

describe("neuro metrics", () => {
  it("records invoke ui-ready and first-token latencies", () => {
    const metrics = createNeuroMetrics();
    metrics.recordInvokeUiReady(120);
    metrics.recordInvokeUiReady(80);
    metrics.markRunStarted("run-1", 1_000);
    metrics.markFirstToken("run-1", 1_350);

    const snapshot = metrics.getSnapshot(2_000);
    expect(snapshot.invoke.uiReadyMs.count).toBe(2);
    expect(snapshot.invoke.uiReadyMs.min).toBe(80);
    expect(snapshot.invoke.uiReadyMs.max).toBe(120);
    expect(snapshot.invoke.firstTokenMs.count).toBe(1);
    expect(snapshot.invoke.firstTokenMs.p50).toBe(350);
  });

  it("supports run cleanup without sampling", () => {
    const metrics = createNeuroMetrics();
    metrics.markRunStarted("run-2", 1_000);
    metrics.clearRun("run-2");
    metrics.markFirstToken("run-2", 1_500);

    const snapshot = metrics.getSnapshot(2_000);
    expect(snapshot.invoke.firstTokenMs.count).toBe(0);
  });

  it("tracks desktop memory and redaction counters", () => {
    const metrics = createNeuroMetrics();
    metrics.recordDesktopMemoryMb(42.5);
    metrics.recordRedactionLevel("mask");
    metrics.recordRedactionLevel("block");
    metrics.recordRedactionLevel("hash");

    const snapshot = metrics.getSnapshot(2_000);
    expect(snapshot.memory.desktopMb).toBe(42.5);
    expect(snapshot.memory.desktopUpdatedAtMs).not.toBeNull();
    expect(snapshot.redaction.maskCount).toBe(1);
    expect(snapshot.redaction.blockCount).toBe(1);
  });
});
