/**
 * AGENTS.md command tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTempWorkspace } from "../test-helpers/workspace.js";
import { join } from "node:path";
import { writeFile, readFile, rm } from "node:fs/promises";
import { saveRuleCommand, initAgentsMdCommand, readAgentsMd } from "../commands/agents-md.js";

describe("AGENTS.md commands", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempWorkspace("agents-md-test-");
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("initAgentsMdCommand", () => {
    it("should create AGENTS.md with project information", async () => {
      // Create a mock package.json
      const packageJson = {
        name: "test-project",
        description: "A test project for OpenClaw",
        scripts: {
          build: "tsdown",
          test: "vitest",
        },
        dependencies: {
          typescript: "^5.0.0",
          react: "^18.0.0",
        },
      };
      await writeFile(join(tempDir, "package.json"), JSON.stringify(packageJson));

      // Run init command
      const result = await initAgentsMdCommand({ workspace: tempDir });

      // Verify success
      expect(result.success).toBe(true);
      expect(result.created).toBe(true);
      expect(result.filePath).toBeDefined();

      // Verify file contents
      const agentsPath = join(tempDir, "AGENTS.md");
      const content = await readFile(agentsPath, "utf-8");
      expect(content).toContain("# test-project");
      expect(content).toContain("## Tech Stack");
      expect(content).toContain("**TypeScript**");
      expect(content).toContain("**React**");
      expect(content).toContain("## Common Commands");
      expect(content).toContain("pnpm build");
      expect(content).toContain("pnpm test");
    });

    it("should return error if file exists and force is false", async () => {
      // Create existing AGENTS.md
      await writeFile(join(tempDir, "AGENTS.md"), "# Existing content");

      const result = await initAgentsMdCommand({ workspace: tempDir });

      expect(result.success).toBe(false);
      expect(result.error).toContain("already exists");
    });

    it("should overwrite existing file when force is true", async () => {
      // Create existing AGENTS.md
      await writeFile(join(tempDir, "AGENTS.md"), "# Old content");

      // Create package.json to enable Tech Stack generation
      await writeFile(
        join(tempDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          description: "Test project for AGENTS.md",
          dependencies: {
            typescript: "^5.0.0",
          },
        }),
      );

      const result = await initAgentsMdCommand({ workspace: tempDir, force: true });

      expect(result.success).toBe(true);
      expect(result.created).toBe(false);

      const content = await readFile(join(tempDir, "AGENTS.md"), "utf-8");
      expect(content).not.toContain("Old content");
      expect(content).toContain("## Tech Stack");
    });
  });

  describe("saveRuleCommand", () => {
    it("should save a rule to AGENTS.md", async () => {
      const ruleContent = "Always use TypeScript strict mode";
      const result = await saveRuleCommand({
        content: ruleContent,
        workspace: tempDir,
      });

      expect(result.success).toBe(true);
      expect(result.filePath).toBeDefined();

      // Verify file was created
      const content = await readFile(join(tempDir, "AGENTS.md"), "utf-8");
      expect(content).toContain("Always use TypeScript strict mode");
    });

    it("should append to existing AGENTS.md", async () => {
      // Create existing AGENTS.md
      await writeFile(join(tempDir, "AGENTS.md"), "# Project Rules\n\nExisting rule here.\n");

      const ruleContent = "New rule: use 2 spaces for indentation";
      await saveRuleCommand({
        content: ruleContent,
        workspace: tempDir,
      });

      const content = await readFile(join(tempDir, "AGENTS.md"), "utf-8");
      expect(content).toContain("Existing rule here.");
      expect(content).toContain("New rule: use 2 spaces for indentation");
    });

    it("should include timestamp in saved rule", async () => {
      const ruleContent = "Test rule with timestamp";
      await saveRuleCommand({
        content: ruleContent,
        workspace: tempDir,
      });

      const content = await readFile(join(tempDir, "AGENTS.md"), "utf-8");
      // Check for timestamp format: Rule saved YYYY-MM-DD
      expect(content).toMatch(/## Rule saved \d{4}-\d{2}-\d{2}/);
    });
  });

  describe("readAgentsMd", () => {
    it("should return content when AGENTS.md exists", async () => {
      const expectedContent = "# Project Rules\n\nTest content here.";
      await writeFile(join(tempDir, "AGENTS.md"), expectedContent);

      const result = await readAgentsMd(tempDir);

      expect(result.exists).toBe(true);
      expect(result.content).toBe(expectedContent);
      expect(result.filePath).toBeDefined();
    });

    it("should return exists: false when AGENTS.md does not exist", async () => {
      const result = await readAgentsMd(tempDir);

      expect(result.exists).toBe(false);
      expect(result.content).toBeUndefined();
    });
  });
});
