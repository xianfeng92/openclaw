import { describe, expect, it } from "vitest";
import { createNeuroFeatureFlags } from "./feature-flags.js";

describe("neuro feature flags", () => {
  it("starts from safe defaults", () => {
    const flags = createNeuroFeatureFlags();
    const snapshot = flags.getSnapshot();
    expect(snapshot.version).toBe(1);
    expect(snapshot.configured).toEqual({
      proactiveCards: false,
      flowMode: false,
      preferenceSync: false,
      killSwitch: false,
    });
    expect(snapshot.effective).toEqual(snapshot.configured);
  });

  it("applies flag updates and increments version", () => {
    const flags = createNeuroFeatureFlags();
    const before = flags.getSnapshot();
    const after = flags.set({ proactiveCards: true, flowMode: true });
    expect(after.version).toBe(before.version + 1);
    expect(after.configured.proactiveCards).toBe(true);
    expect(after.effective.proactiveCards).toBe(true);
    expect(after.configured.flowMode).toBe(true);
    expect(after.effective.flowMode).toBe(true);
  });

  it("enforces kill switch on effective flags", () => {
    const flags = createNeuroFeatureFlags({
      proactiveCards: true,
      flowMode: true,
      preferenceSync: true,
    });
    const snapshot = flags.set({ killSwitch: true });
    expect(snapshot.configured.proactiveCards).toBe(true);
    expect(snapshot.configured.flowMode).toBe(true);
    expect(snapshot.configured.preferenceSync).toBe(true);
    expect(snapshot.configured.killSwitch).toBe(true);
    expect(snapshot.effective.proactiveCards).toBe(false);
    expect(snapshot.effective.flowMode).toBe(false);
    expect(snapshot.effective.preferenceSync).toBe(false);
    expect(snapshot.effective.killSwitch).toBe(true);
  });
});
