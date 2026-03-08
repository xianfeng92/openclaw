/**
 * Workflow Service - Store and execute automated command workflows.
 * Workflows are sequences of commands that can be replayed.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveStateDir } from "../config/paths.js";

/**
 * A workflow step.
 */
export interface WorkflowStep {
  id: string;
  type: "command" | "spawn" | "delay" | "confirm";
  command: string; // The command to execute
  description?: string; // Human-readable description
  timeout?: number; // For command execution
}

/**
 * A workflow definition.
 */
export interface Workflow {
  id: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  createdAt: number;
  updatedAt: number;
  runCount: number;
  tags?: string[];
}

/**
 * Workflow execution result.
 */
export interface WorkflowExecutionResult {
  success: boolean;
  completedSteps: number;
  totalSteps: number;
  outputs: string[];
  errors: string[];
  stoppedAt?: string; // Step ID where execution stopped
}

const WORKFows_FILE = "workflows.json";
let workflowsCache: Workflow[] | null = null;

function getWorkflowsPath(): string {
  const stateDir = resolveStateDir();
  return path.join(stateDir, WORKFows_FILE);
}

/**
 * Load all workflows.
 */
export async function loadWorkflows(): Promise<Workflow[]> {
  if (workflowsCache) {
    return workflowsCache;
  }

  const workflowsPath = getWorkflowsPath();

  if (!fs.existsSync(workflowsPath)) {
    workflowsCache = [];
    return [];
  }

  try {
    const content = fs.readFileSync(workflowsPath, "utf-8");
    workflowsCache = JSON.parse(content) as Workflow[];
    return workflowsCache ?? [];
  } catch {
    workflowsCache = [];
    return [];
  }
}

/**
 * Save all workflows.
 */
async function saveWorkflows(workflows: Workflow[]): Promise<void> {
  const workflowsPath = getWorkflowsPath();

  // Ensure directory exists
  const dir = path.dirname(workflowsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(workflowsPath, JSON.stringify(workflows, null, 2));
  workflowsCache = workflows;
}

/**
 * Clear workflows cache.
 */
export function clearWorkflowsCache(): void {
  workflowsCache = null;
}

/**
 * Get a workflow by ID.
 */
export async function getWorkflow(id: string): Promise<Workflow | null> {
  const workflows = await loadWorkflows();
  return workflows.find((w) => w.id === id) || null;
}

/**
 * Get a workflow by name.
 */
export async function getWorkflowByName(name: string): Promise<Workflow | null> {
  const workflows = await loadWorkflows();
  return workflows.find((w) => w.name.toLowerCase() === name.toLowerCase()) || null;
}

/**
 * Create a new workflow.
 */
export async function createWorkflow(workflow: Omit<Workflow, "id" | "createdAt" | "updatedAt" | "runCount">): Promise<Workflow> {
  const workflows = await loadWorkflows();

  const newWorkflow: Workflow = {
    ...workflow,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    runCount: 0,
  };

  workflows.push(newWorkflow);
  await saveWorkflows(workflows);

  return newWorkflow;
}

/**
 * Update a workflow.
 */
export async function updateWorkflow(id: string, updates: Partial<Omit<Workflow, "id" | "createdAt">>): Promise<Workflow | null> {
  const workflows = await loadWorkflows();
  const index = workflows.findIndex((w) => w.id === id);

  if (index === -1) {
    return null;
  }

  workflows[index] = {
    ...workflows[index],
    ...updates,
    id: workflows[index].id,
    createdAt: workflows[index].createdAt,
    updatedAt: Date.now(),
  };

  await saveWorkflows(workflows);
  return workflows[index];
}

/**
 * Delete a workflow.
 */
export async function deleteWorkflow(id: string): Promise<boolean> {
  const workflows = await loadWorkflows();
  const index = workflows.findIndex((w) => w.id === id);

  if (index === -1) {
    return false;
  }

  workflows.splice(index, 1);
  await saveWorkflows(workflows);
  return true;
}

/**
 * List all workflows.
 */
export async function listWorkflows(): Promise<Workflow[]> {
  return await loadWorkflows();
}

/**
 * Execute a workflow (dry run - returns what would be executed).
 * Actual execution happens via terminal commands.
 */
export async function dryRunWorkflow(id: string): Promise<{
  success: boolean;
  workflow?: Workflow;
  steps: Array<{ step: WorkflowStep; description: string }>;
  error?: string;
}> {
  const workflow = await getWorkflow(id);

  if (!workflow) {
    return { success: false, steps: [], error: "Workflow not found" };
  }

  const steps = workflow.steps.map((step) => ({
    step,
    description: getStepDescription(step),
  }));

  return { success: true, workflow, steps };
}

/**
 * Get a human-readable description of a step.
 */
function getStepDescription(step: WorkflowStep): string {
  switch (step.type) {
    case "command":
      return `Execute: ${step.command}`;
    case "spawn":
      return `Spawn agent: ${step.command}`;
    case "delay":
      return `Delay: ${step.command}ms`;
    case "confirm":
      return `Confirm: ${step.command}`;
    default:
      return step.command;
  }
}

/**
 * Increment workflow run count.
 */
export async function incrementWorkflowRunCount(id: string): Promise<void> {
  const workflow = await getWorkflow(id);
  if (workflow) {
    await updateWorkflow(id, { runCount: workflow.runCount + 1 });
  }
}

/**
 * Search workflows by name or tags.
 */
export async function searchWorkflows(query: string): Promise<Workflow[]> {
  const workflows = await loadWorkflows();
  const lowerQuery = query.toLowerCase();

  return workflows.filter((w) =>
    w.name.toLowerCase().includes(lowerQuery) ||
    w.description?.toLowerCase().includes(lowerQuery) ||
    w.tags?.some((t) => t.toLowerCase().includes(lowerQuery))
  );
}

/**
 * Get popular workflows (by run count).
 */
export async function getPopularWorkflows(limit: number = 5): Promise<Workflow[]> {
  const workflows = await loadWorkflows();
  return [...workflows].sort((a, b) => b.runCount - a.runCount).slice(0, limit);
}
