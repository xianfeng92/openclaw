/// <reference lib="dom" />

import { contextBridge, ipcRenderer } from "electron";

export type TerminalConfigIssue = {
  code: string;
  severity: "error" | "warning";
  message: string;
  path?: string;
  varName?: string;
};

export type TerminalConfigValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  issues: TerminalConfigIssue[];
};

export interface TerminalAPI {
  // Shell execution
  execShell: (command: string) => Promise<{ runId: string }>;
  abortShell: (runId: string) => Promise<{ success: boolean }>;
  onShellOutput: (
    callback: (data: { runId: string; type: string; data: string; exitCode?: number | null }) => void,
  ) => () => void;

  // Gateway info
  getGatewayInfo: () => Promise<{ port?: number; token?: string }>;

  // Get auth sync (for bootstrap)
  getGatewayAuthSync: () => { token: string; port: number } | null;

  // Config commands
  configGet: () => Promise<{
    success: boolean;
    configPath: string;
    stateDir: string;
    config?: unknown;
    runtimeProvider?: unknown;
    workspacePath?: string;
    validation?: TerminalConfigValidation;
    warnings?: string[];
    issues?: TerminalConfigIssue[];
    error?: string;
  }>;
  configSet: (key: string, value: string) => Promise<{
    success: boolean;
    configPath: string;
    stateDir: string;
    key?: string;
    value?: string | number | boolean;
    validation?: TerminalConfigValidation;
    warnings?: string[];
    issues?: TerminalConfigIssue[];
    error?: string;
  }>;
  configValidate: () => Promise<{
    success: boolean;
    configPath: string;
    stateDir: string;
    validation?: TerminalConfigValidation;
    warnings?: string[];
    issues?: TerminalConfigIssue[];
    error?: string;
  }>;
  configReset: () => Promise<{
    success: boolean;
    configPath: string;
    stateDir: string;
    validation?: TerminalConfigValidation;
    warnings?: string[];
    issues?: TerminalConfigIssue[];
    error?: string;
  }>;
  configPath: () => Promise<{
    success: boolean;
    configPath: string;
    stateDir: string;
    error?: string;
  }>;

  // Orchestral commands
  orchestralSpawn: (opts: {
    description: string;
    agent?: string;
    branch?: string;
    useContext?: boolean;
    relevantContext?: {
      customers: Array<{ name: string; score: number }>;
      projects: Array<{ name: string; score: number }>;
      decisions: Array<{ title: string; score: number }>;
      meetings: Array<{ title: string; score: number }>;
      patterns: Array<{ name: string; score: number }>;
    };
  }) => Promise<{ success: boolean; task?: any; error?: string }>;

  orchestralAgents: (action: string, args: string[]) => Promise<any>;

  orchestralTasks: (filters: Record<string, string>, action?: string) => Promise<any>;

  // Agent process management
  agentStart: (opts: {
    taskId: string;
    description: string;
    worktree?: string;
    agent?: string;
    branch?: string;
    useContext?: boolean;
    relevantContext?: {
      customers: Array<{ name: string; score: number }>;
      projects: Array<{ name: string; score: number }>;
      decisions: Array<{ title: string; score: number }>;
      meetings: Array<{ title: string; score: number }>;
      patterns: Array<{ name: string; score: number }>;
    };
  }) => Promise<{ success: boolean; pid?: number; error?: string }>;

  agentKill: (taskId: string) => Promise<{ success: boolean; error?: string }>;

  agentGetOutput: (taskId: string, lines?: number) => Promise<{ success: boolean; output?: string; error?: string }>;

  onAgentOutput: (
    callback: (data: { taskId: string; type: string; data: string }) => void,
  ) => () => void;

  // Context commands
  contextList: () => Promise<{
    customers: Array<{ id: string; name: string; tags?: string[] }>;
    projects: Array<{ id: string; name: string; status: string }>;
    meetings: Array<{ id: string; title: string; date: string }>;
    decisions: Array<{ id: string; title: string; status: string }>;
    patterns: Array<{ id: string; name: string; category: string }>;
  }>;

  contextSearch: (query: string) => Promise<{
    customers: Array<{ name: string; score: number }>;
    projects: Array<{ name: string; score: number }>;
    meetings: Array<{ title: string; score: number }>;
    decisions: Array<{ title: string; score: number }>;
    patterns: Array<{ name: string; score: number }>;
  }>;

  contextLoad: (vaultPath?: string) => Promise<{
    success: boolean;
    summary?: string;
    error?: string;
  }>;

  contextClear: () => Promise<void>;

  contextSummary: () => Promise<{
    customers: number;
    projects: number;
    meetings: number;
    decisions: number;
    patterns: number;
    lastSyncAt?: string;
  }>;

  // Pattern commands
  patternList: () => Promise<{
    patterns: Array<{
      id: string;
      name: string;
      category: string;
      description: string;
      effectiveness?: number;
      usageCount?: number;
    }>;
  }>;

  patternSave: (pattern: {
    name: string;
    category: string;
    description: string;
    prompt: string;
  }) => Promise<{ success: boolean; id?: string; error?: string }>;

  patternApply: (patternId: string, taskDescription: string) => Promise<{
    success: boolean;
    enhancedPrompt?: string;
    error?: string;
  }>;

  patternRate: (patternId: string, success: boolean) => Promise<{ success: boolean; error?: string }>;

  patternRecommend: (description: string, limit?: number) => Promise<{
    success: boolean;
    patterns?: Array<{
      id: string;
      name: string;
      category: string;
      description: string;
      effectiveness?: number;
      usageCount?: number;
      score: number;
      reason: string;
    }>;
    error?: string;
  }>;

  reviewDiff: (options?: { branch?: string; maxFiles?: number }) => Promise<{
    success: boolean;
    review?: {
      results: Array<{
        model: string;
        comments: Array<{
          file: string;
          line?: number;
          severity: "error" | "warning" | "info" | "suggestion";
          message: string;
          suggestion?: string;
        }>;
        summary: string;
        passed: boolean;
        duration: number;
      }>;
      allPassed: boolean;
      totalComments: number;
      errors: number;
      warnings: number;
      suggestions: number;
      summary: string;
      formatted: string;
    };
    error?: string;
  }>;

  // PR commands
  prCreate: (options: { title: string; description?: string; baseBranch?: string; draft?: boolean }) => Promise<{
    success: boolean;
    prNumber?: number;
    prUrl?: string;
    error?: string;
  }>;
  prList: () => Promise<{
    success: boolean;
    prs?: Array<{
      number: number;
      title: string;
      url: string;
      state: string;
      author: string;
    }>;
    error?: string;
  }>;
  prView: (prNumber: number) => Promise<{
    success: boolean;
    pr?: {
      number: number;
      title: string;
      body: string;
      state: string;
      url: string;
      mergeable?: boolean;
    };
    error?: string;
  }>;
  gitStatus: () => Promise<{
    success: boolean;
    branch?: string;
    hasChanges?: boolean;
    staged?: string[];
    modified?: string[];
    untracked?: string[];
    error?: string;
  }>;

  // Workflow commands
  workflowList: () => Promise<{
    success: boolean;
    workflows?: Array<{
      id: string;
      name: string;
      description?: string;
      steps: Array<{ id: string; type: string; command: string; description?: string }>;
      createdAt: number;
      updatedAt: number;
      runCount: number;
      tags?: string[];
    }>;
    error?: string;
  }>;
  workflowCreate: (workflow: {
    name: string;
    description?: string;
    steps: Array<{ id: string; type: string; command: string; description?: string }>;
    tags?: string[];
  }) => Promise<{ success: boolean; id?: string; error?: string }>;
  workflowRun: (name: string) => Promise<{
    success: boolean;
    result?: Array<{ step: { id: string; type: string; command: string; description?: string }; error?: string }>;
    error?: string;
  }>;
  workflowShow: (name: string) => Promise<{
    success: boolean;
    workflow?: {
      id: string;
      name: string;
      description?: string;
      steps: Array<{ id: string; type: string; command: string; description?: string }>;
      createdAt: number;
      updatedAt: number;
      runCount: number;
      tags?: string[];
    };
    error?: string;
  }>;
  workflowDelete: (name: string) => Promise<{ success: boolean; error?: string }>;
}

const api: TerminalAPI = {
  execShell: (command: string) => ipcRenderer.invoke("terminal:exec-shell", command),
  abortShell: (runId: string) => ipcRenderer.invoke("terminal:abort-shell", runId),
  onShellOutput: (callback) => {
    const listener = (_event: unknown, data: unknown) => callback(data as { runId: string; type: string; data: string; exitCode?: number | null });
    ipcRenderer.on("terminal:shell-output", listener);
    return () => {
      ipcRenderer.removeListener("terminal:shell-output", listener);
    };
  },
  getGatewayInfo: () => ipcRenderer.invoke("terminal:get-gateway-info"),
  getGatewayAuthSync: () => {
    try {
      const res = ipcRenderer.sendSync("gateway:get-auth-sync") as unknown;
      if (!res || typeof res !== "object") {
        return null;
      }
      const record = res as Record<string, unknown>;
      const token = typeof record.token === "string" ? record.token : null;
      const port = typeof record.port === "number" ? record.port : null;
      if (!token || !token.trim() || !port || !Number.isFinite(port) || port <= 0) {
        return null;
      }
      return { token: token.trim(), port };
    } catch {
      return null;
    }
  },
  configGet: () => ipcRenderer.invoke("terminal:config-get"),
  configSet: (key, value) => ipcRenderer.invoke("terminal:config-set", key, value),
  configValidate: () => ipcRenderer.invoke("terminal:config-validate"),
  configReset: () => ipcRenderer.invoke("terminal:config-reset"),
  configPath: () => ipcRenderer.invoke("terminal:config-path"),

  // Orchestral commands
  orchestralSpawn: (opts) => ipcRenderer.invoke("terminal:orchestral-spawn", opts),
  orchestralAgents: (action, args) => ipcRenderer.invoke("terminal:orchestral-agents", action, args),
  orchestralTasks: (filters, action) => ipcRenderer.invoke("terminal:orchestral-tasks", filters, action),

  // Agent process management
  agentStart: (opts) => ipcRenderer.invoke("terminal:agent-start", opts),
  agentKill: (taskId) => ipcRenderer.invoke("terminal:agent-kill", taskId),
  agentGetOutput: (taskId, lines) => ipcRenderer.invoke("terminal:agent-get-output", taskId, lines),
  onAgentOutput: (callback) => {
    const listener = (_event: unknown, data: unknown) => callback(data as { taskId: string; type: string; data: string });
    ipcRenderer.on("terminal:agent-output", listener);
    return () => {
      ipcRenderer.removeListener("terminal:agent-output", listener);
    };
  },

  // Context commands
  contextList: () => ipcRenderer.invoke("terminal:context-list"),
  contextSearch: (query) => ipcRenderer.invoke("terminal:context-search", query),
  contextLoad: (vaultPath) => ipcRenderer.invoke("terminal:context-load", vaultPath),
  contextClear: () => ipcRenderer.invoke("terminal:context-clear"),
  contextSummary: () => ipcRenderer.invoke("terminal:context-summary"),

  // Pattern commands
  patternList: () => ipcRenderer.invoke("terminal:pattern-list"),
  patternSave: (pattern) => ipcRenderer.invoke("terminal:pattern-save", pattern),
  patternApply: (patternId, taskDescription) => ipcRenderer.invoke("terminal:pattern-apply", patternId, taskDescription),
  patternRate: (patternId, success) => ipcRenderer.invoke("terminal:pattern-rate", patternId, success),
  patternRecommend: (description, limit) => ipcRenderer.invoke("terminal:pattern-recommend", description, limit),
  reviewDiff: (options) => ipcRenderer.invoke("terminal:review-diff", options),

  // PR commands
  prCreate: (options) => ipcRenderer.invoke("terminal:pr-create", options),
  prList: () => ipcRenderer.invoke("terminal:pr-list"),
  prView: (prNumber) => ipcRenderer.invoke("terminal:pr-view", prNumber),
  gitStatus: () => ipcRenderer.invoke("terminal:git-status"),

  // Workflow commands
  workflowList: () => ipcRenderer.invoke("terminal:workflow-list"),
  workflowCreate: (workflow) => ipcRenderer.invoke("terminal:workflow-create", workflow),
  workflowRun: (name) => ipcRenderer.invoke("terminal:workflow-run", name),
  workflowShow: (name) => ipcRenderer.invoke("terminal:workflow-show", name),
  workflowDelete: (name) => ipcRenderer.invoke("terminal:workflow-delete", name),
};

contextBridge.exposeInMainWorld("terminalAPI", api);
