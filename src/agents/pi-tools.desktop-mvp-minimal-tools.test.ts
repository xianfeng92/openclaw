import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import "./test-helpers/fast-coding-tools.js";
import { createOpenClawCodingTools } from "./pi-tools.js";

const tempDirs: string[] = [];

async function createTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-mvp-tools-"));
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

describe("desktop MVP minimal toolset", () => {
  it("exposes only fs_read and bash_exec", () => {
    const tools = createOpenClawCodingTools({ desktopMvpMinimalToolset: true });
    expect(tools.map((tool) => tool.name)).toEqual(["fs_read", "bash_exec"]);
  });

  it("fs_read lists directory trees and emits updates", async () => {
    const dir = await createTempDir();
    await fs.mkdir(path.join(dir, "docs"));
    await fs.writeFile(path.join(dir, "README.md"), "# Demo\n", "utf8");
    await fs.writeFile(path.join(dir, "docs", "report.md"), "ok\n", "utf8");

    const tools = createOpenClawCodingTools({ workspaceDir: dir, desktopMvpMinimalToolset: true });
    const tool = tools.find((entry) => entry.name === "fs_read");
    expect(tool).toBeTruthy();

    const updates: unknown[] = [];
    const result = await tool!.execute(
      "tool_fs_read_demo",
      { path: ".", maxDepth: 2, maxEntries: 200 },
      undefined,
      (partial) => {
        updates.push(partial);
      },
    );

    const text = result.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    expect(text).toContain("Directory Tree");
    expect(text).toContain("README.md");
    expect(text).toContain("docs");
    expect(updates.length).toBeGreaterThan(0);
  });
});
