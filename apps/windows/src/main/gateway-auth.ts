import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

type StoredGatewayAuthV1 = {
  version: 1;
  token: string;
  createdAtMs: number;
};

function isValidToken(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 16;
}

function generateToken(): string {
  // 32 bytes -> 43 char base64url (no "+", "/", "=").
  return randomBytes(32).toString("base64url");
}

function authFilePath(): string {
  return path.join(app.getPath("userData"), "gateway-auth.json");
}

function readStoredAuth(filePath: string): StoredGatewayAuthV1 | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoredGatewayAuthV1> | null;
    if (!parsed || parsed.version !== 1 || !isValidToken(parsed.token)) {
      return null;
    }
    return {
      version: 1,
      token: parsed.token.trim(),
      createdAtMs: typeof parsed.createdAtMs === "number" ? parsed.createdAtMs : Date.now(),
    };
  } catch {
    return null;
  }
}

function writeStoredAuth(filePath: string, token: string): void {
  const data: StoredGatewayAuthV1 = {
    version: 1,
    token,
    createdAtMs: Date.now(),
  };

  // Best-effort atomic write.
  const dir = path.dirname(filePath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }

  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
}

export type GatewayAuthInfo = {
  token: string;
  path: string;
};

export function loadOrCreateGatewayAuth(): GatewayAuthInfo {
  const filePath = authFilePath();
  const existing = readStoredAuth(filePath);
  if (existing) {
    return { token: existing.token, path: filePath };
  }

  const token = generateToken();
  writeStoredAuth(filePath, token);
  return { token, path: filePath };
}

export function rotateGatewayAuthToken(): GatewayAuthInfo {
  const filePath = authFilePath();
  const token = generateToken();
  writeStoredAuth(filePath, token);
  return { token, path: filePath };
}

