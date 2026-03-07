import fs from "node:fs";
import path from "node:path";
import type { GatewayClient } from "./server-methods/types.js";

export const CYDECK_RUNTIME_CAP = "desktop.cydeck";

type CyDeckRuntimeDescriptor = {
  version?: number;
  workspacePath?: string;
  updatedAt?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function isCyDeckClient(client: GatewayClient | null | undefined): boolean {
  const mode = client?.connect?.client?.mode?.trim().toLowerCase();
  if (mode === "cydeck") {
    return true;
  }
  return client?.connect?.caps?.includes(CYDECK_RUNTIME_CAP) === true;
}

export function resolveCyDeckRuntimePath(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.OPENCLAW_CYDECK_RUNTIME_PATH?.trim();
  if (explicit) {
    return explicit;
  }
  const stateDir = env.OPENCLAW_STATE_DIR?.trim();
  if (!stateDir) {
    return null;
  }
  return path.join(stateDir, "cydeck-runtime.json");
}

export function loadCyDeckRuntimeDescriptor(
  env: NodeJS.ProcessEnv = process.env,
): CyDeckRuntimeDescriptor | null {
  const runtimePath = resolveCyDeckRuntimePath(env);
  if (!runtimePath || !fs.existsSync(runtimePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(runtimePath, "utf-8");
    const parsed = asRecord(JSON.parse(raw));
    if (!parsed) {
      return null;
    }
    return {
      version: typeof parsed.version === "number" ? parsed.version : undefined,
      workspacePath:
        typeof parsed.workspacePath === "string" ? parsed.workspacePath.trim() : undefined,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt.trim() : undefined,
    };
  } catch {
    return null;
  }
}

export function resolveCyDeckWorkspacePath(env: NodeJS.ProcessEnv = process.env): string | null {
  const runtime = loadCyDeckRuntimeDescriptor(env);
  const workspacePath = runtime?.workspacePath?.trim();
  return workspacePath ? workspacePath : null;
}

export function normalizeCyDeckAgentHint(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "main") {
    return undefined;
  }
  if (normalized === "gpt") {
    return "openai";
  }
  return normalized;
}

export function buildCyDeckAgentHintSystemPrompt(agentHint?: string): string {
  if (!agentHint) {
    return "";
  }
  return [
    "[cydeck:agent-hint]",
    `Preferred agent profile: ${agentHint}.`,
    "Use this profile as a planning and style hint while answering the user.",
  ].join("\n");
}
