/**
 * Blocks UI system tests
 */

import { describe, it, expect } from "vitest";
import {
  createBlock,
  addBlockOutput,
  finalizeBlock,
  cancelBlock,
  toggleBlockCollapsed,
  computeBlockStats,
  formatBlock,
  getStatusIcon,
  formatDuration,
  searchInBlock,
  getBlockOutputAsText,
  getBlockOutputAsJSON,
  createBlockShareLink,
  parseBlockShareLink,
  filterBlocks,
  sortBlocks,
  getBlockSummary,
  type BlockStatus,
} from "./blocks.js";

describe("Blocks UI", () => {
  describe("createBlock", () => {
    it("should create a block with correct initial state", () => {
      const block = createBlock({
        command: "npm test",
        workingDir: "/project",
        sessionId: "session-1",
      });

      expect(block.command).toBe("npm test");
      expect(block.status).toBe("running");
      expect(block.exitCode).toBeNull();
      expect(block.output).toEqual([]);
      expect(block.metadata.workingDir).toBe("/project");
      expect(block.metadata.sessionId).toBe("session-1");
      expect(block.collapsed).toBe(false);
      expect(block.id).toBeDefined();
    });

    it("should accept optional metadata", () => {
      const block = createBlock({
        command: "ls",
        workingDir: "/home",
        sessionId: "session-2",
        shell: "bash",
        userId: "user-1",
        tags: ["file", "list"],
      });

      expect(block.metadata.shell).toBe("bash");
      expect(block.metadata.userId).toBe("user-1");
      expect(block.metadata.tags).toEqual(["file", "list"]);
    });
  });

  describe("addBlockOutput", () => {
    it("should add stdout output lines", () => {
      let block = createBlock({
        command: "echo hello",
        workingDir: "/",
        sessionId: "s1",
      });

      block = addBlockOutput(block, "hello", "stdout");

      expect(block.output).toHaveLength(1);
      expect(block.output[0]?.content).toBe("hello");
      expect(block.output[0]?.type).toBe("stdout");
    });

    it("should add multi-line output", () => {
      let block = createBlock({
        command: "ls",
        workingDir: "/",
        sessionId: "s1",
      });

      block = addBlockOutput(block, "file1\nfile2\nfile3", "stdout");

      expect(block.output).toHaveLength(3);
      expect(block.output[0]?.content).toBe("file1");
      expect(block.output[1]?.content).toBe("file2");
      expect(block.output[2]?.content).toBe("file3");
    });

    it("should append to existing output", () => {
      let block = createBlock({
        command: "test",
        workingDir: "/",
        sessionId: "s1",
      });

      block = addBlockOutput(block, "line1", "stdout");
      block = addBlockOutput(block, "line2", "stdout");

      expect(block.output).toHaveLength(2);
    });
  });

  describe("finalizeBlock", () => {
    it("should set status to success for exit code 0", () => {
      let block = createBlock({
        command: "true",
        workingDir: "/",
        sessionId: "s1",
      });

      block = finalizeBlock(block, 0);

      expect(block.status).toBe("success");
      expect(block.exitCode).toBe(0);
      expect(block.duration).toBeGreaterThanOrEqual(0);
      expect(block.stats).toBeDefined();
    });

    it("should set status to error for non-zero exit code", () => {
      let block = createBlock({
        command: "false",
        workingDir: "/",
        sessionId: "s1",
      });

      block = finalizeBlock(block, 1);

      expect(block.status).toBe("error");
      expect(block.exitCode).toBe(1);
    });

    it("should compute stats on finalization", () => {
      let block = createBlock({
        command: "test",
        workingDir: "/",
        sessionId: "s1",
      });

      block = addBlockOutput(block, "error: something went wrong\nwarning: deprecated API", "stdout");
      block = finalizeBlock(block, 1);

      expect(block.stats?.errorCount).toBe(1);
      expect(block.stats?.warningCount).toBe(1);
      expect(block.stats?.lineCount).toBe(2);
    });
  });

  describe("cancelBlock", () => {
    it("should set status to cancelled", () => {
      let block = createBlock({
        command: "long-running",
        workingDir: "/",
        sessionId: "s1",
      });

      block = cancelBlock(block);

      expect(block.status).toBe("cancelled");
      expect(block.exitCode).toBeNull();
      expect(block.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe("toggleBlockCollapsed", () => {
    it("should toggle collapsed state", () => {
      let block = createBlock({
        command: "test",
        workingDir: "/",
        sessionId: "s1",
      });

      expect(block.collapsed).toBe(false);

      block = toggleBlockCollapsed(block);
      expect(block.collapsed).toBe(true);

      block = toggleBlockCollapsed(block);
      expect(block.collapsed).toBe(false);
    });
  });

  describe("computeBlockStats", () => {
    it("should count errors and warnings", () => {
      const block = createBlock({
        command: "test",
        workingDir: "/",
        sessionId: "s1",
      });

      const blockWithOutput = addBlockOutput(block, "error: test failed\nwarning: deprecated\nok", "stdout");

      const stats = computeBlockStats(blockWithOutput);

      expect(stats.errorCount).toBe(1);
      expect(stats.warningCount).toBe(1);
      expect(stats.lineCount).toBe(3);
    });

    it("should count characters", () => {
      const block = createBlock({
        command: "test",
        workingDir: "/",
        sessionId: "s1",
      });

      const blockWithOutput = addBlockOutput(block, "hello world", "stdout");

      const stats = computeBlockStats(blockWithOutput);

      expect(stats.charCount).toBe(11); // "hello world".length
    });
  });

  describe("formatBlock", () => {
    it("should format block with header and output", () => {
      let block = createBlock({
        command: "echo hello",
        workingDir: "/",
        sessionId: "s1",
      });

      block = addBlockOutput(block, "hello", "stdout");
      block = finalizeBlock(block, 0);

      const formatted = formatBlock(block);

      expect(formatted).toContain("echo hello");
      expect(formatted).toContain("hello");
      expect(formatted).toContain("exit: 0");
    });

    it("should show running icon for running blocks", () => {
      const block = createBlock({
        command: "sleep",
        workingDir: "/",
        sessionId: "s1",
      });

      const formatted = formatBlock(block);
      expect(formatted).toContain("▶");
    });

    it("should show success icon for success", () => {
      let block = createBlock({
        command: "true",
        workingDir: "/",
        sessionId: "s1",
      });

      block = finalizeBlock(block, 0);
      const formatted = formatBlock(block);

      expect(formatted).toContain("✓");
    });

    it("should show error icon for errors", () => {
      let block = createBlock({
        command: "false",
        workingDir: "/",
        sessionId: "s1",
      });

      block = finalizeBlock(block, 1);
      const formatted = formatBlock(block);

      expect(formatted).toContain("✗");
    });
  });

  describe("getStatusIcon", () => {
    it("should return correct icons", () => {
      expect(getStatusIcon("running")).toBe("▶");
      expect(getStatusIcon("success")).toBe("✓");
      expect(getStatusIcon("error")).toBe("✗");
      expect(getStatusIcon("cancelled")).toBe("○");
    });
  });

  describe("formatDuration", () => {
    it("should format milliseconds", () => {
      expect(formatDuration(500)).toBe("500ms");
    });

    it("should format seconds", () => {
      expect(formatDuration(1500)).toBe("1.5s");
      expect(formatDuration(30000)).toBe("30.0s");
    });

    it("should format minutes and seconds", () => {
      expect(formatDuration(65000)).toBe("1m 5s");
      expect(formatDuration(125000)).toBe("2m 5s");
    });
  });

  describe("searchInBlock", () => {
    it("should find matches in block output", () => {
      let block = createBlock({
        command: "test",
        workingDir: "/",
        sessionId: "s1",
      });

      block = addBlockOutput(block, "error: test failed\nwarning: deprecated\nerror: another error", "stdout");

      const result = searchInBlock(block, { query: "error" });

      expect(result.totalMatches).toBe(3); // 2 in "error:" + 1 in "another error"
      expect(result.matches).toHaveLength(3);
    });

    it("should be case insensitive by default", () => {
      let block = createBlock({
        command: "test",
        workingDir: "/",
        sessionId: "s1",
      });

      block = addBlockOutput(block, "Hello World", "stdout");

      const result = searchInBlock(block, { query: "hello" });

      expect(result.totalMatches).toBe(1);
    });

    it("should support case sensitive search", () => {
      let block = createBlock({
        command: "test",
        workingDir: "/",
        sessionId: "s1",
      });

      block = addBlockOutput(block, "Hello World", "stdout");

      const result = searchInBlock(block, { query: "hello", caseSensitive: true });

      expect(result.totalMatches).toBe(0);
    });

    it("should filter by output type", () => {
      let block = createBlock({
        command: "test",
        workingDir: "/",
        sessionId: "s1",
      });

      block = addBlockOutput(block, "error message", "stdout");
      block = addBlockOutput(block, "error message", "stderr");

      const result = searchInBlock(block, { query: "error", outputType: "stderr" });

      expect(result.totalMatches).toBe(1);
    });

    it("should return empty result for empty query", () => {
      let block = createBlock({
        command: "test",
        workingDir: "/",
        sessionId: "s1",
      });

      block = addBlockOutput(block, "some content", "stdout");

      const result = searchInBlock(block, { query: "" });

      expect(result.totalMatches).toBe(0);
      expect(result.matches).toHaveLength(0);
    });
  });

  describe("getBlockOutputAsText", () => {
    it("should return output lines as text", () => {
      let block = createBlock({
        command: "ls",
        workingDir: "/",
        sessionId: "s1",
      });

      block = addBlockOutput(block, "file1\nfile2", "stdout");

      const text = getBlockOutputAsText(block);

      expect(text).toBe("file1\nfile2");
    });

    it("should exclude system output by default", () => {
      let block = createBlock({
        command: "test",
        workingDir: "/",
        sessionId: "s1",
      });

      block = addBlockOutput(block, "normal output", "stdout");
      block = addBlockOutput(block, "system message", "system");

      const text = getBlockOutputAsText(block, false);

      expect(text).toBe("normal output");
    });

    it("should include system output when requested", () => {
      let block = createBlock({
        command: "test",
        workingDir: "/",
        sessionId: "s1",
      });

      block = addBlockOutput(block, "normal output", "stdout");
      block = addBlockOutput(block, "system message", "system");

      const text = getBlockOutputAsText(block, true);

      expect(text).toContain("normal output");
      expect(text).toContain("system message");
    });
  });

  describe("getBlockOutputAsJSON", () => {
    it("should return output as JSON string", () => {
      let block = createBlock({
        command: "test",
        workingDir: "/",
        sessionId: "s1",
      });

      block = addBlockOutput(block, "hello", "stdout");

      const json = getBlockOutputAsJSON(block);
      const parsed = JSON.parse(json);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].content).toBe("hello");
    });
  });

  describe("createBlockShareLink", () => {
    it("should create a shareable link", () => {
      const block = createBlock({
        command: "npm install",
        workingDir: "/",
        sessionId: "s1",
      });

      const link = createBlockShareLink(block, "https://example.com");

      expect(link).toContain("https://example.com/block/");
      expect(link).toContain(block.id);
    });
  });

  describe("parseBlockShareLink", () => {
    it("should parse a valid share link", () => {
      // "npm install" encoded as base64
      const link = "https://example.com/block/abc123/bnBtIGluc3RhbGw=";

      const parsed = parseBlockShareLink(link);

      expect(parsed?.id).toBe("abc123");
      expect(parsed?.command).toBe("npm install");
    });

    it("should return null for invalid link", () => {
      const parsed = parseBlockShareLink("not-a-url");
      expect(parsed).toBeNull();
    });
  });

  describe("filterBlocks", () => {
    it("should filter by status", () => {
      const blocks: BlockStatus[] = ["success", "error", "running"].map((status) => {
        let b = createBlock({ command: "test", workingDir: "/", sessionId: "s1" });
        if (status !== "running") {
          b = finalizeBlock(b, status === "success" ? 0 : 1);
        }
        return b;
      });

      const successBlocks = filterBlocks(blocks, { status: "success" });

      expect(successBlocks).toHaveLength(1);
      expect(successBlocks[0]?.status).toBe("success");
    });

    it("should filter by sessionId", () => {
      const blocks = [
        createBlock({ command: "test1", workingDir: "/", sessionId: "s1" }),
        createBlock({ command: "test2", workingDir: "/", sessionId: "s2" }),
      ];

      const s1Blocks = filterBlocks(blocks, { sessionId: "s1" });

      expect(s1Blocks).toHaveLength(1);
      expect(s1Blocks[0]?.metadata.sessionId).toBe("s1");
    });

    it("should filter by tags", () => {
      const blocks = [
        createBlock({ command: "test1", workingDir: "/", sessionId: "s1", tags: ["a", "b"] }),
        createBlock({ command: "test2", workingDir: "/", sessionId: "s1", tags: ["b", "c"] }),
      ];

      const filtered = filterBlocks(blocks, { tags: ["a"] });

      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.metadata.tags).toContain("a");
    });

    it("should filter by command pattern", () => {
      const blocks = [
        createBlock({ command: "npm test", workingDir: "/", sessionId: "s1" }),
        createBlock({ command: "npm build", workingDir: "/", sessionId: "s1" }),
        createBlock({ command: "git status", workingDir: "/", sessionId: "s1" }),
      ];

      const filtered = filterBlocks(blocks, { commandPattern: /^npm/ });

      expect(filtered).toHaveLength(2);
    });
  });

  describe("sortBlocks", () => {
    it("should sort by timestamp", () => {
      const blocks = [
        createBlock({ command: "old", workingDir: "/", sessionId: "s1" }),
        createBlock({ command: "new", workingDir: "/", sessionId: "s1" }),
      ];

      // Add delay to ensure different timestamps
      const sorted = sortBlocks(blocks, "timestamp", "asc");

      expect(sorted[0]?.timestamp).toBeLessThanOrEqual(sorted[1]?.timestamp ?? 0);
    });

    it("should sort by duration", () => {
      let b1 = createBlock({ command: "fast", workingDir: "/", sessionId: "s1" });
      let b2 = createBlock({ command: "slow", workingDir: "/", sessionId: "s1" });

      b1 = finalizeBlock(b1, 0);
      b2 = finalizeBlock(b2, 0);

      // Manually set different durations for testing
      b1.duration = 100;
      b2.duration = 1000;

      const sorted = sortBlocks([b1, b2], "duration", "desc");

      expect(sorted[0]?.duration).toBeGreaterThan(sorted[1]?.duration ?? 0);
    });

    it("should sort by status", () => {
      let b1 = createBlock({ command: "test1", workingDir: "/", sessionId: "s1" });
      let b2 = createBlock({ command: "test2", workingDir: "/", sessionId: "s1" });

      b1 = finalizeBlock(b1, 0); // success
      b2 = finalizeBlock(b2, 1); // error

      const sorted = sortBlocks([b1, b2], "status", "asc");

      // Order: running, success, error, cancelled
      expect(sorted[0]?.status).toBe("success");
      expect(sorted[1]?.status).toBe("error");
    });
  });

  describe("getBlockSummary", () => {
    it("should return block summary", () => {
      let block = createBlock({
        command: "npm test",
        workingDir: "/",
        sessionId: "s1",
      });

      block = addBlockOutput(block, "PASS", "stdout");
      block = addBlockOutput(block, "FAIL", "stderr");
      block = finalizeBlock(block, 1);

      const summary = getBlockSummary(block);

      expect(summary.id).toBe(block.id);
      expect(summary.command).toBe("npm test");
      expect(summary.status).toBe("error");
      expect(summary.exitCode).toBe(1);
      expect(summary.outputLineCount).toBe(2);
      expect(summary.duration).toBeGreaterThanOrEqual(0);
    });

    it("should detect errors in summary", () => {
      let block = createBlock({
        command: "test",
        workingDir: "/",
        sessionId: "s1",
      });

      block = addBlockOutput(block, "error: failed", "stdout");
      block = finalizeBlock(block, 1);

      const summary = getBlockSummary(block);

      expect(summary.hasErrors).toBe(true);
    });

    it("should detect warnings in summary", () => {
      let block = createBlock({
        command: "test",
        workingDir: "/",
        sessionId: "s1",
      });

      block = addBlockOutput(block, "warning: deprecated", "stdout");
      block = finalizeBlock(block, 0);

      const summary = getBlockSummary(block);

      expect(summary.hasWarnings).toBe(true);
    });
  });
});
