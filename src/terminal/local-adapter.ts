/**
 * Local Adapter - Standalone Terminal Mode
 *
 * Enables Super AI Terminal to run without Gateway by using:
 * - Embedded Pi agent for chat
 * - Local session storage
 * - Local agent discovery
 * - Local model catalog
 *
 * MVP: Implements core chat functionality with minimal feature set.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type {
  TerminalAdapter,
  ChatSendOptions,
  ChatSendResult,
  AbortOptions,
  HistoryOptions,
  HistoryResult,
  SessionListOptions,
  SessionListResult,
  SessionPatchOptions,
  SessionPatchResult,
  AgentsListResult,
  ModelsListResult,
  AdapterStatus,
  AdapterEvent,
  EventListener,
  AdapterConnection,
} from "./adapter-types.js";
import { loadConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { resolveAgentWorkspaceDir } from "../agents/agent-paths.js";
import { runEmbeddedPiAgent } from "../agents/pi-embedded-runner/run.js";
import { loadModelCatalog } from "../agents/model-catalog.js";

/**
 * Local session storage path
 */
function resolveLocalSessionPath(sessionKey: string): string {
  const openclawDir = resolveStateDir();
  return join(openclawDir, "sessions", `${sessionKey}.jsonl`);
}

/**
 * Local agents directory
 */
function resolveLocalAgentsDir(): string {
  const openclawDir = resolveStateDir();
  return join(openclawDir, "agents");
}

/**
 * Simple JSONL session storage
 */
class LocalSessionStore {
  private path: string;

  constructor(sessionKey: string) {
    this.path = resolveLocalSessionPath(sessionKey);
  }

  async append(entry: HistoryResult["entries"][number]): Promise<void> {
    const dir = join(this.path, "..");
    await mkdir(dir, { recursive: true });
    const line = JSON.stringify({ ...entry, timestamp: entry.timestamp ?? Date.now() });
    await writeFile(this.path, `${line}\n`, { flag: "a" });
  }

  async load(limit?: number): Promise<HistoryResult> {
    if (!existsSync(this.path)) {
      return { entries: [] };
    }
    const content = await readFile(this.path, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const entries = lines
      .map((line) => {
        try {
          return JSON.parse(line) as HistoryResult["entries"][number];
        } catch {
          return null;
        }
      })
      .filter((e): e is HistoryResult["entries"][number] => e !== null);
    return {
      entries: limit ? entries.slice(-limit) : entries,
    };
  }

  async reset(): Promise<void> {
    if (existsSync(this.path)) {
      await writeFile(this.path, "");
    }
  }
}

/**
 * Local Adapter Implementation
 */
export class LocalAdapter implements TerminalAdapter {
  readonly mode = "local" as const;

  private ready = false;
  private eventListeners: Set<EventListener> = new Set();
  private connectedCallback?: () => void;
  private disconnectedCallback?: (reason: string) => void;
  private activeRuns = new Map<string, AbortController>();
  private config = loadConfig();

  // Expose connection info for TUI compatibility
  readonly connection: AdapterConnection = {
    url: "local://embedded",
  };

  constructor() {
    // Pre-resolve agents directory
    void this.ensureAgentsDir();
  }

  private async ensureAgentsDir(): Promise<void> {
    const agentsDir = resolveLocalAgentsDir();
    if (!existsSync(agentsDir)) {
      await mkdir(agentsDir, { recursive: true });
    }
  }

  async start(): Promise<void> {
    this.ready = true;
    this.emitEvent({ type: "status", payload: { message: "Local mode ready" } });
    this.connectedCallback?.();
  }

  stop(): void {
    this.ready = false;
    // Abort all active runs
    for (const controller of this.activeRuns.values()) {
      controller.abort();
    }
    this.activeRuns.clear();
    this.disconnectedCallback?.("Adapter stopped");
  }

  isReady(): boolean {
    return this.ready;
  }

  getStatus(): AdapterStatus {
    return {
      connected: this.ready,
      mode: "local",
      message: this.ready ? "Running in standalone mode" : "Not ready",
    };
  }

  async sendChat(opts: ChatSendOptions): Promise<ChatSendResult> {
    if (!this.ready) {
      return { runId: "", status: "error", error: "Adapter not ready" };
    }

    const runId = opts.runId ?? randomUUID();
    const controller = new AbortController();
    this.activeRuns.set(runId, controller);

    try {
      // Create session store for history
      const store = new LocalSessionStore(opts.sessionKey);

      // Load existing history for context
      const { entries } = await store.load();
      const messages = entries.map((e) => ({
        role: e.role,
        content: e.content,
      }));

      // Add current message
      messages.push({ role: "user", content: opts.message });

      // Run embedded agent
      const result = await runEmbeddedPiAgent({
        message: opts.message,
        sessionKey: opts.sessionKey,
        agentId: this.config.agents?.defaultId ?? "main",
        model: this.config.agents?.defaultModel,
        modelProvider: this.config.agents?.defaultModelProvider,
        messages,
        signal: controller.signal,
      });

      // Store assistant response
      await store.append({
        role: "assistant",
        content: result.reply,
        runId,
      });

      // Emit chat event for streaming
      this.emitEvent({
        type: "chat",
        payload: {
          runId,
          sessionKey: opts.sessionKey,
          reply: result.reply,
          usage: result.usage,
        },
      });

      return { runId, status: "complete" };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.emitEvent({ type: "error", payload: { error } });
      return { runId, status: "error", error };
    } finally {
      this.activeRuns.delete(runId);
    }
  }

  async abortChat(opts: AbortOptions): Promise<void> {
    const controller = this.activeRuns.get(opts.runId);
    if (controller) {
      controller.abort();
      this.activeRuns.delete(opts.runId);
    }
  }

  async loadHistory(opts: HistoryOptions): Promise<HistoryResult> {
    const store = new LocalSessionStore(opts.sessionKey);
    return store.load(opts.limit);
  }

  async listSessions(opts?: SessionListOptions): Promise<SessionListResult> {
    const sessionsDir = join(resolveStateDir(), "sessions");
    if (!existsSync(sessionsDir)) {
      return { sessions: [] };
    }

    const files = await readdir(sessionsDir);
    const sessions: SessionListResult["sessions"] = [];

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;

      const sessionKey = file.replace(".jsonl", "");
      const store = new LocalSessionStore(sessionKey);
      const { entries } = await store.load(1);

      if (entries.length > 0) {
        const last = entries[entries.length - 1];
        sessions.push({
          key: sessionKey,
          updatedAt: last.timestamp,
          lastMessagePreview: last.content?.slice(0, 100),
        });
      }

      if (opts?.limit && sessions.length >= opts.limit) {
        break;
      }
    }

    return { sessions };
  }

  async patchSession(opts: SessionPatchOptions): Promise<SessionPatchResult> {
    // MVP: Session settings are stored in config, not per-session
    // For now, just return ok - full implementation would store per-session settings
    return { ok: true };
  }

  async resetSession(sessionKey: string): Promise<void> {
    const store = new LocalSessionStore(sessionKey);
    await store.reset();
  }

  async listAgents(): Promise<AgentsListResult> {
    const agentsDir = resolveLocalAgentsDir();
    const agents: AgentsListResult["agents"] = [];

    if (existsSync(agentsDir)) {
      const entries = await readdir(agentsDir);
      for (const entry of entries) {
        const agentDir = join(agentsDir, entry);
        const identityPath = join(agentDir, "IDENTITY.md");
        if (existsSync(identityPath)) {
          agents.push({ id: entry, name: entry });
        }
      }
    }

    // Ensure "main" agent exists as default
    if (!agents.find((a) => a.id === "main")) {
      agents.push({ id: "main", name: "Main" });
    }

    return {
      defaultId: this.config.agents?.defaultId ?? "main",
      agents,
    };
  }

  async listModels(): Promise<ModelsListResult> {
    const catalog = await loadModelCatalog({ config: this.config });
    const models: ModelChoice[] = [];

    for (const [provider, providerModels] of Object.entries(catalog)) {
      for (const model of providerModels) {
        models.push({
          id: model.id,
          name: model.name,
          provider,
          contextWindow: model.contextWindow,
          reasoning: model.reasoning,
        });
      }
    }

    return { models };
  }

  onEvent(listener: EventListener): void {
    this.eventListeners.add(listener);
  }

  onConnected(callback: () => void): void {
    this.connectedCallback = callback;
  }

  onDisconnected(callback: (reason: string) => void): void {
    this.disconnectedCallback = callback;
  }

  private emitEvent(event: AdapterEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }
}
