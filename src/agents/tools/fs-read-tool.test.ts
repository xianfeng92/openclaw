import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFsReadTool } from "./fs-read-tool.js";

const tempDirs: string[] = [];

async function createTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-fs-read-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("fs_read tool hardening", () => {
  it("truncates large file reads by maxBytes", async () => {
    const workspace = await createTempDir();
    const filePath = path.join(workspace, "big.txt");
    const bigContent = "a".repeat(50_000);
    await fs.writeFile(filePath, bigContent, "utf8");

    const tool = createFsReadTool(workspace);
    const result = await tool.execute(
      "tool_fs_read_big_file",
      { path: "big.txt", maxBytes: 10_000 },
      undefined,
    );

    const details = result.details as {
      type?: unknown;
      truncated?: unknown;
      totalBytes?: unknown;
      returnedBytes?: unknown;
    };
    expect(details.type).toBe("file");
    expect(details.truncated).toBe(true);
    expect(details.totalBytes).toBe(50_000);
    expect(details.returnedBytes).toBe(10_000);
  });

  it("blocks symlink escapes outside the workspace", async () => {
    const workspace = await createTempDir();
    const outside = await createTempDir();
    await fs.writeFile(path.join(outside, "secret.txt"), "nope\n", "utf8");

    const linkPath = path.join(workspace, "escape");
    try {
      // On Windows, `junction` is the most reliable directory link type for tests.
      await fs.symlink(outside, linkPath, process.platform === "win32" ? "junction" : undefined);
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err ? String((err as { code?: unknown }).code) : "";
      if (code === "EPERM" || code === "EACCES") {
        // Symlink creation is environment-dependent; skip if not permitted.
        return;
      }
      throw err;
    }

    const tool = createFsReadTool(workspace);
    await expect(tool.execute("tool_fs_read_symlink_escape", { path: "escape" }, undefined)).rejects.toThrow(
      /within workspace/i,
    );
  });

  it("truncates directory trees by maxBytes", async () => {
    const workspace = await createTempDir();

    for (let i = 0; i < 200; i += 1) {
      const name = `file-${String(i).padStart(3, "0")}-${"x".repeat(50)}.txt`;
      await fs.writeFile(path.join(workspace, name), "ok\n", "utf8");
    }

    const tool = createFsReadTool(workspace);
    const result = await tool.execute(
      "tool_fs_read_tree_truncation",
      { path: ".", maxDepth: 1, maxEntries: 2000, maxBytes: 10_000 },
      undefined,
    );

    const details = result.details as {
      type?: unknown;
      truncated?: unknown;
      truncatedByBytes?: unknown;
      truncatedByEntries?: unknown;
    };

    expect(details.type).toBe("directory");
    expect(details.truncated).toBe(true);
    expect(details.truncatedByBytes).toBe(true);
    expect(details.truncatedByEntries).toBe(false);
  });
});

