import type { SuggestionCard } from "../protocol/schema/types.js";

export type NeuroUndoSnapshot = {
  snapshotId: string;
  kind: string;
  target: string;
  before: unknown;
  after: unknown;
};

export type NeuroUndoJournalStatus = "applied" | "undone" | "expired";

export type NeuroUndoJournalEntry = {
  journalId: string;
  groupId: string;
  sessionKey: string;
  suggestionId: string;
  mode: SuggestionCard["mode"];
  createdAtMs: number;
  expiresAtMs: number;
  undoneAtMs: number | null;
  status: NeuroUndoJournalStatus;
  snapshots: NeuroUndoSnapshot[];
};

type UndoJournalRecordParams = {
  sessionKey: string;
  suggestionId: string;
  mode: SuggestionCard["mode"];
  groupId?: string;
  snapshots?: Array<{
    snapshotId?: string;
    kind?: string;
    target?: string;
    before?: unknown;
    after?: unknown;
  }>;
};

type UndoJournalOptions = {
  undoWindowMs?: number;
  now?: () => number;
};

const DEFAULT_UNDO_WINDOW_MS = 5 * 60 * 1000;

function createId(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID()}`;
  } catch {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function normalizeSnapshots(snapshots: UndoJournalRecordParams["snapshots"]): NeuroUndoSnapshot[] {
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return [];
  }
  return snapshots.map((snapshot) => {
    const kind =
      typeof snapshot.kind === "string" && snapshot.kind.trim() ? snapshot.kind : "unknown";
    const target =
      typeof snapshot.target === "string" && snapshot.target.trim()
        ? snapshot.target
        : "unknown-target";
    return {
      snapshotId:
        typeof snapshot.snapshotId === "string" && snapshot.snapshotId.trim()
          ? snapshot.snapshotId
          : createId("undo-snap"),
      kind,
      target,
      before: snapshot.before,
      after: snapshot.after,
    };
  });
}

export function createNeuroUndoJournal(options: UndoJournalOptions = {}) {
  const now = options.now ?? (() => Date.now());
  const undoWindowMs = Math.max(1, Math.floor(options.undoWindowMs ?? DEFAULT_UNDO_WINDOW_MS));
  const bySession = new Map<string, NeuroUndoJournalEntry[]>();

  function expire(sessionKey: string, nowMs: number) {
    const entries = bySession.get(sessionKey);
    if (!entries) {
      return;
    }
    for (const entry of entries) {
      if (entry.status !== "applied") {
        continue;
      }
      if (entry.expiresAtMs < nowMs) {
        entry.status = "expired";
      }
    }
  }

  function listBySession(sessionKey: string, nowMs = now()) {
    expire(sessionKey, nowMs);
    const entries = bySession.get(sessionKey) ?? [];
    return entries.toSorted((a, b) => b.createdAtMs - a.createdAtMs);
  }

  return {
    recordApply(params: UndoJournalRecordParams, nowMs = now()): NeuroUndoJournalEntry {
      expire(params.sessionKey, nowMs);
      const groupId =
        typeof params.groupId === "string" && params.groupId.trim()
          ? params.groupId
          : createId("undo-group");
      const entry: NeuroUndoJournalEntry = {
        journalId: createId("undo"),
        groupId,
        sessionKey: params.sessionKey,
        suggestionId: params.suggestionId,
        mode: params.mode,
        createdAtMs: nowMs,
        expiresAtMs: nowMs + undoWindowMs,
        undoneAtMs: null,
        status: "applied",
        snapshots: normalizeSnapshots(params.snapshots),
      };
      const entries = bySession.get(params.sessionKey) ?? [];
      entries.push(entry);
      bySession.set(params.sessionKey, entries);
      return entry;
    },

    undoLatestBySuggestion(
      sessionKey: string,
      suggestionId: string,
      nowMs = now(),
    ): NeuroUndoJournalEntry | null {
      expire(sessionKey, nowMs);
      const entries = bySession.get(sessionKey);
      if (!entries || entries.length === 0) {
        return null;
      }
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const entry = entries[i];
        if (!entry || entry.suggestionId !== suggestionId) {
          continue;
        }
        if (entry.status !== "applied" || entry.expiresAtMs < nowMs) {
          continue;
        }
        entry.status = "undone";
        entry.undoneAtMs = nowMs;
        return entry;
      }
      return null;
    },

    listBySuggestion(
      sessionKey: string,
      suggestionId: string,
      nowMs = now(),
    ): NeuroUndoJournalEntry[] {
      return listBySession(sessionKey, nowMs).filter(
        (entry) => entry.suggestionId === suggestionId,
      );
    },

    listByGroup(sessionKey: string, groupId: string, nowMs = now()): NeuroUndoJournalEntry[] {
      return listBySession(sessionKey, nowMs).filter((entry) => entry.groupId === groupId);
    },
  };
}

export type NeuroUndoJournalService = ReturnType<typeof createNeuroUndoJournal>;
