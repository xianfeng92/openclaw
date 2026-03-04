import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendSessionMemorySnapshot,
  listMemoryFiles,
  memoryGet,
  memorySearch,
} from "./memory-runtime.js";

const tempDirs: string[] = [];

function makeTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cydeck-memory-runtime-"));
  tempDirs.push(dir);
  fs.mkdirSync(path.join(dir, "memory"), { recursive: true });
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("memory-runtime", () => {
  it("lists MEMORY.md and memory/*.md files", () => {
    const workspace = makeTempWorkspace();
    fs.writeFileSync(path.join(workspace, "MEMORY.md"), "# MEMORY", "utf-8");
    fs.writeFileSync(path.join(workspace, "memory", "2026-03-04.md"), "snapshot", "utf-8");

    const files = listMemoryFiles(workspace).map((file) => path.relative(workspace, file));
    expect(files).toContain("MEMORY.md");
    expect(files).toContain(path.join("memory", "2026-03-04.md"));
  });

  it("searches memory snippets by relevance", () => {
    const workspace = makeTempWorkspace();
    fs.writeFileSync(
      path.join(workspace, "MEMORY.md"),
      [
        "# MEMORY",
        "",
        "- Product codename is Atlas.",
        "- User prefers concise Chinese replies.",
      ].join("\n"),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(workspace, "memory", "2026-03-04-atlas.md"),
      [
        "# Session",
        "",
        "Discussed Atlas release plan and rollout checklist.",
      ].join("\n"),
      "utf-8",
    );

    const results = memorySearch(workspace, "atlas release plan", { maxResults: 3 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.path).toContain("memory");
    expect(results.some((entry) => /atlas/i.test(entry.snippet))).toBe(true);
  });

  it("reads memory snippets with line windows and blocks invalid paths", () => {
    const workspace = makeTempWorkspace();
    fs.writeFileSync(
      path.join(workspace, "memory", "notes.md"),
      ["line1", "line2", "line3", "line4"].join("\n"),
      "utf-8",
    );

    const snippet = memoryGet(workspace, { path: "memory/notes.md", from: 2, lines: 2 });
    expect(snippet.text).toBe("line2\nline3");

    expect(() => memoryGet(workspace, { path: "../secret.txt" })).toThrow(
      "path must be MEMORY.md or memory/*.md",
    );
  });

  it("appends session snapshots to daily memory files", () => {
    const workspace = makeTempWorkspace();
    const now = new Date("2026-03-04T12:34:56.000Z");

    const first = appendSessionMemorySnapshot({
      workspacePath: workspace,
      sessionKey: "default",
      reason: "session-memory",
      messages: [
        { role: "user", content: "Remember project codename Atlas." },
        { role: "assistant", content: "Saved." },
      ],
      now,
    });

    const second = appendSessionMemorySnapshot({
      workspacePath: workspace,
      sessionKey: "default",
      reason: "pre-compaction-flush",
      messages: [{ role: "user", content: "Second snapshot line." }],
      now,
    });

    expect(first.saved).toBe(true);
    expect(second.saved).toBe(true);
    expect(first.relativePath).toBe("memory/2026-03-04-default.md");
    const content = fs.readFileSync(path.join(workspace, first.relativePath), "utf-8");
    expect(content).toContain("Reason: session-memory");
    expect(content).toContain("Reason: pre-compaction-flush");
    expect(content).toContain("Remember project codename Atlas.");
  });
});
