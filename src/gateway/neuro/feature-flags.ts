export type NeuroFeatureFlagsConfigured = {
  proactiveCards: boolean;
  flowMode: boolean;
  preferenceSync: boolean;
  killSwitch: boolean;
};

export type NeuroFeatureFlagsSnapshot = {
  version: number;
  updatedAtMs: number;
  configured: NeuroFeatureFlagsConfigured;
  effective: {
    proactiveCards: boolean;
    flowMode: boolean;
    preferenceSync: boolean;
    killSwitch: boolean;
  };
};

export type NeuroFeatureFlagsPatch = Partial<NeuroFeatureFlagsConfigured>;

const DEFAULT_FLAGS: NeuroFeatureFlagsConfigured = {
  proactiveCards: false,
  flowMode: false,
  preferenceSync: false,
  killSwitch: false,
};

function buildSnapshot(
  version: number,
  updatedAtMs: number,
  configured: NeuroFeatureFlagsConfigured,
): NeuroFeatureFlagsSnapshot {
  const killSwitch = configured.killSwitch;
  return {
    version,
    updatedAtMs,
    configured: { ...configured },
    effective: {
      killSwitch,
      proactiveCards: killSwitch ? false : configured.proactiveCards,
      flowMode: killSwitch ? false : configured.flowMode,
      preferenceSync: killSwitch ? false : configured.preferenceSync,
    },
  };
}

export function createNeuroFeatureFlags(initial?: NeuroFeatureFlagsPatch) {
  let configured: NeuroFeatureFlagsConfigured = {
    ...DEFAULT_FLAGS,
    ...initial,
  };
  let version = 1;
  let updatedAtMs = Date.now();

  return {
    getSnapshot(): NeuroFeatureFlagsSnapshot {
      return buildSnapshot(version, updatedAtMs, configured);
    },

    set(patch: NeuroFeatureFlagsPatch): NeuroFeatureFlagsSnapshot {
      configured = {
        ...configured,
        ...patch,
      };
      version += 1;
      updatedAtMs = Date.now();
      return buildSnapshot(version, updatedAtMs, configured);
    },
  };
}

export type NeuroFeatureFlagsService = ReturnType<typeof createNeuroFeatureFlags>;
