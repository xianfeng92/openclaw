import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveStateDir: vi.fn(),
}));

vi.mock("../config/paths.js", () => ({
  resolveStateDir: mocks.resolveStateDir,
}));

import {
  decodeLocalSessionKey,
  encodeLocalSessionKey,
  resolveLocalSessionHistoryPath,
  resolveLocalSessionMetadataPath,
} from "./local-session-paths.js";

describe("local-session-paths", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-local-session-paths-"));
    mocks.resolveStateDir.mockReturnValue(stateDir);
  });

  afterEach(() => {
    fs.rmSync(stateDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("encodes session keys into Windows-safe filenames", () => {
    expect(encodeLocalSessionKey("agent:main:main")).toBe("agent%3Amain%3Amain");
    expect(decodeLocalSessionKey("agent%3Amain%3Amain")).toBe("agent:main:main");
  });

  it("prefers encoded file paths for new sessions", () => {
    expect(resolveLocalSessionHistoryPath("agent:main:main")).toBe(
      path.join(stateDir, "sessions", "agent%3Amain%3Amain.jsonl"),
    );
    expect(resolveLocalSessionMetadataPath("agent:main:main")).toBe(
      path.join(stateDir, "sessions", "agent%3Amain%3Amain.json"),
    );
  });

  it("continues using an existing legacy transcript path when present", () => {
    const legacyTranscriptPath = path.join(stateDir, "sessions", "main session.jsonl");
    fs.mkdirSync(path.dirname(legacyTranscriptPath), { recursive: true });
    fs.writeFileSync(legacyTranscriptPath, "", "utf-8");

    expect(resolveLocalSessionHistoryPath("main session")).toBe(legacyTranscriptPath);
  });
});
