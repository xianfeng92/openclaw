import type { OpenClawConfig } from "./types.js";

const BLOCKED_CONFIG_ENV_KEYS = new Set([
  "BASH_ENV",
  "ENV",
  "PS4",
  "SHELL",
  "HOME",
  "ZDOTDIR",
]);

function isBlockedConfigEnvVar(key: string): boolean {
  return BLOCKED_CONFIG_ENV_KEYS.has(key.trim().toUpperCase());
}

export function collectConfigEnvVars(cfg?: OpenClawConfig): Record<string, string> {
  const envConfig = cfg?.env;
  if (!envConfig) {
    return {};
  }

  const entries: Record<string, string> = {};

  if (envConfig.vars) {
    for (const [rawKey, value] of Object.entries(envConfig.vars)) {
      if (!value) {
        continue;
      }
      const key = rawKey.trim();
      if (!key || isBlockedConfigEnvVar(key)) {
        continue;
      }
      entries[key] = value;
    }
  }

  for (const [rawKey, value] of Object.entries(envConfig)) {
    if (rawKey === "shellEnv" || rawKey === "vars") {
      continue;
    }
    if (typeof value !== "string" || !value.trim()) {
      continue;
    }
    const key = rawKey.trim();
    if (!key || isBlockedConfigEnvVar(key)) {
      continue;
    }
    entries[key] = value;
  }

  return entries;
}
