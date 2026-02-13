import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SuggestionCard, SuggestionFeedback } from "../protocol/schema/types.js";
import { resolveStateDir } from "../../config/paths.js";

export type NeuroBehavioralEventType = "suggestion" | "feedback";
export type NeuroPatternPreference = "auto_apply" | "suggest" | "ignore";

export type NeuroBehavioralEvent = {
  id: string;
  ts: number;
  sessionKey: string;
  type: NeuroBehavioralEventType;
  patternHash: string;
  suggestionId: string | null;
  mode: SuggestionCard["mode"] | null;
  userAction: SuggestionFeedback["action"] | null;
  confidence: number | null;
  workspace: string | null;
  filePath: string | null;
  appName: string | null;
  metadata: Record<string, unknown>;
};

export type NeuroBehavioralPreference = {
  patternHash: string;
  preference: NeuroPatternPreference;
  score: number;
  updatedAtMs: number;
};

export type NeuroBehavioralPatternStats = {
  patternHash: string;
  sessionKey: string | null;
  eventCount: number;
  feedbackTotal: number;
  acceptCount: number;
  dismissCount: number;
  modifyCount: number;
  ignoreCount: number;
  lastEventTs: number | null;
  lastFeedbackTs: number | null;
  preference: NeuroBehavioralPreference | null;
};

type NeuroBehavioralStoreOptions = {
  dbPath?: string;
  now?: () => number;
  retentionDays?: number;
  pruneIntervalMs?: number;
};

type ExportOptions = {
  sessionKey?: string;
  fromTs?: number;
  toTs?: number;
  limit?: number;
  includePreferences?: boolean;
};

type DeleteOptions = {
  sessionKey?: string;
  beforeTs?: number;
  deletePreferences?: boolean;
};

type PatternStatsOptions = {
  patternHash: string;
  sessionKey?: string;
};

type PruneOptions = {
  nowMs?: number;
  dryRun?: boolean;
};

type EventInsert = {
  ts: number;
  sessionKey: string;
  type: NeuroBehavioralEventType;
  patternHash: string;
  suggestionId?: string;
  mode?: SuggestionCard["mode"];
  userAction?: SuggestionFeedback["action"];
  confidence?: number;
  workspace?: string;
  filePath?: string;
  appName?: string;
  metadata?: Record<string, unknown>;
};

type EventRow = {
  id: string;
  ts: number;
  session_key: string;
  type: NeuroBehavioralEventType;
  pattern_hash: string;
  suggestion_id: string | null;
  mode: SuggestionCard["mode"] | null;
  user_action: SuggestionFeedback["action"] | null;
  confidence: number | null;
  workspace: string | null;
  file_path: string | null;
  app_name: string | null;
  metadata_json: string;
};

type PreferenceRow = {
  pattern_hash: string;
  preference: NeuroPatternPreference;
  score: number;
  updated_at_ms: number;
};

const SCHEMA_VERSION = 1;
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function toPatternHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function normalizeMetadata(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return input as Record<string, unknown>;
}

function parseMetadata(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return normalizeMetadata(value);
  } catch {
    return {};
  }
}

function toOptionalString(input: unknown): string | undefined {
  return typeof input === "string" && input.trim().length > 0 ? input : undefined;
}

function feedbackScoreDelta(action: SuggestionFeedback["action"]): number {
  if (action === "accept") {
    return 1;
  }
  if (action === "modify") {
    return 0.25;
  }
  if (action === "dismiss") {
    return -0.5;
  }
  return -0.25;
}

function preferenceFromScore(score: number): NeuroPatternPreference {
  if (score >= 1.5) {
    return "auto_apply";
  }
  if (score <= -0.5) {
    return "ignore";
  }
  return "suggest";
}

function applyMigrations(db: DatabaseSync, nowMs: number): number {
  db.exec(
    "CREATE TABLE IF NOT EXISTS neuro_schema_migrations (" +
      "version INTEGER PRIMARY KEY," +
      "applied_at_ms INTEGER NOT NULL" +
      ")",
  );

  const migrationRow = db
    .prepare("SELECT MAX(version) AS version FROM neuro_schema_migrations")
    .get() as { version?: number | null } | undefined;
  const current = typeof migrationRow?.version === "number" ? migrationRow.version : 0;

  if (current < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS behavior_events (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        session_key TEXT NOT NULL,
        type TEXT NOT NULL,
        pattern_hash TEXT NOT NULL,
        suggestion_id TEXT,
        mode TEXT,
        user_action TEXT,
        confidence REAL,
        workspace TEXT,
        file_path TEXT,
        app_name TEXT,
        metadata_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_behavior_events_ts ON behavior_events(ts);
      CREATE INDEX IF NOT EXISTS idx_behavior_events_pattern ON behavior_events(pattern_hash);
      CREATE INDEX IF NOT EXISTS idx_behavior_events_session ON behavior_events(session_key);

      CREATE TABLE IF NOT EXISTS pattern_preferences (
        pattern_hash TEXT PRIMARY KEY,
        preference TEXT NOT NULL,
        score REAL NOT NULL DEFAULT 0,
        updated_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_watermarks (
        device_id TEXT PRIMARY KEY,
        last_event_ts INTEGER NOT NULL
      );
    `);
    db.prepare(
      "INSERT INTO neuro_schema_migrations(version, applied_at_ms) VALUES(?, ?) ON CONFLICT(version) DO NOTHING",
    ).run(1, nowMs);
  }

  return SCHEMA_VERSION;
}

export function createNeuroBehavioralStore(options: NeuroBehavioralStoreOptions = {}) {
  const now = options.now ?? (() => Date.now());
  const retentionDays = Math.max(1, Math.floor(options.retentionDays ?? DEFAULT_RETENTION_DAYS));
  const pruneIntervalMs = Math.max(
    60_000,
    Math.floor(options.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS),
  );
  const dbPath = path.resolve(
    options.dbPath ?? path.join(resolveStateDir(process.env), "behavioral.db"),
  );
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  const schemaVersion = applyMigrations(db, now());
  let lastPruneAtMs = 0;

  function mapEvent(row: EventRow): NeuroBehavioralEvent {
    return {
      id: row.id,
      ts: row.ts,
      sessionKey: row.session_key,
      type: row.type,
      patternHash: row.pattern_hash,
      suggestionId: row.suggestion_id,
      mode: row.mode,
      userAction: row.user_action,
      confidence: row.confidence,
      workspace: row.workspace,
      filePath: row.file_path,
      appName: row.app_name,
      metadata: parseMetadata(row.metadata_json),
    };
  }

  function mapPreference(row: PreferenceRow): NeuroBehavioralPreference {
    return {
      patternHash: row.pattern_hash,
      preference: row.preference,
      score: row.score,
      updatedAtMs: row.updated_at_ms,
    };
  }

  function countEvents(where = "", args: Array<string | number> = []): number {
    const sql = `SELECT COUNT(*) AS count FROM behavior_events${where}`;
    const row = db.prepare(sql).get(...args) as { count?: number } | undefined;
    return typeof row?.count === "number" ? row.count : 0;
  }

  function countPreferences(): number {
    const row = db.prepare("SELECT COUNT(*) AS count FROM pattern_preferences").get() as
      | { count?: number }
      | undefined;
    return typeof row?.count === "number" ? row.count : 0;
  }

  function updatePreference(
    patternHash: string,
    action: SuggestionFeedback["action"],
    nowMs: number,
  ): NeuroBehavioralPreference {
    const existing = db
      .prepare("SELECT score FROM pattern_preferences WHERE pattern_hash = ?")
      .get(patternHash) as { score?: number } | undefined;
    const currentScore = typeof existing?.score === "number" ? existing.score : 0;
    const nextScore = currentScore + feedbackScoreDelta(action);
    const nextPreference = preferenceFromScore(nextScore);
    db.prepare(
      "INSERT INTO pattern_preferences(pattern_hash, preference, score, updated_at_ms) VALUES(?, ?, ?, ?) " +
        "ON CONFLICT(pattern_hash) DO UPDATE SET preference = excluded.preference, score = excluded.score, updated_at_ms = excluded.updated_at_ms",
    ).run(patternHash, nextPreference, nextScore, nowMs);
    return {
      patternHash,
      preference: nextPreference,
      score: nextScore,
      updatedAtMs: nowMs,
    };
  }

  function insertEvent(input: EventInsert): string {
    const id = randomUUID();
    const metadata = normalizeMetadata(input.metadata);
    db.prepare(
      "INSERT INTO behavior_events(" +
        "id, ts, session_key, type, pattern_hash, suggestion_id, mode, user_action, confidence, workspace, file_path, app_name, metadata_json" +
        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      id,
      input.ts,
      input.sessionKey,
      input.type,
      input.patternHash,
      input.suggestionId ?? null,
      input.mode ?? null,
      input.userAction ?? null,
      typeof input.confidence === "number" ? input.confidence : null,
      input.workspace ?? null,
      input.filePath ?? null,
      input.appName ?? null,
      JSON.stringify(metadata),
    );
    return id;
  }

  function maybeRunRetention(nowMs: number) {
    if (nowMs - lastPruneAtMs < pruneIntervalMs) {
      return;
    }
    const result = pruneExpiredEvents({ nowMs });
    lastPruneAtMs = nowMs;
    return result;
  }

  function pruneExpiredEvents(opts: PruneOptions = {}) {
    const nowMs = typeof opts.nowMs === "number" ? opts.nowMs : now();
    const cutoffTs = nowMs - retentionDays * DAY_MS;
    const where = " WHERE ts < ?";
    const deletedEvents = opts.dryRun
      ? countEvents(where, [cutoffTs])
      : ((db.prepare(`DELETE FROM behavior_events${where}`).run(cutoffTs) as { changes?: number })
          .changes ?? 0);
    return {
      cutoffTs,
      deletedEvents,
      remainingEvents: countEvents(),
      retentionDays,
      dryRun: opts.dryRun === true,
    };
  }

  function buildEventFilter(opts: { sessionKey?: string; fromTs?: number; toTs?: number }) {
    const whereClauses: string[] = [];
    const args: Array<string | number> = [];
    if (toOptionalString(opts.sessionKey)) {
      whereClauses.push("session_key = ?");
      args.push(opts.sessionKey as string);
    }
    if (typeof opts.fromTs === "number") {
      whereClauses.push("ts >= ?");
      args.push(Math.floor(opts.fromTs));
    }
    if (typeof opts.toTs === "number") {
      whereClauses.push("ts <= ?");
      args.push(Math.floor(opts.toTs));
    }
    const where = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(" AND ")}` : "";
    return { where, args };
  }

  function getPatternStats(options: PatternStatsOptions): NeuroBehavioralPatternStats {
    const sessionKey = toOptionalString(options.sessionKey) ?? null;
    const eventWhere = sessionKey ? "pattern_hash = ? AND session_key = ?" : "pattern_hash = ?";
    const eventArgs = sessionKey
      ? [options.patternHash, sessionKey]
      : ([options.patternHash] as const);
    const aggregate = db
      .prepare(
        "SELECT " +
          "COUNT(*) AS event_count, " +
          "MAX(ts) AS last_event_ts, " +
          "SUM(CASE WHEN type = 'feedback' THEN 1 ELSE 0 END) AS feedback_total, " +
          "SUM(CASE WHEN type = 'feedback' AND user_action = 'accept' THEN 1 ELSE 0 END) AS accept_count, " +
          "SUM(CASE WHEN type = 'feedback' AND user_action = 'dismiss' THEN 1 ELSE 0 END) AS dismiss_count, " +
          "SUM(CASE WHEN type = 'feedback' AND user_action = 'modify' THEN 1 ELSE 0 END) AS modify_count, " +
          "SUM(CASE WHEN type = 'feedback' AND user_action = 'ignore' THEN 1 ELSE 0 END) AS ignore_count, " +
          "MAX(CASE WHEN type = 'feedback' THEN ts ELSE NULL END) AS last_feedback_ts " +
          `FROM behavior_events WHERE ${eventWhere}`,
      )
      .get(...eventArgs) as
      | {
          event_count?: number | null;
          last_event_ts?: number | null;
          feedback_total?: number | null;
          accept_count?: number | null;
          dismiss_count?: number | null;
          modify_count?: number | null;
          ignore_count?: number | null;
          last_feedback_ts?: number | null;
        }
      | undefined;

    const preferenceRow = db
      .prepare(
        "SELECT pattern_hash, preference, score, updated_at_ms FROM pattern_preferences WHERE pattern_hash = ?",
      )
      .get(options.patternHash) as PreferenceRow | undefined;

    return {
      patternHash: options.patternHash,
      sessionKey,
      eventCount: typeof aggregate?.event_count === "number" ? aggregate.event_count : 0,
      feedbackTotal: typeof aggregate?.feedback_total === "number" ? aggregate.feedback_total : 0,
      acceptCount: typeof aggregate?.accept_count === "number" ? aggregate.accept_count : 0,
      dismissCount: typeof aggregate?.dismiss_count === "number" ? aggregate.dismiss_count : 0,
      modifyCount: typeof aggregate?.modify_count === "number" ? aggregate.modify_count : 0,
      ignoreCount: typeof aggregate?.ignore_count === "number" ? aggregate.ignore_count : 0,
      lastEventTs: typeof aggregate?.last_event_ts === "number" ? aggregate.last_event_ts : null,
      lastFeedbackTs:
        typeof aggregate?.last_feedback_ts === "number" ? aggregate.last_feedback_ts : null,
      preference: preferenceRow ? mapPreference(preferenceRow) : null,
    };
  }

  return {
    getSchemaVersion() {
      return schemaVersion;
    },

    getDbPath() {
      return dbPath;
    },

    getStats() {
      return {
        dbPath,
        schemaVersion,
        totalEvents: countEvents(),
        totalPreferences: countPreferences(),
      };
    },

    hashPattern(input: string) {
      return toPatternHash(input);
    },

    getPatternStats,

    recordSuggestion(params: {
      card: SuggestionCard;
      nowMs?: number;
      metadata?: Record<string, unknown>;
    }) {
      const ts = typeof params.nowMs === "number" ? params.nowMs : now();
      maybeRunRetention(ts);
      const patternHash = toPatternHash(`suggestion:${params.card.suggestionId}`);
      const eventId = insertEvent({
        ts,
        sessionKey: params.card.sessionKey,
        type: "suggestion",
        patternHash,
        suggestionId: params.card.suggestionId,
        mode: params.card.mode,
        confidence: params.card.confidence,
        metadata: {
          actions: params.card.actions,
          expiresAt: params.card.expiresAt,
          ...normalizeMetadata(params.metadata),
        },
      });
      return { eventId, patternHash };
    },

    recordFeedback(params: {
      feedback: SuggestionFeedback;
      nowMs?: number;
      metadata?: Record<string, unknown>;
    }) {
      const ts =
        typeof params.nowMs === "number"
          ? params.nowMs
          : typeof params.feedback.ts === "number"
            ? params.feedback.ts
            : now();
      maybeRunRetention(ts);
      const patternHash = toPatternHash(`suggestion:${params.feedback.suggestionId}`);
      const eventId = insertEvent({
        ts,
        sessionKey: params.feedback.sessionKey,
        type: "feedback",
        patternHash,
        suggestionId: params.feedback.suggestionId,
        userAction: params.feedback.action,
        metadata: normalizeMetadata(params.metadata),
      });
      const preference = updatePreference(patternHash, params.feedback.action, ts);
      return { eventId, patternHash, preference };
    },

    exportData(options: ExportOptions = {}) {
      maybeRunRetention(now());
      const limit =
        typeof options.limit === "number" && Number.isFinite(options.limit)
          ? Math.max(1, Math.min(5_000, Math.floor(options.limit)))
          : 1_000;
      const { where, args } = buildEventFilter(options);
      const eventRows = db
        .prepare(
          "SELECT id, ts, session_key, type, pattern_hash, suggestion_id, mode, user_action, confidence, workspace, file_path, app_name, metadata_json " +
            `FROM behavior_events${where} ORDER BY ts DESC LIMIT ?`,
        )
        .all(...args, limit) as EventRow[];
      const includePreferences = options.includePreferences !== false;
      const preferenceRows = includePreferences
        ? (db
            .prepare(
              "SELECT pattern_hash, preference, score, updated_at_ms FROM pattern_preferences ORDER BY updated_at_ms DESC",
            )
            .all() as PreferenceRow[])
        : [];
      return {
        exportedAtMs: now(),
        events: eventRows.map((row) => mapEvent(row)),
        preferences: preferenceRows.map((row) => mapPreference(row)),
      };
    },

    deleteData(options: DeleteOptions = {}) {
      maybeRunRetention(now());
      const { where, args } = buildEventFilter({
        sessionKey: options.sessionKey,
        toTs: options.beforeTs,
      });
      const deletedEvents = where
        ? ((db.prepare(`DELETE FROM behavior_events${where}`).run(...args) as { changes?: number })
            .changes ?? 0)
        : ((db.prepare("DELETE FROM behavior_events").run() as { changes?: number }).changes ?? 0);
      const deletedPreferences = options.deletePreferences
        ? ((db.prepare("DELETE FROM pattern_preferences").run() as { changes?: number }).changes ??
          0)
        : 0;
      if (options.deletePreferences) {
        db.prepare("DELETE FROM sync_watermarks").run();
      }
      return {
        deletedEvents,
        deletedPreferences,
        remainingEvents: countEvents(),
        remainingPreferences: countPreferences(),
      };
    },

    pruneExpiredEvents,

    close() {
      db.close();
    },
  };
}

export type NeuroBehavioralStoreService = ReturnType<typeof createNeuroBehavioralStore>;
