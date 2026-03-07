import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendLandingNote,
  buildLandingSystemPrompt,
  clearLandingWizardProgress,
  ensureLandingWorkspaceFiles,
  getLandingWizardNextStepIndex,
  getLandingWorkspaceStatus,
  isPrivateLandingSession,
  loadLandingWizardProgress,
  loadLandingPromptFiles,
  saveLandingWizardProgress,
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
      expect.arrayContaining([
        "AGENTS.md",
        "SOUL.md",
        "TOOLS.md",
        "IDENTITY.md",
        "USER.md",
        "HEARTBEAT.md",
        "BOOTSTRAP.md",
        "MEMORY.md",
      ]),
    );
    expect(fs.existsSync(path.join(workspace, "AGENTS.md"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, "SOUL.md"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, "TOOLS.md"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, "IDENTITY.md"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, "USER.md"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, "HEARTBEAT.md"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, "BOOTSTRAP.md"))).toBe(true);
    expect(fs.existsSync(path.join(workspace, "MEMORY.md"))).toBe(true);
  });

  it("creates OpenClaw-style SOUL.md template sections", () => {
    const workspace = createTempWorkspace();
    ensureLandingWorkspaceFiles(workspace);

    const soul = fs.readFileSync(path.join(workspace, "SOUL.md"), "utf-8");
    const agents = fs.readFileSync(path.join(workspace, "AGENTS.md"), "utf-8");
    const tools = fs.readFileSync(path.join(workspace, "TOOLS.md"), "utf-8");
    const bootstrap = fs.readFileSync(path.join(workspace, "BOOTSTRAP.md"), "utf-8");

    expect(soul).toContain("## Core Truths");
    expect(soul).toContain("## Boundaries");
    expect(soul).toContain("## Vibe");
    expect(soul).toContain("## Continuity");
    expect(agents).toContain("## First Run");
    expect(agents).toContain("## Every Session");
    expect(tools).toContain("# TOOLS.md - Local Notes");
    expect(bootstrap).toContain("# BOOTSTRAP.md - Hello, World");
  });

  it("does not recreate BOOTSTRAP.md for partially initialized workspaces", () => {
    const workspace = createTempWorkspace();
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, "AGENTS.md"), "# Existing workspace\n", "utf-8");

    const result = ensureLandingWorkspaceFiles(workspace);

    expect(result.created).not.toContain("BOOTSTRAP.md");
    expect(fs.existsSync(path.join(workspace, "BOOTSTRAP.md"))).toBe(false);
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
    expect(
      status.files
        .filter((file) =>
          ["agents", "soul", "identity", "user", "memory"].includes(file.id),
        )
        .every((file) => file.configured),
    ).toBe(true);
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

    expect(soul.indexOf("## CyDeck Directives")).toBeGreaterThanOrEqual(0);
    expect(soul.indexOf("- Keep tone pragmatic")).toBeGreaterThan(
      soul.indexOf("## CyDeck Directives"),
    );
    expect(agents.indexOf("## Make It Yours")).toBeGreaterThanOrEqual(0);
    expect(agents.indexOf("- Ask before destructive changes")).toBeGreaterThan(
      agents.indexOf("## Make It Yours"),
    );
    expect(memory.indexOf("## Long-term Facts")).toBeGreaterThanOrEqual(0);
    expect(memory.indexOf("- User likes numbered lists")).toBeGreaterThan(
      memory.indexOf("## Long-term Facts"),
    );
  });

  it("resolves the first missing wizard step in order", () => {
    const workspace = createTempWorkspace();
    ensureLandingWorkspaceFiles(workspace);

    expect(getLandingWizardNextStepIndex(workspace)).toBe(0);

    setLandingField(workspace, "identity.name", "CyDeck");
    expect(getLandingWizardNextStepIndex(workspace)).toBe(1);

    setLandingField(workspace, "user.name", "Peter");
    expect(getLandingWizardNextStepIndex(workspace)).toBe(2);

    setLandingField(workspace, "user.timezone", "Asia/Shanghai");
    expect(getLandingWizardNextStepIndex(workspace)).toBe(3);

    appendLandingNote(workspace, "soul", "Be direct and evidence-driven");
    expect(getLandingWizardNextStepIndex(workspace)).toBe(4);

    appendLandingNote(workspace, "agents", "Ask before external side effects");
    expect(getLandingWizardNextStepIndex(workspace)).toBe(5);

    appendLandingNote(workspace, "memory", "User prefers concise replies in Chinese");
    expect(getLandingWizardNextStepIndex(workspace)).toBe(6);
  });

  it("persists and clears landing wizard progress", () => {
    const stateDir = createTempWorkspace();

    saveLandingWizardProgress(stateDir, "C:/workspace", 999);
    const loaded = loadLandingWizardProgress(stateDir);
    expect(loaded).toEqual(
      expect.objectContaining({
        workspacePath: "C:/workspace",
        stepIndex: 6,
      }),
    );

    clearLandingWizardProgress(stateDir);
    expect(loadLandingWizardProgress(stateDir)).toBeNull();
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
    expect(privatePrompt).toContain("### TOOLS.md");
    expect(privatePrompt).toContain("### HEARTBEAT.md");
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
