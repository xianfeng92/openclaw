import type { SuggestionCard } from "../protocol/schema/types.js";

type SuggestionCardRecord = {
  card: SuggestionCard;
  lastAppliedAtMs: number | null;
  undoUntilMs: number | null;
};

type SuggestionStoreOptions = {
  undoWindowMs?: number;
  now?: () => number;
};

const DEFAULT_UNDO_WINDOW_MS = 5 * 60 * 1000;

function sortCards(cards: SuggestionCard[]): SuggestionCard[] {
  return cards.toSorted((a, b) => {
    if (a.expiresAt === b.expiresAt) {
      return a.suggestionId.localeCompare(b.suggestionId);
    }
    return a.expiresAt - b.expiresAt;
  });
}

export function createNeuroSuggestionCards(options: SuggestionStoreOptions = {}) {
  const undoWindowMs = Math.max(1, Math.floor(options.undoWindowMs ?? DEFAULT_UNDO_WINDOW_MS));
  const now = options.now ?? (() => Date.now());
  const bySession = new Map<string, Map<string, SuggestionCardRecord>>();

  function cleanupSession(sessionKey: string, nowMs: number) {
    const session = bySession.get(sessionKey);
    if (!session) {
      return 0;
    }
    let removed = 0;
    for (const [suggestionId, record] of session.entries()) {
      if (record.card.expiresAt > nowMs) {
        continue;
      }
      session.delete(suggestionId);
      removed += 1;
    }
    if (session.size === 0) {
      bySession.delete(sessionKey);
    }
    return removed;
  }

  function getRecord(sessionKey: string, suggestionId: string, nowMs: number) {
    cleanupSession(sessionKey, nowMs);
    return bySession.get(sessionKey)?.get(suggestionId) ?? null;
  }

  return {
    upsert(card: SuggestionCard, nowMs = now()) {
      cleanupSession(card.sessionKey, nowMs);
      const session = bySession.get(card.sessionKey) ?? new Map<string, SuggestionCardRecord>();
      const previous = session.get(card.suggestionId);
      session.set(card.suggestionId, {
        card,
        lastAppliedAtMs: previous?.lastAppliedAtMs ?? null,
        undoUntilMs: previous?.undoUntilMs ?? null,
      });
      bySession.set(card.sessionKey, session);
      return {
        inserted: !previous,
        replaced: Boolean(previous),
      };
    },

    list(sessionKey: string, nowMs = now()) {
      const expiredRemoved = cleanupSession(sessionKey, nowMs);
      const cards = Array.from(bySession.get(sessionKey)?.values() ?? [], (entry) => entry.card);
      return {
        cards: sortCards(cards),
        expiredRemoved,
      };
    },

    get(sessionKey: string, suggestionId: string, nowMs = now()) {
      const record = getRecord(sessionKey, suggestionId, nowMs);
      return record?.card ?? null;
    },

    remove(sessionKey: string, suggestionId: string, nowMs = now()) {
      cleanupSession(sessionKey, nowMs);
      const session = bySession.get(sessionKey);
      if (!session) {
        return false;
      }
      const removed = session.delete(suggestionId);
      if (session.size === 0) {
        bySession.delete(sessionKey);
      }
      return removed;
    },

    markApplied(sessionKey: string, suggestionId: string, nowMs = now()) {
      const record = getRecord(sessionKey, suggestionId, nowMs);
      if (!record) {
        return null;
      }
      record.lastAppliedAtMs = nowMs;
      record.undoUntilMs = nowMs + undoWindowMs;
      return {
        undoUntilMs: record.undoUntilMs,
      };
    },

    undo(sessionKey: string, suggestionId: string, nowMs = now()) {
      const record = getRecord(sessionKey, suggestionId, nowMs);
      if (!record || record.undoUntilMs == null || record.undoUntilMs < nowMs) {
        return false;
      }
      record.lastAppliedAtMs = null;
      record.undoUntilMs = null;
      return true;
    },

    getUndoUntil(sessionKey: string, suggestionId: string, nowMs = now()) {
      const record = getRecord(sessionKey, suggestionId, nowMs);
      return record?.undoUntilMs ?? null;
    },
  };
}

export type NeuroSuggestionCardsService = ReturnType<typeof createNeuroSuggestionCards>;
