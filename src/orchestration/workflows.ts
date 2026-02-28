/**
 * Workflows system - Parameterized command templates
 * Allows defining reusable command templates with parameters
 */

import fs from "node:fs/promises";
import path from "node:path";

export type WorkflowParameterType = "input" | "choice";

export interface WorkflowParameter {
  name: string;
  type: WorkflowParameterType;
  default?: string;
  description?: string;
  options?: string[];
}

export interface Workflow {
  name: string;
  description: string;
  template: string;
  parameters?: WorkflowParameter[];
  shortcuts?: string[];
}

export interface WorkflowConfig {
  workflows?: Workflow[];
}

export interface WorkflowExecuteResult {
  success: boolean;
  command?: string;
  error?: string;
}

const WORKFLOWS_DIR = ".openclaw/workflows";
const WORKFLOWS_FILE = "workflows.yaml";

/**
 * Parse a workflow YAML file
 * Format:
 *   name: workflow-name
 *   description: Description text
 *   template: command template with {{param}} placeholders
 *   parameters:
 *     - name: param1
 *       type: input|choice
 *       default: default-value
 *       options: [opt1, opt2]  # for choice type
 */
async function parseWorkflowFile(filePath: string): Promise<Workflow | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");

    // Simple YAML parser (for basic workflow definitions)
    const lines = content.split("\n");
    const workflow: Partial<Workflow> = {
      name: "",
      description: "",
      template: "",
    };
    const parameters: WorkflowParameter[] = [];

    let inParameters = false;
    let currentParam: Partial<WorkflowParameter> | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const colonIndex = trimmed.indexOf(":");
      if (colonIndex === -1) continue;

      const key = trimmed.slice(0, colonIndex).trim();
      let value = trimmed.slice(colonIndex + 1).trim();

      // Handle list items in parameters section (e.g., "- name: env")
      if (trimmed.startsWith("- ")) {
        const itemContent = trimmed.slice(2).trim();
        const itemColonIndex = itemContent.indexOf(":");
        if (itemColonIndex !== -1) {
          const itemKey = itemContent.slice(0, itemColonIndex).trim();
          const itemValue = itemContent.slice(itemColonIndex + 1).trim();

          if (itemKey === "name") {
            // Save previous parameter if exists
            if (currentParam?.name) {
              parameters.push(currentParam as WorkflowParameter);
            }
            currentParam = { name: itemValue };
            inParameters = true;
          }
        }
        continue;
      }

      // Handle parameter properties that are on separate lines (e.g., "  type: choice")
      if (inParameters && currentParam) {
        if (key === "type") {
          currentParam.type = value as WorkflowParameterType;
        } else if (key === "default") {
          currentParam.default = value;
        } else if (key === "options") {
          // Parse options like [dev, staging, production]
          const optsMatch = value.match(/\[(.*?)\]/);
          if (optsMatch) {
            currentParam.options = optsMatch[1].split(",").map(o => o.trim());
          }
        } else if (key === "description") {
          currentParam.description = value;
        }
        // Skip 'name' key in parameters section as it's handled above
        continue;
      }

      // Top-level keys
      if (!inParameters) {
        if (key === "name") {
          workflow.name = value;
        } else if (key === "description") {
          workflow.description = value;
        } else if (key === "template") {
          workflow.template = value;
        } else if (key === "parameters") {
          inParameters = true;
        } else if (key === "shortcuts") {
          workflow.shortcuts = value.split(",").map(s => s.trim()).filter(Boolean);
        }
      }
    }

    // Don't forget the last parameter
    if (currentParam?.name) {
      parameters.push(currentParam as WorkflowParameter);
    }

    if (workflow.name && workflow.template) {
      workflow.parameters = parameters.length > 0 ? parameters : undefined;
      return workflow as Workflow;
    }

    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Load all workflows from .openclaw/workflows/
 */
export async function loadWorkflows(workspaceDir?: string): Promise<Map<string, Workflow>> {
  const workflowsDir = workspaceDir
    ? path.join(workspaceDir, WORKFLOWS_DIR)
    : path.join(process.cwd(), WORKFLOWS_DIR);

  const result = new Map<string, Workflow>();

  try {
    await fs.mkdir(workflowsDir, { recursive: true });
  } catch {
    // Directory already exists or created
  }

  // Find all YAML files in workflows directory
  let entries: string[] = [];
  try {
    entries = await fs.readdir(workflowsDir);
  } catch {
    // Directory doesn't exist or can't be read
    return result;
  }

  const yamlFiles = entries.filter((file) => file.endsWith(".yaml"));

  for (const file of yamlFiles) {
    const filePath = path.join(workflowsDir, file);
    const workflow = await parseWorkflowFile(filePath);
    if (workflow) {
      result.set(workflow.name, workflow);
    }
  }

  return result;
}

/**
 * Execute a workflow with given parameters
 */
export async function executeWorkflow(
  workflowName: string,
  params?: Record<string, string>,
  workspaceDir?: string,
): Promise<WorkflowExecuteResult> {
  const workflows = await loadWorkflows(workspaceDir);
  const workflow = workflows.get(workflowName);

  if (!workflow) {
    return {
      success: false,
      error: `Workflow "${workflowName}" not found`,
    };
  }

  let command = workflow.template;

  // Replace parameters in template
  if (workflow.parameters) {
    for (const param of workflow.parameters) {
      const value = params?.[param.name] ?? param.default ?? "";
      command = command.replace(new RegExp(`{{${param.name}}}`, "g"), value);
      command = command.replace(new RegExp(`{{${param.name}:([^}]+)}}`, "g"), value);
    }
  }

  // Replace remaining {{param}} placeholders with empty string
  command = command.replace(/\{\{[^}]*\}\}/g, "");

  return {
    success: true,
    command: command.trim(),
  };
}

/**
 * Get list of available workflow names
 */
export async function listWorkflowNames(workspaceDir?: string): Promise<string[]> {
  const workflows = await loadWorkflows(workspaceDir);
  return Array.from(workflows.keys());
}

/**
 * Complete workflow name from partial input
 */
export async function completeWorkflowName(
  partial: string,
  workspaceDir?: string,
): Promise<string[]> {
  const names = await listWorkflowNames(workspaceDir);
  const partialLower = partial.toLowerCase();

  return names.filter((name) =>
    name.toLowerCase().includes(partialLower) ||
    partialLower.includes(name.toLowerCase()),
  );
}
