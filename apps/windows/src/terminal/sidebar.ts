/**
 * Sidebar component for OpenClaw Terminal
 * Displays Tasks, Agents, and Context panels with real-time updates
 */

declare global {
  interface Window {
    terminalAPI?: {
      orchestralTasks?: (filters: Record<string, string>) => Promise<{
        tasks?: Array<{
          id: string;
          description: string;
          status: string;
          agent: string;
          startedAt: number;
          completedAt?: number;
          tmuxSession?: string;
          branch?: string;
        }>;
        summary?: string;
      }>;
      orchestralAgents?: (action: string, args: string[]) => Promise<{
        tasks?: Array<{
          id: string;
          description: string;
          status: string;
          agent: string;
          startedAt: number;
          tmuxSession?: string;
          branch?: string;
        }>;
      }>;
    };
  }
}

interface TaskInfo {
  id: string;
  description: string;
  status: "running" | "completed" | "failed" | "pending" | "stopped";
  agent: string;
  startedAt: number;
  completedAt?: number;
  tmuxSession?: string;
  branch?: string;
}

interface AgentInfo {
  id: string;
  description: string;
  agent: string;
  startedAt: number;
  tmuxSession?: string;
  branch?: string;
}

interface ContextItem {
  id: string;
  name: string;
  type: "customer" | "project" | "meeting" | "decision" | "pattern";
  snippet?: string;
}

// State
let isCollapsed = false;
let tasks: TaskInfo[] = [];
let agents: AgentInfo[] = [];
let contexts: ContextItem[] = [];
let refreshInterval: ReturnType<typeof setInterval> | null = null;
let hideCompletedTasks = false; // Local filter to hide completed tasks from sidebar

// DOM Elements
let sidebarEl: HTMLElement | null = null;
let tasksListEl: HTMLElement | null = null;
let agentsListEl: HTMLElement | null = null;
let contextListEl: HTMLElement | null = null;
let tasksCountEl: HTMLElement | null = null;
let agentsCountEl: HTMLElement | null = null;
let contextCountEl: HTMLElement | null = null;
let statusTasksEl: HTMLElement | null = null;

/**
 * Initialize the sidebar
 */
export function initSidebar(): void {
  sidebarEl = document.getElementById("sidebar");
  tasksListEl = document.getElementById("tasks-list");
  agentsListEl = document.getElementById("agents-list");
  contextListEl = document.getElementById("context-list");
  tasksCountEl = document.getElementById("tasks-count");
  agentsCountEl = document.getElementById("agents-count");
  contextCountEl = document.getElementById("context-count");
  statusTasksEl = document.getElementById("status-tasks");

  // Set panel icons using Nerd Font
  const tasksIconEl = document.querySelector("#panel-tasks .sidebar-panel-icon");
  const agentsIconEl = document.querySelector("#panel-agents .sidebar-panel-icon");
  const contextIconEl = document.querySelector("#panel-context .sidebar-panel-icon");

  if (tasksIconEl) tasksIconEl.textContent = ""; // Nerd Font
  if (agentsIconEl) agentsIconEl.textContent = ""; // Nerd Font
  if (contextIconEl) contextIconEl.textContent = ""; // Nerd Font

  setupPanelToggle();
  setupSidebarCollapse();
  setupActionButtons();

  // Initial data load
  refreshData();

  // Set up auto-refresh every 10 seconds
  refreshInterval = setInterval(refreshData, 10000);
}

/**
 * Set up panel collapse/expand functionality
 */
function setupPanelToggle(): void {
  const panelHeaders = document.querySelectorAll(".sidebar-panel-header");
  panelHeaders.forEach((header) => {
    header.addEventListener("click", () => {
      const panel = header.closest(".sidebar-panel") as HTMLElement;
      if (panel) {
        panel.classList.toggle("open");
      }
    });
  });
}

/**
 * Set up sidebar collapse/expand
 */
function setupSidebarCollapse(): void {
  const collapseBtn = document.getElementById("sidebar-collapse");
  const expandBtn = document.getElementById("sidebar-expand");

  collapseBtn?.addEventListener("click", () => {
    sidebarEl?.classList.add("collapsed");
    isCollapsed = true;
  });

  expandBtn?.addEventListener("click", () => {
    sidebarEl?.classList.remove("collapsed");
    isCollapsed = false;
  });
}

/**
 * Set up action buttons
 */
function setupActionButtons(): void {
  const spawnBtn = document.getElementById("btn-spawn");
  const refreshBtn = document.getElementById("btn-refresh");

  spawnBtn?.addEventListener("click", () => {
    // Focus on terminal input and type /spawn
    const input = document.getElementById("input") as HTMLInputElement;
    if (input) {
      input.focus();
      input.value = "/spawn ";
      input.dispatchEvent(new Event("input"));
    }
  });

  refreshBtn?.addEventListener("click", () => {
    refreshData();
  });
}

/**
 * Refresh all data from the backend
 */
async function refreshData(): Promise<void> {
  await Promise.all([refreshTasks(), refreshAgents(), refreshContext()]);
}

/**
 * Refresh tasks list
 */
export async function refreshTasks(): Promise<void> {
  try {
    const result = await window.terminalAPI?.orchestralTasks?.({});
    // Always update tasks array - if result or tasks is missing, treat as empty
    tasks = result?.tasks ?? [];
    renderTasks();
    updateTasksCount();
  } catch (err) {
    console.error("[Sidebar] Failed to refresh tasks:", err);
    // On error, show empty state
    tasks = [];
    renderTasks();
    updateTasksCount();
  }
}

/**
 * Refresh agents list
 */
export async function refreshAgents(): Promise<void> {
  try {
    const result = await window.terminalAPI?.orchestralAgents?.("list", []);
    // Always update agents array - if result or tasks is missing, treat as empty
    agents = result?.tasks ?? [];
    renderAgents();
    updateAgentsCount();
  } catch (err) {
    console.error("[Sidebar] Failed to refresh agents:", err);
    // On error, show empty state
    agents = [];
    renderAgents();
    updateAgentsCount();
  }
}

/**
 * Refresh context list
 */
async function refreshContext(): Promise<void> {
  try {
    const result = await window.terminalAPI?.contextList?.();
    if (result) {
      // Convert API result to ContextItem format
      const contextItems: ContextItem[] = [];

      // Add customers
      if (result.customers && Array.isArray(result.customers)) {
        for (const customer of result.customers.slice(0, 5)) {
          contextItems.push({
            id: customer.id,
            name: customer.name,
            type: "customer",
          });
        }
      }

      // Add projects
      if (result.projects && Array.isArray(result.projects)) {
        for (const project of result.projects.slice(0, 5)) {
          contextItems.push({
            id: project.id,
            name: project.name,
            type: "project",
          });
        }
      }

      // Add decisions
      if (result.decisions && Array.isArray(result.decisions)) {
        for (const decision of result.decisions.slice(0, 3)) {
          contextItems.push({
            id: decision.id,
            name: decision.title,
            type: "decision",
          });
        }
      }

      contexts = contextItems;
      renderContexts(contextItems);
      updateContextCount();
    }
  } catch (err) {
    console.error("[Sidebar] Failed to refresh context:", err);
  }
}

/**
 * Update context count display
 */
function updateContextCount(): void {
  if (contextCountEl) {
    contextCountEl.textContent = String(contexts.length);
  }
}

/**
 * Update tasks count display
 */
function updateTasksCount(): void {
  const runningCount = tasks.filter((t) => t.status === "running").length;
  tasksCountEl!.textContent = String(runningCount);
  if (statusTasksEl) {
    statusTasksEl.textContent = `[Tasks: ${runningCount}]`;
  }
}

/**
 * Update agents count display
 */
function updateAgentsCount(): void {
  // Count only running agents
  const runningCount = agents.filter((a) => a.status === "running" || !a.status).length;
  agentsCountEl!.textContent = String(runningCount);
}

/**
 * Render tasks list
 */
function renderTasks(): void {
  if (!tasksListEl) return;

  // Filter tasks based on hideCompletedTasks setting
  let displayTasks = tasks;
  if (hideCompletedTasks) {
    displayTasks = tasks.filter((t) => t.status === "running");
  }

  if (displayTasks.length === 0) {
    const emptyMsg = hideCompletedTasks
      ? "No active tasks (completed tasks hidden)"
      : "No tasks yet";
    tasksListEl.innerHTML = `
      <div class="sidebar-empty">
        <div class="sidebar-empty-icon"></div>
        ${emptyMsg}
      </div>
    `;
    return;
  }

  // Sort: running first, then by start time (newest first)
  const sorted = [...displayTasks].sort((a, b) => {
    if (a.status === "running" && b.status !== "running") return -1;
    if (a.status !== "running" && b.status === "running") return 1;
    return b.startedAt - a.startedAt;
  });

  tasksListEl.innerHTML = sorted
    .slice(0, 20) // Show max 20 tasks
    .map((task) => renderTaskItem(task))
    .join("");
}

/**
 * Render a single task item
 */
function renderTaskItem(task: TaskInfo): string {
  const statusClass = task.status;
  const agentIcon = getAgentIcon(task.agent);
  const timeAgo = formatTimeAgo(task.startedAt);
  const shortId = task.id.split("-").pop() || task.id.slice(-8);
  const shortDesc = truncateDescription(task.description, 40);

  // TUI ASCII state indicator
  const statusIcon = task.status === "running" ? "[●]" : "[○]";

  return `
    <div class="sidebar-item" data-task-id="${task.id}" title="${escapeHtml(task.description)}">
      <span class="sidebar-item-status ${statusClass}">${statusIcon}</span>
      <span>${escapeHtml(shortDesc)}</span>
      <div class="sidebar-item-meta">
        ${agentIcon} ${shortId} • ${timeAgo}
      </div>
    </div>
  `;
}

/**
 * Render agents list
 */
function renderAgents(): void {
  if (!agentsListEl) return;

  // Filter to only show running agents
  const runningAgents = agents.filter((a) => a.status === "running" || !a.status);

  if (runningAgents.length === 0) {
    agentsListEl.innerHTML = `
      <div class="sidebar-empty">
        <div class="sidebar-empty-icon"></div>
        No agents running
      </div>
    `;
    return;
  }

  agentsListEl.innerHTML = runningAgents.map((agent) => renderAgentItem(agent)).join("");
}

/**
 * Render a single agent item
 */
function renderAgentItem(agent: AgentInfo): string {
  const agentIcon = getAgentIcon(agent.agent);
  const timeAgo = formatTimeAgo(agent.startedAt);
  const shortId = agent.id.split("-").pop() || agent.id.slice(-8);
  const shortDesc = truncateDescription(agent.description, 35);

  // TUI ASCII state indicator - agents are always running when shown
  const statusIcon = "[●]";

  return `
    <div class="sidebar-item" data-agent-id="${agent.id}" title="${escapeHtml(agent.description)}">
      <span class="sidebar-item-status running">${statusIcon}</span>
      <span>${escapeHtml(shortDesc)}</span>
      <div class="sidebar-item-meta">
        ${agentIcon} ${shortId} • ${timeAgo}
      </div>
    </div>
  `;
}

/**
 * Render context list
 */
export function renderContexts(contextItems: ContextItem[]): void {
  contexts = contextItems;
  if (!contextListEl) return;

  if (contextItems.length === 0) {
    contextListEl.innerHTML = `
      <div class="sidebar-empty">
        <div class="sidebar-empty-icon"></div>
        No context loaded
      </div>
    `;
    return;
  }

  contextListEl.innerHTML = contextItems.map((ctx) => renderContextItem(ctx)).join("");
}

/**
 * Render a single context item
 */
function renderContextItem(ctx: ContextItem): string {
  const icon = getContextIcon(ctx.type);
  const snippet = ctx.snippet ? truncateDescription(ctx.snippet, 50) : "";

  return `
    <div class="sidebar-item" data-context-id="${ctx.id}" title="${escapeHtml(snippet)}">
      <span>${icon}</span>
      <span>${escapeHtml(ctx.name)}</span>
    </div>
  `;
}

/**
 * Get agent icon (Nerd Font)
 */
function getAgentIcon(agent: string): string {
  const lower = agent.toLowerCase();
  if (lower.includes("claude")) return ""; //  or use Nerd Font: ""
  if (lower.includes("codex")) return "";
  if (lower.includes("gemini")) return "";
  return "";
}

/**
 * Get context icon (Nerd Font)
 */
function getContextIcon(type: ContextItem["type"]): string {
  switch (type) {
    case "customer":
      return ""; // Nerd Font  or similar
    case "project":
      return ""; // Nerd Font
    case "meeting":
      return ""; // Nerd Font
    case "decision":
      return ""; // Nerd Font
    case "pattern":
      return ""; // Nerd Font
    default:
      return ""; // Nerd Font
  }
}

/**
 * Get panel icon (Nerd Font)
 */
function getPanelIcon(panelType: "tasks" | "agents" | "context"): string {
  switch (panelType) {
    case "tasks":
      return ""; // Nerd Font
    case "agents":
      return ""; // Nerd Font
    case "context":
      return ""; // Nerd Font
    default:
      return "";
  }
}

/**
 * Format time ago
 */
function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Truncate description
 */
function truncateDescription(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

/**
 * Escape HTML
 */
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Toggle sidebar
 */
export function toggleSidebar(): void {
  if (isCollapsed) {
    sidebarEl?.classList.remove("collapsed");
  } else {
    sidebarEl?.classList.add("collapsed");
  }
  isCollapsed = !isCollapsed;
}

/**
 * Update a single task (for real-time updates)
 */
export function updateTask(task: TaskInfo): void {
  const index = tasks.findIndex((t) => t.id === task.id);
  if (index >= 0) {
    tasks[index] = task;
  } else {
    tasks.unshift(task);
  }
  renderTasks();
  updateTasksCount();
}

/**
 * Toggle visibility of completed tasks in sidebar
 */
export function toggleCompletedTasksVisibility(): void {
  hideCompletedTasks = !hideCompletedTasks;
  renderTasks();
  updateTasksCount();
}

/**
 * Show all tasks (including completed)
 */
export function showAllTasks(): void {
  hideCompletedTasks = false;
  renderTasks();
  updateTasksCount();
}

/**
 * Hide completed tasks from sidebar
 */
export function setHideCompletedTasks(): void {
  hideCompletedTasks = true;
  renderTasks();
  updateTasksCount();
}

/**
 * Clean up
 */
export function destroySidebar(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}
