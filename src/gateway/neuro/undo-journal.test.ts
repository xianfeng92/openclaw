import { describe, expect, it } from "vitest";
import { createNeuroUndoJournal } from "./undo-journal.js";

describe("createNeuroUndoJournal", () => {
  it("records apply entries with grouped snapshots", () => {
    let nowMs = 1_000;
    const journal = createNeuroUndoJournal({ now: () => nowMs, undoWindowMs: 500 });
    const entry = journal.recordApply({
      sessionKey: "agent:main:main",
      suggestionId: "sg-1",
      mode: "safe",
      groupId: "group-1",
      snapshots: [{ kind: "file", target: "README.md", before: "a", after: "b" }],
    });

    expect(entry.groupId).toBe("group-1");
    expect(entry.status).toBe("applied");
    expect(entry.snapshots).toHaveLength(1);
    expect(entry.expiresAtMs).toBe(1_500);

    const byGroup = journal.listByGroup("agent:main:main", "group-1");
    expect(byGroup).toHaveLength(1);
  });

  it("supports one-click undo before expiry", () => {
    let nowMs = 10_000;
    const journal = createNeuroUndoJournal({ now: () => nowMs, undoWindowMs: 1_000 });
    journal.recordApply({
      sessionKey: "agent:main:main",
      suggestionId: "sg-undo",
      mode: "safe",
    });

    nowMs = 10_500;
    const undone = journal.undoLatestBySuggestion("agent:main:main", "sg-undo");
    expect(undone).not.toBeNull();
    expect(undone?.status).toBe("undone");
    expect(undone?.undoneAtMs).toBe(10_500);
  });

  it("expires undo entries after window", () => {
    let nowMs = 20_000;
    const journal = createNeuroUndoJournal({ now: () => nowMs, undoWindowMs: 100 });
    journal.recordApply({
      sessionKey: "agent:main:main",
      suggestionId: "sg-expire",
      mode: "flow",
    });

    nowMs = 20_500;
    const undone = journal.undoLatestBySuggestion("agent:main:main", "sg-expire");
    expect(undone).toBeNull();
    const entries = journal.listBySuggestion("agent:main:main", "sg-expire");
    expect(entries[0]?.status).toBe("expired");
  });
});
