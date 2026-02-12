type NeuroDistributionStats = {
  count: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  p50: number | null;
  p95: number | null;
};

type NeuroDistribution = {
  values: number[];
  maxSamples: number;
};

const DEFAULT_MAX_SAMPLES = 2048;

function createDistribution(maxSamples = DEFAULT_MAX_SAMPLES): NeuroDistribution {
  return {
    values: [],
    maxSamples: Math.max(32, maxSamples),
  };
}

function addSample(distribution: NeuroDistribution, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    return;
  }
  distribution.values.push(value);
  if (distribution.values.length > distribution.maxSamples) {
    distribution.values.shift();
  }
}

function percentile(sortedValues: number[], p: number): number | null {
  if (sortedValues.length === 0) {
    return null;
  }
  const rank = Math.max(0, Math.min(1, p)) * (sortedValues.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const lowerValue = sortedValues[lower] ?? sortedValues[sortedValues.length - 1] ?? 0;
  const upperValue = sortedValues[upper] ?? lowerValue;
  if (lower === upper) {
    return lowerValue;
  }
  const weight = rank - lower;
  return lowerValue + (upperValue - lowerValue) * weight;
}

function snapshotDistribution(distribution: NeuroDistribution): NeuroDistributionStats {
  if (distribution.values.length === 0) {
    return {
      count: 0,
      min: null,
      max: null,
      avg: null,
      p50: null,
      p95: null,
    };
  }
  const values = distribution.values.toSorted((a, b) => a - b);
  const min = values[0] ?? null;
  const max = values[values.length - 1] ?? null;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return {
    count: values.length,
    min,
    max,
    avg: values.length > 0 ? sum / values.length : null,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
  };
}

function toMb(bytes: number): number {
  return bytes / (1024 * 1024);
}

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

export function createNeuroMetrics() {
  const uiReadyMs = createDistribution();
  const firstTokenMs = createDistribution();
  const pendingRunStartedAt = new Map<string, number>();
  let desktopMemoryMb: number | null = null;
  let desktopUpdatedAtMs: number | null = null;
  let redactionMaskCount = 0;
  let redactionBlockCount = 0;

  return {
    recordInvokeUiReady(durationMs: number): void {
      addSample(uiReadyMs, durationMs);
    },

    markRunStarted(runId: string, startedAtMs = Date.now()): void {
      if (!runId) {
        return;
      }
      pendingRunStartedAt.set(runId, startedAtMs);
    },

    markFirstToken(runId: string, firstTokenAtMs = Date.now()): void {
      const startedAt = pendingRunStartedAt.get(runId);
      if (startedAt == null) {
        return;
      }
      pendingRunStartedAt.delete(runId);
      addSample(firstTokenMs, firstTokenAtMs - startedAt);
    },

    clearRun(runId: string): void {
      pendingRunStartedAt.delete(runId);
    },

    recordDesktopMemoryMb(memoryMb: number): void {
      if (!Number.isFinite(memoryMb) || memoryMb < 0) {
        return;
      }
      desktopMemoryMb = memoryMb;
      desktopUpdatedAtMs = Date.now();
    },

    recordRedactionLevel(level: string): void {
      if (level === "mask") {
        redactionMaskCount += 1;
      } else if (level === "block") {
        redactionBlockCount += 1;
      }
    },

    getSnapshot(nowMs = Date.now()): NeuroMetricsSnapshot {
      const mem = process.memoryUsage();
      return {
        ts: nowMs,
        invoke: {
          uiReadyMs: snapshotDistribution(uiReadyMs),
          firstTokenMs: snapshotDistribution(firstTokenMs),
        },
        memory: {
          gatewayMb: {
            rss: toMb(mem.rss),
            heapUsed: toMb(mem.heapUsed),
            heapTotal: toMb(mem.heapTotal),
            external: toMb(mem.external),
          },
          desktopMb: desktopMemoryMb,
          desktopUpdatedAtMs,
        },
        redaction: {
          maskCount: redactionMaskCount,
          blockCount: redactionBlockCount,
        },
      };
    },
  };
}

export type NeuroMetricsService = ReturnType<typeof createNeuroMetrics>;
