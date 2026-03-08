import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveStateDir } from "../config/paths.js";

function isLegacySessionKeyPathSafe(sessionKey: string): boolean {
  return !/[\\/]/.test(sessionKey) && !sessionKey.includes("..");
}

export function encodeLocalSessionKey(sessionKey: string): string {
  return encodeURIComponent(sessionKey);
}

export function decodeLocalSessionKey(encodedSessionKey: string): string {
  try {
    return decodeURIComponent(encodedSessionKey);
  } catch {
    return encodedSessionKey;
  }
}

function resolvePreferredLocalSessionFilePath(params: {
  sessionKey: string;
  extension: ".json" | ".jsonl";
}): string {
  const sessionsDir = join(resolveStateDir(), "sessions");
  const encodedPath = join(
    sessionsDir,
    `${encodeLocalSessionKey(params.sessionKey)}${params.extension}`,
  );
  if (existsSync(encodedPath)) {
    return encodedPath;
  }

  if (isLegacySessionKeyPathSafe(params.sessionKey)) {
    const legacyPath = join(sessionsDir, `${params.sessionKey}${params.extension}`);
    if (existsSync(legacyPath)) {
      return legacyPath;
    }
  }

  return encodedPath;
}

export function resolveLocalSessionHistoryPath(sessionKey: string): string {
  return resolvePreferredLocalSessionFilePath({ sessionKey, extension: ".jsonl" });
}

export function resolveLocalSessionMetadataPath(sessionKey: string): string {
  return resolvePreferredLocalSessionFilePath({ sessionKey, extension: ".json" });
}
