import type { ContextEvent } from "../protocol/schema/types.js";
import type { NeuroContextSource } from "./redaction.js";

type RingBufferEntry = {
  event: ContextEvent;
  bytes: number;
};

type RingBufferBucket = {
  entries: RingBufferEntry[];
  totalBytes: number;
};

type SessionBuckets = Map<NeuroContextSource, RingBufferBucket>;

const SOURCE_KEYS: NeuroContextSource[] = [
  "clipboard",
  "active_window",
  "terminal",
  "fs",
  "editor",
];

export type NeuroContextRingBufferLimits = {
  ttlMsBySource: Record<NeuroContextSource, number>;
  maxEventsBySource: Record<NeuroContextSource, number>;
  maxBytesBySource: Record<NeuroContextSource, number>;
};

export type NeuroContextRingBufferOptions = Partial<NeuroContextRingBufferLimits>;

export type NeuroContextSnapshot = {
  sessionKey: string;
  totalBytes: number;
  totalEvents: number;
  events: ContextEvent[];
  perSource: Record<
    NeuroContextSource,
    {
      count: number;
      bytes: number;
      latestTs: number | null;
    }
  >;
};

const DEFAULT_LIMITS: NeuroContextRingBufferLimits = {
  ttlMsBySource: {
    clipboard: 30_000,
    active_window: 120_000,
    terminal: 120_000,
    fs: 120_000,
    editor: 120_000,
  },
  maxEventsBySource: {
    clipboard: 120,
    active_window: 120,
    terminal: 120,
    fs: 120,
    editor: 120,
  },
  maxBytesBySource: {
    clipboard: 512 * 1024,
    active_window: 256 * 1024,
    terminal: 512 * 1024,
    fs: 256 * 1024,
    editor: 512 * 1024,
  },
};

function mergeLimits(options?: NeuroContextRingBufferOptions): NeuroContextRingBufferLimits {
  return {
    ttlMsBySource: {
      ...DEFAULT_LIMITS.ttlMsBySource,
      ...options?.ttlMsBySource,
    },
    maxEventsBySource: {
      ...DEFAULT_LIMITS.maxEventsBySource,
      ...options?.maxEventsBySource,
    },
    maxBytesBySource: {
      ...DEFAULT_LIMITS.maxBytesBySource,
      ...options?.maxBytesBySource,
    },
  };
}

function estimateEventBytes(event: ContextEvent): number {
  return Buffer.byteLength(JSON.stringify(event), "utf8");
}

function toEntry(event: ContextEvent): RingBufferEntry {
  return {
    event,
    bytes: estimateEventBytes(event),
  };
}

function emptyBucket(): RingBufferBucket {
  return {
    entries: [],
    totalBytes: 0,
  };
}

function getBucket(sessionBuckets: SessionBuckets, source: NeuroContextSource): RingBufferBucket {
  const existing = sessionBuckets.get(source);
  if (existing) {
    return existing;
  }
  const created = emptyBucket();
  sessionBuckets.set(source, created);
  return created;
}

function removeOldestEntry(bucket: RingBufferBucket): boolean {
  const oldest = bucket.entries.shift();
  if (!oldest) {
    return false;
  }
  bucket.totalBytes = Math.max(0, bucket.totalBytes - oldest.bytes);
  return true;
}

function pruneBucket(
  bucket: RingBufferBucket,
  source: NeuroContextSource,
  nowMs: number,
  limits: NeuroContextRingBufferLimits,
): number {
  let dropped = 0;
  const ttlMs = Math.max(0, limits.ttlMsBySource[source]);
  if (ttlMs > 0) {
    const cutoff = nowMs - ttlMs;
    while (bucket.entries.length > 0) {
      const first = bucket.entries[0];
      if (!first || first.event.ts >= cutoff) {
        break;
      }
      if (!removeOldestEntry(bucket)) {
        break;
      }
      dropped += 1;
    }
  }

  const maxEvents = Math.max(1, limits.maxEventsBySource[source]);
  while (bucket.entries.length > maxEvents) {
    if (!removeOldestEntry(bucket)) {
      break;
    }
    dropped += 1;
  }

  const maxBytes = Math.max(1, limits.maxBytesBySource[source]);
  while (bucket.totalBytes > maxBytes && bucket.entries.length > 1) {
    if (!removeOldestEntry(bucket)) {
      break;
    }
    dropped += 1;
  }

  return dropped;
}

function buildEmptyPerSource(): NeuroContextSnapshot["perSource"] {
  return {
    clipboard: { count: 0, bytes: 0, latestTs: null },
    active_window: { count: 0, bytes: 0, latestTs: null },
    terminal: { count: 0, bytes: 0, latestTs: null },
    fs: { count: 0, bytes: 0, latestTs: null },
    editor: { count: 0, bytes: 0, latestTs: null },
  };
}

function sessionSnapshotFromBuckets(
  sessionKey: string,
  buckets?: SessionBuckets,
): NeuroContextSnapshot {
  if (!buckets) {
    return {
      sessionKey,
      totalBytes: 0,
      totalEvents: 0,
      events: [],
      perSource: buildEmptyPerSource(),
    };
  }
  const perSource = buildEmptyPerSource();
  const events: ContextEvent[] = [];
  let totalBytes = 0;
  let totalEvents = 0;

  for (const source of SOURCE_KEYS) {
    const bucket = buckets.get(source);
    if (!bucket) {
      continue;
    }
    const latestTs = bucket.entries.at(-1)?.event.ts ?? null;
    perSource[source] = {
      count: bucket.entries.length,
      bytes: bucket.totalBytes,
      latestTs,
    };
    totalEvents += bucket.entries.length;
    totalBytes += bucket.totalBytes;
    events.push(...bucket.entries.map((entry) => entry.event));
  }

  events.sort((a, b) => a.ts - b.ts);
  return {
    sessionKey,
    totalBytes,
    totalEvents,
    events,
    perSource,
  };
}

export function createNeuroContextRingBuffer(options?: NeuroContextRingBufferOptions) {
  const limits = mergeLimits(options);
  const sessions = new Map<string, SessionBuckets>();

  function getSessionBuckets(sessionKey: string): SessionBuckets {
    const existing = sessions.get(sessionKey);
    if (existing) {
      return existing;
    }
    const created = new Map<NeuroContextSource, RingBufferBucket>();
    sessions.set(sessionKey, created);
    return created;
  }

  function removeEmptySessions(): void {
    for (const [sessionKey, buckets] of sessions) {
      let keepSession = false;
      for (const source of SOURCE_KEYS) {
        const bucket = buckets.get(source);
        if (!bucket || bucket.entries.length === 0) {
          buckets.delete(source);
          continue;
        }
        keepSession = true;
      }
      if (!keepSession) {
        sessions.delete(sessionKey);
      }
    }
  }

  function prune(nowMs = Date.now()): number {
    let dropped = 0;
    for (const buckets of sessions.values()) {
      for (const source of SOURCE_KEYS) {
        const bucket = buckets.get(source);
        if (!bucket) {
          continue;
        }
        dropped += pruneBucket(bucket, source, nowMs, limits);
      }
    }
    removeEmptySessions();
    return dropped;
  }

  return {
    append(event: ContextEvent, nowMs = Date.now()): { dropped: number } {
      const sessionBuckets = getSessionBuckets(event.sessionKey);
      const bucket = getBucket(sessionBuckets, event.source);
      const entry = toEntry(event);
      bucket.entries.push(entry);
      bucket.totalBytes += entry.bytes;
      const dropped = pruneBucket(bucket, event.source, nowMs, limits);
      removeEmptySessions();
      return { dropped };
    },

    prune,

    snapshot(sessionKey: string, nowMs = Date.now()): NeuroContextSnapshot {
      prune(nowMs);
      return sessionSnapshotFromBuckets(sessionKey, sessions.get(sessionKey));
    },

    stats(nowMs = Date.now()): { sessions: number; totalEvents: number; totalBytes: number } {
      prune(nowMs);
      let totalEvents = 0;
      let totalBytes = 0;
      for (const buckets of sessions.values()) {
        for (const source of SOURCE_KEYS) {
          const bucket = buckets.get(source);
          if (!bucket) {
            continue;
          }
          totalEvents += bucket.entries.length;
          totalBytes += bucket.totalBytes;
        }
      }
      return {
        sessions: sessions.size,
        totalEvents,
        totalBytes,
      };
    },

    clear(sessionKey?: string): void {
      if (sessionKey) {
        sessions.delete(sessionKey);
        return;
      }
      sessions.clear();
    },

    limits,
  };
}

export type NeuroContextRingBuffer = ReturnType<typeof createNeuroContextRingBuffer>;
