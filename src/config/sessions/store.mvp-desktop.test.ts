import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSessionStore, saveSessionStore } from "./store.js";

const tempDirs: string[] = [];

async function createTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-session-mvp-"));
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

describe("desktop MVP session store metadata", () => {
  it("persists sessionKey/title/lastActive for entries", async () => {
    const dir = await createTempDir();
    const storePath = path.join(dir, "sessions.json");
    const sessionKey = "agent:main:main";
    const updatedAt = 1_735_000_000_000;

    await saveSessionStore(storePath, {
      [sessionKey]: {
        sessionId: "s1",
        updatedAt,
        displayName: "Main Session",
      },
    });

    const store = loadSessionStore(storePath);
    expect(store[sessionKey]?.sessionKey).toBe(sessionKey);
    expect(store[sessionKey]?.title).toBe("Main Session");
    expect(store[sessionKey]?.lastActive).toBe(updatedAt);
  });
});
