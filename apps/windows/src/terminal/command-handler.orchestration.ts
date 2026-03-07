import { handleTasksCommand } from "./orchestral-commands.js";

type WriteLineFn = (terminal: HTMLElement, text: string) => void;
type WriteHtmlFn = (terminal: HTMLElement, html: string) => void;
type EscapeHtmlFn = (text: string) => string;
type WriteSectionFn = (terminal: HTMLElement, title: string, icon: string) => void;

type CommandRenderDeps = {
  writeLine: WriteLineFn;
  writeHtml: WriteHtmlFn;
  escapeHtml: EscapeHtmlFn;
  writeSection: WriteSectionFn;
};

function hasOrchestralAPI(): boolean {
  return typeof window.terminalAPI?.reviewDiff === "function" ||
         typeof window.terminalAPI?.patternList === "function" ||
         typeof window.terminalAPI?.orchestralSpawn === "function";
}

export async function handleWorkflowCommand(
  terminal: HTMLElement,
  args: string[],
  deps: CommandRenderDeps,
): Promise<void> {
  const action = args[0] || "list";

  switch (action) {
    case "help": {
      deps.writeHtml(terminal, `
<span class="system-ok"><strong>Workflow Commands</strong></span>

<span class="system-info">Usage:</span>
  /workflow list - List all workflows
  /workflow create <name> <step1> [<step2> ...] - Create a workflow
  /workflow run <name> - Execute a workflow
  /workflow show <name> - Show workflow details
  /workflow delete <name> - Delete a workflow

<span class="system-info">Examples:</span>
  /workflow create BuildAndTest pnpm-check pnpm-test
  /workflow run BuildAndTest
  /workflow show BuildAndTest
      `.trim());
      break;
    }

    case "list": {
      deps.writeSection(terminal, "Workflows", "[workflow]");

      if (!hasOrchestralAPI()) {
        deps.writeHtml(terminal, `<span class="system-error">[err] Workflow API not available</span>`);
        break;
      }

      try {
        const result = await window.terminalAPI.workflowList?.();

        if (result?.workflows && result.workflows.length > 0) {
          for (const wf of result.workflows) {
            deps.writeLine(terminal, "");
            deps.writeHtml(terminal, `<span style="color: var(--accent-cyan);">${deps.escapeHtml(wf.name)}</span>`);
            if (wf.description) {
              deps.writeHtml(terminal, `<span style="color: var(--text-muted);">  ${deps.escapeHtml(wf.description)}</span>`);
            }
            deps.writeHtml(terminal, `<span style="color: var(--text-muted);">  Steps: ${wf.steps.length} | Runs: ${wf.runCount}</span>`);
          }
          deps.writeLine(terminal, "");
          deps.writeHtml(terminal, `<span class="system-info">Total: ${result.workflows.length} workflow(s)</span>`);
        } else {
          deps.writeLine(terminal, "No workflows found.");
          deps.writeHtml(terminal, `<span class="system-info">Use /workflow create to create one</span>`);
        }
      } catch (err) {
        console.error("[Workflow] Error:", err);
        deps.writeHtml(terminal, `<span class="system-error">[err] Error: ${deps.escapeHtml(String(err))}</span>`);
      }
      break;
    }

    case "create": {
      const name = args[1];
      if (!name) {
        deps.writeHtml(terminal, `<span class="system-info">Usage: /workflow create &lt;name&gt; &lt;step1&gt; [&lt;step2&gt; ...]</span>`);
        deps.writeLine(terminal, "");
        deps.writeHtml(terminal, `<span class="system-muted">Steps format:</span>`);
        deps.writeHtml(terminal, `<span style="color: var(--text-muted);">  /command - terminal command</span>`);
        deps.writeHtml(terminal, `<span style="color: var(--text-muted);">  /spawn &lt;desc&gt; - spawn agent</span>`);
        deps.writeHtml(terminal, `<span style="color: var(--text-muted);">  /delay &lt;ms&gt; - wait before next step</span>`);
        break;
      }

      const steps = args.slice(2);
      if (steps.length === 0) {
        deps.writeHtml(terminal, `<span class="system-warn">[warn] No steps provided. Workflow will be empty.</span>`);
      }

      deps.writeSection(terminal, "Creating Workflow", "[workflow]");
      deps.writeLine(terminal, `Name: ${name}`);
      deps.writeLine(terminal, `Steps: ${steps.length}`);

      if (!hasOrchestralAPI()) {
        deps.writeHtml(terminal, `<span class="system-error">[err] Workflow API not available</span>`);
        break;
      }

      try {
        const workflowSteps = steps.map((step, i) => {
          if (step.startsWith("/spawn ")) {
            return {
              id: `step-${i}`,
              type: "spawn" as const,
              command: step.slice(7),
              description: `Spawn: ${step.slice(7)}`,
            };
          }
          if (step.startsWith("/delay ")) {
            const ms = parseInt(step.slice(7), 10);
            return {
              id: `step-${i}`,
              type: "delay" as const,
              command: ms.toString(),
              description: `Delay: ${ms}ms`,
              timeout: ms,
            };
          }
          return {
            id: `step-${i}`,
            type: "command" as const,
            command: step.startsWith("/") ? step.slice(1) : step,
            description: `Command: ${step}`,
          };
        });

        const result = await window.terminalAPI.workflowCreate?.({
          name,
          description: "Auto-created workflow",
          steps: workflowSteps,
          tags: ["user-created"],
        });

        if (result?.success) {
          deps.writeHtml(terminal, `<span class="system-ok">[ok] Workflow created: ${result.id}</span>`);
          deps.writeHtml(terminal, `<span class="system-info">Use /workflow run "${name}" to execute</span>`);
        } else {
          deps.writeHtml(terminal, `<span class="system-error">[err] ${result?.error || "Failed to create workflow"}</span>`);
        }
      } catch (err) {
        console.error("[Workflow] Error:", err);
        deps.writeHtml(terminal, `<span class="system-error">[err] Error: ${deps.escapeHtml(String(err))}</span>`);
      }
      break;
    }

    case "run": {
      const name = args[1];
      if (!name) {
        deps.writeHtml(terminal, `<span class="system-info">Usage: /workflow run &lt;name&gt;</span>`);
        break;
      }

      deps.writeSection(terminal, `Running Workflow: ${name}`, "[workflow]");

      if (!hasOrchestralAPI()) {
        deps.writeHtml(terminal, `<span class="system-error">[err] Workflow API not available</span>`);
        break;
      }

      try {
        const result = await window.terminalAPI.workflowRun?.(name);
        const stepResults = result?.result || result?.steps || [];

        if (stepResults.length > 0) {
          deps.writeLine(terminal, "");
          for (const stepResult of stepResults) {
            const commandText =
              stepResult.step?.description || stepResult.step?.command || stepResult.step?.id || "step";
            const ok = !stepResult.error && stepResult.status !== "failed";
            const statusTag = ok
              ? `<span class="system-ok">[ok]</span>`
              : `<span class="system-error">[err]</span>`;
            deps.writeHtml(
              terminal,
              `<span style="color: var(--text-muted);">  ${statusTag} ${deps.escapeHtml(commandText)}</span>`,
            );
            if (stepResult.taskId) {
              deps.writeHtml(
                terminal,
                `<span style="color: var(--text-muted);">    task: ${deps.escapeHtml(stepResult.taskId)}</span>`,
              );
            }
            if (stepResult.output) {
              deps.writeHtml(
                terminal,
                `<span style="color: var(--text-muted);">    output: ${deps.escapeHtml(stepResult.output)}</span>`,
              );
            }
            if (stepResult.error) {
              deps.writeHtml(
                terminal,
                `<span class="system-error">    failed: ${deps.escapeHtml(stepResult.error)}</span>`,
              );
            }
          }
          deps.writeLine(terminal, "");
          const summary = `${result?.completedSteps ?? stepResults.length}/${result?.totalSteps ?? stepResults.length}`;
          if (result?.success) {
            deps.writeHtml(terminal, `<span class="system-ok">[ok] Workflow completed (${summary} steps)</span>`);
          } else {
            deps.writeHtml(
              terminal,
              `<span class="system-error">[err] Workflow failed (${summary} steps): ${deps.escapeHtml(result?.error || "Unknown error")}</span>`,
            );
          }
        } else if (result?.success) {
          deps.writeHtml(terminal, `<span class="system-ok">[ok] Workflow completed (no steps)</span>`);
        } else {
          deps.writeHtml(terminal, `<span class="system-error">[err] ${result?.error || "Workflow not found"}</span>`);
        }
      } catch (err) {
        console.error("[Workflow] Error:", err);
        deps.writeHtml(terminal, `<span class="system-error">[err] Error: ${deps.escapeHtml(String(err))}</span>`);
      }
      break;
    }

    case "show": {
      const name = args[1];
      if (!name) {
        deps.writeHtml(terminal, `<span class="system-info">Usage: /workflow show &lt;name&gt;</span>`);
        break;
      }

      deps.writeSection(terminal, `Workflow: ${name}`, "[workflow]");

      if (!hasOrchestralAPI()) {
        deps.writeHtml(terminal, `<span class="system-error">[err] Workflow API not available</span>`);
        break;
      }

      try {
        const result = await window.terminalAPI.workflowShow?.(name);

        if (result?.workflow) {
          const { workflow } = result;
          deps.writeLine(terminal, "");
          if (workflow.description) {
            deps.writeLine(terminal, workflow.description);
          }
          deps.writeLine(terminal, "");
          deps.writeHtml(terminal, `<span style="color: var(--accent-cyan);">Steps:</span>`);
          for (const step of workflow.steps) {
            deps.writeHtml(terminal, `<span style="color: var(--text-primary);">  ${step.id}: ${deps.escapeHtml(step.description || step.command)}</span>`);
          }
          deps.writeLine(terminal, "");
          deps.writeHtml(terminal, `<span style="color: var(--text-muted);">Runs: ${workflow.runCount} | Created: ${new Date(workflow.createdAt).toLocaleDateString()}</span>`);
        } else {
          deps.writeHtml(terminal, `<span class="system-error">[err] Workflow not found</span>`);
        }
      } catch (err) {
        console.error("[Workflow] Error:", err);
        deps.writeHtml(terminal, `<span class="system-error">[err] Error: ${deps.escapeHtml(String(err))}</span>`);
      }
      break;
    }

    case "delete": {
      const name = args[1];
      if (!name) {
        deps.writeHtml(terminal, `<span class="system-info">Usage: /workflow delete &lt;name&gt;</span>`);
        break;
      }

      if (!hasOrchestralAPI()) {
        deps.writeHtml(terminal, `<span class="system-error">[err] Workflow API not available</span>`);
        break;
      }

      try {
        const result = await window.terminalAPI.workflowDelete?.(name);

        if (result?.success) {
          deps.writeHtml(terminal, `<span class="system-ok">[ok] Workflow deleted: ${name}</span>`);
        } else {
          deps.writeHtml(terminal, `<span class="system-error">[err] ${result?.error || "Failed to delete workflow"}</span>`);
        }
      } catch (err) {
        console.error("[Workflow] Error:", err);
        deps.writeHtml(terminal, `<span class="system-error">[err] Error: ${deps.escapeHtml(String(err))}</span>`);
      }
      break;
    }

    default: {
      deps.writeHtml(terminal, `<span class="system-info">Usage: /workflow [help|list|create|run|show|delete]</span>`);
    }
  }
}

export async function handleTaskCommand(
  terminal: HTMLElement,
  args: string[],
  deps: CommandRenderDeps,
): Promise<void> {
  const action = args[0] || "list";

  switch (action) {
    case "complete": {
      const taskId = args[1];
      const statusArg = args[2]?.toLowerCase();
      const success =
        statusArg === undefined || statusArg === "success"
          ? true
          : statusArg === "fail" || statusArg === "failed"
            ? false
            : null;
      const patternId = args[3];

      if (!taskId || success === null) {
        deps.writeHtml(terminal, `<span class="system-info">Usage: /task complete &lt;task-id&gt; [success|fail] [pattern-id]</span>`);
        deps.writeLine(terminal, "");
        deps.writeHtml(
          terminal,
          `<span class="system-muted">Defaults to success when status is omitted. Also updates pattern effectiveness.</span>`,
        );
        return;
      }

      deps.writeLine(terminal, `Completing task ${taskId} as ${success ? "successful" : "failed"}...`);

      try {
        if (patternId) {
          const rateResult = await window.terminalAPI.patternRate?.(patternId, success);
          if (rateResult?.success) {
            deps.writeHtml(terminal, `<span class="system-ok">[ok] Pattern effectiveness updated</span>`);
          } else {
            deps.writeHtml(terminal, `<span class="system-warn">[warn] Could not rate pattern: ${rateResult.error || "Unknown"}</span>`);
          }
        }

        const result = await window.terminalAPI.orchestralTasks?.(
          {
            taskId,
            success: success ? "true" : "false",
          },
          "complete",
        );

        if (!result?.success) {
          deps.writeHtml(
            terminal,
            `<span class="system-error">[err] Failed to update task: ${deps.escapeHtml(result?.error || "Unknown error")}</span>`,
          );
          return;
        }

        const status = success ? "completed" : "failed";
        deps.writeHtml(terminal, `<span class="system-ok">[ok] Task ${taskId} marked as ${status}</span>`);
      } catch (err) {
        deps.writeHtml(terminal, `<span class='system-error'>Error: ${deps.escapeHtml(String(err))}</span>`);
      }
      break;
    }

    case "list": {
      await handleTasksCommand(terminal, [], deps.writeLine, deps.writeHtml);
      break;
    }

    case "status": {
      const taskId = args[1];
      if (!taskId) {
        deps.writeHtml(terminal, `<span class="system-info">Usage: /task status &lt;task-id&gt;</span>`);
        return;
      }

      try {
        const result = await window.terminalAPI.orchestralTasks?.({});
        if (!result?.success || !Array.isArray(result.tasks)) {
          deps.writeHtml(
            terminal,
            `<span class="system-error">[err] Failed to load tasks: ${deps.escapeHtml(result?.error || "Unknown error")}</span>`,
          );
          return;
        }

        const task = result.tasks.find((entry: { id?: string }) => entry.id === taskId) as
          | {
              id: string;
              status: string;
              description?: string;
              agent?: string;
              startedAt?: number;
              completedAt?: number;
              exitCode?: number | null;
              failureReason?: string;
            }
          | undefined;

        if (!task) {
          deps.writeHtml(terminal, `<span class="system-warn">[warn] Task not found: ${deps.escapeHtml(taskId)}</span>`);
          return;
        }

        deps.writeHtml(terminal, `<span class="system-ok"><strong>Task ${deps.escapeHtml(task.id)}</strong></span>`);
        deps.writeHtml(terminal, `<span class="system-info">Status: ${deps.escapeHtml(task.status)}</span>`);
        if (task.description) {
          deps.writeHtml(terminal, `<span class="system-info">Description: ${deps.escapeHtml(task.description)}</span>`);
        }
        if (task.agent) {
          deps.writeHtml(terminal, `<span class="system-info">Agent: ${deps.escapeHtml(task.agent)}</span>`);
        }
        if (typeof task.startedAt === "number") {
          deps.writeHtml(
            terminal,
            `<span class="system-info">Started: ${deps.escapeHtml(new Date(task.startedAt).toLocaleString())}</span>`,
          );
        }
        if (typeof task.completedAt === "number") {
          deps.writeHtml(
            terminal,
            `<span class="system-info">Completed: ${deps.escapeHtml(new Date(task.completedAt).toLocaleString())}</span>`,
          );
        }
        if (typeof task.exitCode === "number") {
          deps.writeHtml(terminal, `<span class="system-info">Exit Code: ${task.exitCode}</span>`);
        }
        if (task.failureReason) {
          deps.writeHtml(terminal, `<span class="system-warn">Reason: ${deps.escapeHtml(task.failureReason)}</span>`);
        }
      } catch (err) {
        deps.writeHtml(terminal, `<span class='system-error'>Error: ${deps.escapeHtml(String(err))}</span>`);
      }
      break;
    }

    case "help": {
      deps.writeHtml(terminal, `
<span class="system-ok"><strong>Task Commands</strong></span>

<span class="system-info">Usage:</span>
  /task complete &lt;task-id&gt; [success|fail] [pattern-id]
      Mark task as complete and update pattern effectiveness
  /task list                   - Show all tasks
  /task status &lt;task-id&gt;       - Show task status

<span class="system-info">Examples:</span>
  /task complete task-123 success
  /task complete task-123 success pattern-456
      `.trim());
      break;
    }

    default:
      deps.writeHtml(terminal, `<span class="system-info">Usage: /task [complete|list|status|help]</span>`);
      break;
  }
}
