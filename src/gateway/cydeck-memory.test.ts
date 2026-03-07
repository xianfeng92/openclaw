import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureAgentWorkspace } from "../agents/workspace.js";
import { makeTempWorkspace } from "../test-helpers/workspace.js";
import { buildCyDeckLandingSystemPrompt } from "./cydeck-memory.js";

describe("buildCyDeckLandingSystemPrompt", () => {
  it("reuses OpenClaw bootstrap files for private CyDeck sessions", async () => {
    const workspace = await makeTempWorkspace("cydeck-landing-context-");
    await ensureAgentWorkspace({ dir: workspace, ensureBootstrapFiles: true });
    await fs.writeFile(path.join(workspace, "MEMORY.md"), "# MEMORY.md\n\nPrivate memory\n", "utf-8");

    const prompt = await buildCyDeckLandingSystemPrompt(workspace, "default");

    expect(prompt).toContain("# Project Context");
    expect(prompt).toContain("## AGENTS.md");
    expect(prompt).toContain("## SOUL.md");
    expect(prompt).toContain("## TOOLS.md");
    expect(prompt).toContain("## HEARTBEAT.md");
    expect(prompt).toContain("## BOOTSTRAP.md");
    expect(prompt).toContain("## MEMORY.md");
  });

  it("keeps MEMORY.md out of shared CyDeck sessions", async () => {
    const workspace = await makeTempWorkspace("cydeck-landing-context-");
    await ensureAgentWorkspace({ dir: workspace, ensureBootstrapFiles: true });
    await fs.writeFile(path.join(workspace, "MEMORY.md"), "# MEMORY.md\n\nPrivate memory\n", "utf-8");

    const prompt = await buildCyDeckLandingSystemPrompt(workspace, "group:engineering");

    expect(prompt).toContain("## AGENTS.md");
    expect(prompt).toContain("## TOOLS.md");
    expect(prompt).not.toContain("## MEMORY.md");
    expect(prompt).not.toContain("Private memory");
  });
});
