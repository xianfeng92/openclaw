import path from "node:path";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId, resolveSessionAgentId } from "../agents/agent-scope.js";
import { type OpenClawConfig, loadConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { hashText } from "../memory/internal.js";
import { getMemorySearchManager, type MemorySearchManagerResult } from "../memory/search-manager.js";

type AgentEntry = NonNullable<NonNullable<OpenClawConfig["agents"]>["list"]>[number];

function normalizePathForCompare(input: string): string {
  const normalized = path.normalize(input).replace(/[\\/]+$/u, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function samePath(left: string, right: string): boolean {
  return normalizePathForCompare(left) === normalizePathForCompare(right);
}

function ensureAgentEntry(cfg: OpenClawConfig, agentId: string): AgentEntry {
  cfg.agents ??= {};
  cfg.agents.list ??= [];

  let entry = cfg.agents.list.find((item) => item?.id?.trim() === agentId);
  if (!entry) {
    entry = { id: agentId };
    cfg.agents.list.push(entry);
  }
  return entry;
}

function ensureAgentDefaults(cfg: OpenClawConfig): NonNullable<NonNullable<OpenClawConfig["agents"]>["defaults"]> {
  cfg.agents ??= {};
  cfg.agents.defaults ??= {};
  return cfg.agents.defaults;
}

function setWorkspaceOverride(cfg: OpenClawConfig, agentId: string, workspacePath: string): void {
  const defaultAgentId = resolveDefaultAgentId(cfg);
  const entry = ensureAgentEntry(cfg, agentId);
  entry.workspace = workspacePath;

  if (agentId === defaultAgentId) {
    ensureAgentDefaults(cfg).workspace = workspacePath;
  }
}

function setStorePathOverride(cfg: OpenClawConfig, agentId: string, storePath: string): void {
  const defaultAgentId = resolveDefaultAgentId(cfg);
  const entry = ensureAgentEntry(cfg, agentId);
  entry.memorySearch ??= {};
  entry.memorySearch.store ??= {};
  entry.memorySearch.store.path = storePath;

  if (agentId === defaultAgentId) {
    const defaults = ensureAgentDefaults(cfg);
    defaults.memorySearch ??= {};
    defaults.memorySearch.store ??= {};
    defaults.memorySearch.store.path = storePath;
  }
}

function buildIsolatedStorePath(agentId: string, workspacePath: string): string {
  const workspaceHash = hashText(normalizePathForCompare(workspacePath)).slice(0, 12);
  return path.join(resolveStateDir(), "memory", `cydeck-${agentId}-${workspaceHash}.sqlite`);
}

export function buildCyDeckMemoryConfig(params: {
  cfg: OpenClawConfig;
  agentId: string;
  workspacePath: string;
}): OpenClawConfig {
  const next = structuredClone(params.cfg);
  const resolvedWorkspacePath = path.resolve(params.workspacePath);
  const originalWorkspacePath = resolveAgentWorkspaceDir(next, params.agentId);

  setWorkspaceOverride(next, params.agentId, resolvedWorkspacePath);

  // If CyDeck points at a different workspace than the agent default, isolate the
  // index path so concurrent indexes do not churn the same sqlite file.
  if (!samePath(originalWorkspacePath, resolvedWorkspacePath)) {
    setStorePathOverride(
      next,
      params.agentId,
      buildIsolatedStorePath(params.agentId, resolvedWorkspacePath),
    );
  }

  return next;
}

export async function getCyDeckMemoryManager(params: {
  workspacePath: string;
  sessionKey?: string;
}): Promise<MemorySearchManagerResult & { agentId: string; cfg: OpenClawConfig }> {
  const cfg = loadConfig();
  const agentId = resolveSessionAgentId({
    sessionKey: params.sessionKey,
    config: cfg,
  });
  const cydeckCfg = buildCyDeckMemoryConfig({
    cfg,
    agentId,
    workspacePath: params.workspacePath,
  });
  const result = await getMemorySearchManager({
    cfg: cydeckCfg,
    agentId,
  });
  return {
    ...result,
    agentId,
    cfg: cydeckCfg,
  };
}
