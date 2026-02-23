import type { GatewayBrowserClient } from "../gateway.ts";
import type { HealthSnapshot, StatusSummary } from "../types.ts";

export type NeuroFlagKey = "proactiveCards" | "flowMode" | "preferenceSync" | "killSwitch";

export type NeuroFlagsState = {
  proactiveCards: boolean;
  flowMode: boolean;
  preferenceSync: boolean;
  killSwitch: boolean;
};

export type NeuroFlagsSnapshot = {
  version: number;
  updatedAtMs: number;
  configured: NeuroFlagsState;
  effective: NeuroFlagsState;
};

export type NeuroDistributionStats = {
  count: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  p50: number | null;
  p95: number | null;
};

export type NeuroMetricsSnapshot = {
  ts: number;
  invoke: {
    uiReadyMs: NeuroDistributionStats;
    firstTokenMs: NeuroDistributionStats;
  };
  memory: {
    gatewayMb: {
      rss: number;
      heapUsed: number;
      heapTotal: number;
      external: number;
    };
    desktopMb: number | null;
    desktopUpdatedAtMs: number | null;
  };
  redaction: {
    maskCount: number;
    blockCount: number;
  };
};

export type DebugState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  debugLoading: boolean;
  debugStatus: StatusSummary | null;
  debugHealth: HealthSnapshot | null;
  debugModels: unknown[];
  debugHeartbeat: unknown;
  debugNeuroFlags: NeuroFlagsSnapshot | null;
  debugNeuroMetrics: NeuroMetricsSnapshot | null;
  debugNeuroSaving: boolean;
  debugNeuroError: string | null;
  debugCallMethod: string;
  debugCallParams: string;
  debugCallResult: string | null;
  debugCallError: string | null;
};

export async function loadDebug(state: DebugState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.debugLoading) {
    return;
  }
  state.debugLoading = true;
  state.debugNeuroError = null;
  try {
    const [status, health, models, heartbeat] = await Promise.all([
      state.client.request("status", {}),
      state.client.request("health", {}),
      state.client.request("models.list", {}),
      state.client.request("last-heartbeat", {}),
    ]);
    state.debugStatus = status as StatusSummary;
    state.debugHealth = health as HealthSnapshot;
    const modelPayload = models as { models?: unknown[] } | undefined;
    state.debugModels = Array.isArray(modelPayload?.models) ? modelPayload?.models : [];
    state.debugHeartbeat = heartbeat;
    const [flagsRes, metricsRes] = await Promise.allSettled([
      state.client.request("neuro.flags.get", {}),
      state.client.request("neuro.metrics.get", {}),
    ]);
    if (flagsRes.status === "fulfilled") {
      state.debugNeuroFlags = flagsRes.value as NeuroFlagsSnapshot;
    } else {
      state.debugNeuroError = String(flagsRes.reason);
    }
    if (metricsRes.status === "fulfilled") {
      state.debugNeuroMetrics = metricsRes.value as NeuroMetricsSnapshot;
    } else {
      const nextError = String(metricsRes.reason);
      state.debugNeuroError = state.debugNeuroError
        ? `${state.debugNeuroError}\n${nextError}`
        : nextError;
    }
  } catch (err) {
    state.debugCallError = String(err);
  } finally {
    state.debugLoading = false;
  }
}

export async function setNeuroFlag(state: DebugState, key: NeuroFlagKey, enabled: boolean) {
  if (!state.client || !state.connected || state.debugNeuroSaving) {
    return;
  }
  state.debugNeuroSaving = true;
  state.debugNeuroError = null;
  try {
    const snapshot = await state.client.request<NeuroFlagsSnapshot>("neuro.flags.set", {
      [key]: enabled,
    });
    state.debugNeuroFlags = snapshot;
  } catch (err) {
    state.debugNeuroError = String(err);
  } finally {
    state.debugNeuroSaving = false;
  }
}

export async function callDebugMethod(state: DebugState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.debugCallError = null;
  state.debugCallResult = null;
  try {
    const params = state.debugCallParams.trim()
      ? (JSON.parse(state.debugCallParams) as unknown)
      : {};
    const res = await state.client.request(state.debugCallMethod.trim(), params);
    state.debugCallResult = JSON.stringify(res, null, 2);
  } catch (err) {
    state.debugCallError = String(err);
  }
}
