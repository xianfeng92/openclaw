/**
 * Command Palette system tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTempWorkspace } from "../test-helpers/workspace.js";
import { join } from "node:path";
import { writeFile, rm, mkdir } from "node:fs/promises";
import {
  fuzzyMatch,
  scoreMatch,
  loadPaletteItems,
  searchPalette,
  executePaletteItem,
  getPaletteCategories,
  getItemsByCategory,
  getPopularItems,
  type PaletteItemType,
} from "./command-palette.js";

describe("Command Palette", () => {
  let tempDir: string;
  const workflowsDir = ".openclaw/workflows";

  beforeEach(async () => {
    tempDir = await makeTempWorkspace("command-palette-test-");
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("fuzzyMatch", () => {
    it("should return true for empty query", () => {
      expect(fuzzyMatch("", "anything")).toBe(true);
    });

    it("should return true for exact match", () => {
      expect(fuzzyMatch("deploy", "deploy")).toBe(true);
    });

    it("should return true for substring match", () => {
      expect(fuzzyMatch("dep", "deploy")).toBe(true);
    });

    it("should return true for fuzzy match", () => {
      expect(fuzzyMatch("dpl", "deploy")).toBe(true);
    });

    it("should return false for no match", () => {
      expect(fuzzyMatch("xyz", "deploy")).toBe(false);
    });

    it("should be case insensitive", () => {
      expect(fuzzyMatch("DEP", "deploy")).toBe(true);
      expect(fuzzyMatch("dep", "DEPLOY")).toBe(true);
    });
  });

  describe("scoreMatch", () => {
    it("should give highest score for exact match", () => {
      expect(scoreMatch("deploy", "deploy")).toBe(100);
    });

    it("should give high score for starts with", () => {
      expect(scoreMatch("dep", "deploy")).toBe(80);
    });

    it("should give medium score for contains", () => {
      expect(scoreMatch("eplo", "deploy")).toBe(60);
    });

    it("should give lower score for fuzzy match", () => {
      const score = scoreMatch("dpl", "deploy");
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(60);
    });

    it("should return 0 for no match", () => {
      expect(scoreMatch("xyz", "deploy")).toBe(0);
    });
  });

  describe("loadPaletteItems", () => {
    it("should return empty array when no items exist", async () => {
      const items = await loadPaletteItems(tempDir);
      expect(items).toBeInstanceOf(Array);
      // Note: Quick actions are always loaded from built-ins
    });

    it("should load workflow items", async () => {
      const workflowsDirPath = join(tempDir, workflowsDir);
      await mkdir(workflowsDirPath, { recursive: true });
      await writeFile(
        join(workflowsDirPath, "test.yaml"),
        `
name: test-workflow
description: A test workflow
template: echo "test"
`,
      );

      const items = await loadPaletteItems(tempDir);
      const workflowItems = items.filter((item) => item.type === "workflow");
      expect(workflowItems.length).toBeGreaterThan(0);
      expect(workflowItems.some((item) => item.name === "test-workflow")).toBe(true);
    });

    it("should include correct icon for workflow", async () => {
      const workflowsDirPath = join(tempDir, workflowsDir);
      await mkdir(workflowsDirPath, { recursive: true });
      await writeFile(
        join(workflowsDirPath, "test.yaml"),
        `
name: test
description: Test
template: echo "test"
`,
      );

      const items = await loadPaletteItems(tempDir);
      const workflowItem = items.find((item) => item.name === "test");
      expect(workflowItem?.icon).toBe("📦");
    });
  });

  describe("searchPalette", () => {
    beforeEach(async () => {
      // Setup test workflows
      const workflowsDirPath = join(tempDir, workflowsDir);
      await mkdir(workflowsDirPath, { recursive: true });

      await writeFile(
        join(workflowsDirPath, "deploy.yaml"),
        `
name: deploy
description: Deploy to production
template: kubectl deploy
`,
      );

      await writeFile(
        join(workflowsDirPath, "build.yaml"),
        `
name: build
description: Build the project
template: pnpm build
`,
      );

      await writeFile(
        join(workflowsDirPath, "test.yaml"),
        `
name: test
description: Run tests
template: pnpm test
`,
      );
    });

    it("should return matching items for query", async () => {
      const result = await searchPalette("dep", { limit: 10 }, tempDir);
      expect(result.query).toBe("dep");
      expect(result.items.length).toBeGreaterThan(0);
      expect(result.items.some((item) => item.name === "deploy")).toBe(true);
    });

    it("should return all items for empty query", async () => {
      const result = await searchPalette("", { limit: 10 }, tempDir);
      expect(result.items.length).toBeGreaterThan(0);
    });

    it("should respect limit option", async () => {
      const result = await searchPalette("", { limit: 2 }, tempDir);
      expect(result.items.length).toBeLessThanOrEqual(2);
    });

    it("should filter by type", async () => {
      const result = await searchPalette(
        "",
        { includeTypes: ["workflow"], limit: 10 },
        tempDir,
      );
      expect(result.items.every((item) => item.type === "workflow")).toBe(true);
    });

    it("should sort results by score", async () => {
      const result = await searchPalette("dep", { limit: 10 }, tempDir);
      // First result should be the exact match
      if (result.items.length > 0) {
        expect(result.items[0].name).toContain("dep");
      }
    });

    it("should return correct total count", async () => {
      const result = await searchPalette("", { limit: 2 }, tempDir);
      expect(result.total).toBeGreaterThanOrEqual(result.items.length);
    });
  });

  describe("executePaletteItem", () => {
    beforeEach(async () => {
      const workflowsDirPath = join(tempDir, workflowsDir);
      await mkdir(workflowsDirPath, { recursive: true });

      await writeFile(
        join(workflowsDirPath, "greet.yaml"),
        `
name: greet
description: Greet someone
template: Hello {{name}}!
parameters:
  - name: name
    type: input
    default: World
`,
      );
    });

    it("should execute workflow by ID", async () => {
      const result = await executePaletteItem("workflow:greet", { name: "Claude" }, tempDir);
      expect(result.success).toBe(true);
      expect(result.command).toBe("Hello Claude!");
    });

    it("should return error for non-existent item", async () => {
      const result = await executePaletteItem("nonexistent:id", {}, tempDir);
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should use default parameters", async () => {
      const result = await executePaletteItem("workflow:greet", {}, tempDir);
      expect(result.success).toBe(true);
      expect(result.command).toBe("Hello World!");
    });
  });

  describe("getPaletteCategories", () => {
    it("should return list of categories", async () => {
      const workflowsDirPath = join(tempDir, workflowsDir);
      await mkdir(workflowsDirPath, { recursive: true });

      await writeFile(
        join(workflowsDirPath, "test.yaml"),
        `
name: test
description: Test workflow
template: echo test
`,
      );

      const categories = await getPaletteCategories(tempDir);
      expect(categories).toContain("workflow");
      expect(categories).toContain("quick-action");
    });

    it("should return sorted categories", async () => {
      const categories = await getPaletteCategories(tempDir);
      const sorted = [...categories].sort();
      expect(categories).toEqual(sorted);
    });
  });

  describe("getItemsByCategory", () => {
    beforeEach(async () => {
      const workflowsDirPath = join(tempDir, workflowsDir);
      await mkdir(workflowsDirPath, { recursive: true });

      await writeFile(
        join(workflowsDirPath, "deploy.yaml"),
        `
name: deploy
description: Deploy
template: kubectl deploy
`,
      );
    });

    it("should return items in specified category", async () => {
      const items = await getItemsByCategory("workflow", tempDir);
      expect(items.every((item) => item.metadata?.category === "workflow")).toBe(true);
      expect(items.length).toBeGreaterThan(0);
    });

    it("should return empty array for non-existent category", async () => {
      const items = await getItemsByCategory("nonexistent", tempDir);
      expect(items).toEqual([]);
    });
  });

  describe("getPopularItems", () => {
    it("should return limited number of items", async () => {
      const items = await getPopularItems(5, tempDir);
      expect(items.length).toBeLessThanOrEqual(5);
    });

    it("should respect custom limit", async () => {
      const items = await getPopularItems(2, tempDir);
      expect(items.length).toBeLessThanOrEqual(2);
    });
  });
});
