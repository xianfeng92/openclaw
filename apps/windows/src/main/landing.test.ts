import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendLandingNote,
  buildLandingSystemPrompt,
  ensureLandingWorkspaceFiles,
  getLandingWorkspaceStatus,
  isPrivateLandingSession,
  loadLandingPromptFiles,
  setLandingField,
} from "./landing.js";

const tempDirs: string[] = [];

function createTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cydeck-landing-test-"));
  tempDirs.push(dir);
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

describe("landing bootstrap files", () => {
  it("creates all required landing files", () => {
    const workspace = createTempWorkspace();
    const result = ensureLandingWorkspaceFiles(workspace);

    expect(result.created).toEqual(
      expect.arrayContaining(["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "MEMORY.md"]),
    );
    expect(fs.existsSync(path.join(workspace, "AGENTS.md"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, "SOUL.md"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, "IDENTITY.md"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, "USER.md"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, "MEMORY.md"))).toBe(true);
  });

  it("reports status and completion after basic configuration", () => {
    const workspace = createTempWorkspace();
    ensureLandingWorkspaceFiles(workspace);

    setLandingField(workspace, "identity.name", "Cydec");
    setLandingField(workspace, "user.name", "Peter");
    appendLandingNote(workspace, "soul", "Prefer concise answers");
    appendLandingNote(workspace, "agents", "Run tests before commit");
    appendLandingNote(workspace, "memory", "User prefers Chinese replies");

    const status = getLandingWorkspaceStatus(workspace);
    expect(status.files.every((file) => file.exists)).toBe(true);
    expect(status.files.every((file) => file.configured)).toBe(true);
    expect(status.completed).toBe(true);
  });
});

describe("landing content updates", () => {
  it("updates structured identity and user fields", () => {
    const workspace = createTempWorkspace();
    ensureLandingWorkspaceFiles(workspace);

    setLandingField(workspace, "identity.emoji", ">");
    setLandingField(workspace, "user.timezone", "Asia/Shanghai");

    const identity = fs.readFileSync(path.join(workspace, "IDENTITY.md"), "utf-8");
    const user = fs.readFileSync(path.join(workspace, "USER.md"), "utf-8");

    expect(identity).toContain("- Emoji: >");
    expect(user).toContain("- Timezone: Asia/Shanghai");
  });

  it("appends notes to SOUL/AGENTS/MEMORY", () => {
    const workspace = createTempWorkspace();
    ensureLandingWorkspaceFiles(workspace);

    appendLandingNote(workspace, "soul", "Keep tone pragmatic");
    appendLandingNote(workspace, "agents", "Ask before destructive changes");
    appendLandingNote(workspace, "memory", "User likes numbered lists");

    const soul = fs.readFileSync(path.join(workspace, "SOUL.md"), "utf-8");
    const agents = fs.readFileSync(path.join(workspace, "AGENTS.md"), "utf-8");
    const memory = fs.readFileSync(path.join(workspace, "MEMORY.md"), "utf-8");

    expect(soul).toContain("- Keep tone pragmatic");
    expect(agents).toContain("- Ask before destructive changes");
    expect(memory).toContain("- User likes numbered lists");
  });
});

describe("landing prompt builder", () => {
  it("isolates MEMORY.md to private sessions only", () => {
    const workspace = createTempWorkspace();
    ensureLandingWorkspaceFiles(workspace);
    appendLandingNote(workspace, "memory", "Private memory token");

    const privatePrompt = buildLandingSystemPrompt(workspace, "default");
    const sharedPrompt = buildLandingSystemPrompt(workspace, "group:engineering");

    expect(privatePrompt).toContain("### MEMORY.md");
    expect(privatePrompt).toContain("Private memory token");
    expect(sharedPrompt).not.toContain("### MEMORY.md");
    expect(sharedPrompt).not.toContain("Private memory token");
  });

  it("adds missing file markers when landing files are absent", () => {
    const workspace = createTempWorkspace();
    ensureLandingWorkspaceFiles(workspace);
    const soulPath = path.join(workspace, "SOUL.md");
    fs.rmSync(soulPath);

    const prompt = buildLandingSystemPrompt(workspace, "default");
    expect(prompt).toContain("### SOUL.md");
    expect(prompt).toContain("[MISSING] Expected at:");
    expect(prompt).toContain(soulPath);
  });

  it("truncates oversized landing files in prompt payload", () => {
    const workspace = createTempWorkspace();
    ensureLandingWorkspaceFiles(workspace);
    const longSoul = `${"A".repeat(25_000)}\nTAIL_TOKEN`;
    fs.writeFileSync(path.join(workspace, "SOUL.md"), longSoul, "utf-8");

    const files = loadLandingPromptFiles(workspace, "default");
    const soul = files.find((file) => file.id === "soul");
    expect(soul).toBeDefined();
    expect(soul?.content).toContain("[...truncated, read SOUL.md for full content...]");
    expect(soul?.content).toContain("TAIL_TOKEN");
  });

  it("classifies private and shared session keys", () => {
    expect(isPrivateLandingSession("default")).toBe(true);
    expect(isPrivateLandingSession("main")).toBe(true);
    expect(isPrivateLandingSession("direct")).toBe(true);
    expect(isPrivateLandingSession("group:team-a")).toBe(false);
    expect(isPrivateLandingSession("channel:ops")).toBe(false);
    expect(isPrivateLandingSession("subagent:planner")).toBe(false);
    expect(isPrivateLandingSession("cron:daily")).toBe(false);
  });
});
