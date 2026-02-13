import type { SuggestionFeedback } from "../protocol/schema/types.js";
import type { NeuroBehavioralStoreService } from "./behavioral-store.js";

export type NeuroPredictionSource = "clipboard" | "active_window" | "terminal" | "fs" | "editor";
export type NeuroPredictionAction = "suggest" | "auto_apply" | "ignore";

export type NeuroPredictionDecision = {
  sessionKey: string;
  source: NeuroPredictionSource;
  signal: string;
  normalizedSignal: string;
  patternKey: string;
  patternHash: string;
  action: NeuroPredictionAction;
  suppressed: boolean;
  confidence: number;
  similarCount: number;
  acceptRate: number;
  reasonCodes: string[];
  preference: "auto_apply" | "suggest" | "ignore" | null;
  lastEventTs: number | null;
};

type PredictInput = {
  sessionKey: string;
  source: NeuroPredictionSource;
  signal: string;
  nowMs?: number;
};

type NeuroPredictionEngineOptions = {
  behavioralStore: NeuroBehavioralStoreService;
  now?: () => number;
  suppressionWindowMs?: number;
  minSignalChars?: number;
  maxSuppressionEntries?: number;
};

const DEFAULT_SUPPRESSION_WINDOW_MS = 2 * 60 * 1000;
const DEFAULT_MIN_SIGNAL_CHARS = 4;
const DEFAULT_MAX_SUPPRESSION_ENTRIES = 4_096;

type SuppressionRecord = {
  suggestedAtMs: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizePredictionSignal(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildPredictionPatternKey(source: NeuroPredictionSource, signal: string): string {
  return `${source}:${normalizePredictionSignal(signal)}`;
}

function resolveAction(params: {
  similarCount: number;
  acceptRate: number;
  preference: "auto_apply" | "suggest" | "ignore" | null;
}): NeuroPredictionAction {
  if (params.preference === "ignore") {
    return "ignore";
  }
  if (params.preference === "auto_apply") {
    return "auto_apply";
  }
  if (params.similarCount >= 5 && params.acceptRate >= 0.8) {
    return "auto_apply";
  }
  return "suggest";
}

export function createNeuroPredictionEngine(options: NeuroPredictionEngineOptions) {
  const now = options.now ?? (() => Date.now());
  const suppressionWindowMs = Math.max(
    1_000,
    Math.floor(options.suppressionWindowMs ?? DEFAULT_SUPPRESSION_WINDOW_MS),
  );
  const minSignalChars = Math.max(
    1,
    Math.floor(options.minSignalChars ?? DEFAULT_MIN_SIGNAL_CHARS),
  );
  const maxSuppressionEntries = Math.max(
    128,
    Math.floor(options.maxSuppressionEntries ?? DEFAULT_MAX_SUPPRESSION_ENTRIES),
  );
  const suppression = new Map<string, SuppressionRecord>();

  function suppressionKey(sessionKey: string, patternHash: string): string {
    return `${sessionKey}:${patternHash}`;
  }

  function cleanupSuppression(nowMs: number) {
    for (const [key, value] of suppression) {
      if (nowMs - value.suggestedAtMs > suppressionWindowMs) {
        suppression.delete(key);
      }
    }
    if (suppression.size <= maxSuppressionEntries) {
      return;
    }
    const ordered = Array.from(suppression.entries()).toSorted(
      (a, b) => a[1].suggestedAtMs - b[1].suggestedAtMs,
    );
    for (let i = 0; i < ordered.length - maxSuppressionEntries; i += 1) {
      const key = ordered[i]?.[0];
      if (key) {
        suppression.delete(key);
      }
    }
  }

  function predict(input: PredictInput): NeuroPredictionDecision {
    const nowMs = typeof input.nowMs === "number" ? input.nowMs : now();
    cleanupSuppression(nowMs);

    const normalizedSignal = normalizePredictionSignal(input.signal);
    const patternKey = buildPredictionPatternKey(input.source, input.signal);
    const patternHash = options.behavioralStore.hashPattern(`suggestion:${patternKey}`);

    if (normalizedSignal.length < minSignalChars) {
      return {
        sessionKey: input.sessionKey,
        source: input.source,
        signal: input.signal,
        normalizedSignal,
        patternKey,
        patternHash,
        action: "ignore",
        suppressed: false,
        confidence: 0,
        similarCount: 0,
        acceptRate: 0,
        reasonCodes: ["SIGNAL_TOO_SHORT"],
        preference: null,
        lastEventTs: null,
      };
    }

    const stats = options.behavioralStore.getPatternStats({
      patternHash,
      sessionKey: input.sessionKey,
    });
    const positiveFeedback = stats.acceptCount + stats.modifyCount;
    const acceptRate = stats.feedbackTotal > 0 ? positiveFeedback / stats.feedbackTotal : 0;

    const reasons: string[] = [];
    if (stats.eventCount > 0) {
      reasons.push("SIMILAR_HISTORY");
    } else {
      reasons.push("COLD_START");
    }
    if (acceptRate >= 0.7 && stats.feedbackTotal >= 3) {
      reasons.push("HIGH_ACCEPT_RATE");
    }
    if (stats.preference) {
      reasons.push(`PREFERENCE_${stats.preference.preference.toUpperCase()}`);
    }

    const supKey = suppressionKey(input.sessionKey, patternHash);
    const existingSuppression = suppression.get(supKey);
    if (existingSuppression && nowMs - existingSuppression.suggestedAtMs <= suppressionWindowMs) {
      return {
        sessionKey: input.sessionKey,
        source: input.source,
        signal: input.signal,
        normalizedSignal,
        patternKey,
        patternHash,
        action: "ignore",
        suppressed: true,
        confidence: 0,
        similarCount: stats.eventCount,
        acceptRate,
        reasonCodes: [...reasons, "SUPPRESSED_RECENT_SIGNAL"],
        preference: stats.preference?.preference ?? null,
        lastEventTs: stats.lastEventTs,
      };
    }

    const action = resolveAction({
      similarCount: stats.eventCount,
      acceptRate,
      preference: stats.preference?.preference ?? null,
    });
    const confidence = clamp(
      0.2 +
        Math.min(0.35, stats.eventCount * 0.04) +
        clamp(acceptRate, 0, 1) * 0.4 +
        (action === "auto_apply" ? 0.1 : 0),
      0,
      0.95,
    );

    if (action !== "ignore") {
      suppression.set(supKey, { suggestedAtMs: nowMs });
    }

    return {
      sessionKey: input.sessionKey,
      source: input.source,
      signal: input.signal,
      normalizedSignal,
      patternKey,
      patternHash,
      action,
      suppressed: false,
      confidence,
      similarCount: stats.eventCount,
      acceptRate,
      reasonCodes: reasons,
      preference: stats.preference?.preference ?? null,
      lastEventTs: stats.lastEventTs,
    };
  }

  function registerFeedback(params: {
    sessionKey: string;
    source: NeuroPredictionSource;
    signal: string;
    action: SuggestionFeedback["action"];
    nowMs?: number;
  }) {
    const nowMs = typeof params.nowMs === "number" ? params.nowMs : now();
    const patternKey = buildPredictionPatternKey(params.source, params.signal);
    const patternHash = options.behavioralStore.hashPattern(`suggestion:${patternKey}`);
    const supKey = suppressionKey(params.sessionKey, patternHash);
    if (params.action === "dismiss" || params.action === "ignore") {
      suppression.set(supKey, { suggestedAtMs: nowMs });
      return;
    }
    suppression.delete(supKey);
  }

  return {
    predict,
    registerFeedback,
  };
}

export type NeuroPredictionEngineService = ReturnType<typeof createNeuroPredictionEngine>;
