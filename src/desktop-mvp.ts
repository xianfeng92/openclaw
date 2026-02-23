import { isTruthyEnvValue } from "./infra/env.js";

const DESKTOP_MVP_SLIM_KEYS = [
  "OPENCLAW_DESKTOP_MVP_SLIM",
  "CLAWDBOT_DESKTOP_MVP_SLIM",
] as const;

export function resolveDesktopMvpSlimMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return DESKTOP_MVP_SLIM_KEYS.some((key) => isTruthyEnvValue(env[key]));
}

export const DESKTOP_MVP_SLIM_MODE = resolveDesktopMvpSlimMode();
