/**
 * Orchestral command handlers for OpenClaw Super Terminal.
 * Integrates with the orchestration system via IPC.
 */
import { formatContextForDisplay, generateContextSummary, type PromptContext } from "./prompt-injection.js";
import {
  refreshAgents as refreshSidebarAgents,
  refreshTasks as refreshSidebarTasks,
  toggleCompletedTasksVisibility,
  showAllTasks,
  setHideCompletedTasks,
} from "./sidebar.js";

type WriteLineFn = (terminal: HTMLElement, text: string) => void;
type WriteHtmlFn = (terminal: HTMLElement, html: string) => void;

// Helper to escape HTML
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Helper to write styled section
function writeSection(terminal: HTMLElement, title: string, icon = "[i]", writeHtml: WriteHtmlFn): void {
  writeHtml(
    terminal,
    `<span style="color: var(--accent-cyan); font-weight: bold;">${icon} ${title}</span>`,
  );
}

// Check if orchestral API is available
function hasOrchestralAPI(): boolean {
  return typeof window.terminalAPI?.orchestralSpawn === "function";
}

// Show orchestral help
function showOrchestralHelp(terminal: HTMLElement, writeHtml: WriteHtmlFn): void {
  if (!hasOrchestralAPI()) {
    writeHtml(
      terminal,
      `<span class="system-warn">[warn] Orchestral commands not available. Update to the latest version.</span>`,
    );
    return;
  }

  writeHtml(terminal, `
<span style="font-weight: bold; color: var(--accent-prompt);">
╔═══════════════════════════════════════════════════════════╗
║              Orchestral Commands                            ║
╚═══════════════════════════════════════════════════════════╝
</span>

<span style="font-weight: bold; color: var(--accent-cyan);">Task Management:</span>
  /spawn &lt;description&gt; [--agent &lt;type&gt;] [--branch &lt;name&gt;] [--code] [--no-context]
      Spawn a new agent task in an isolated environment
      --code: Automatically open VS Code after task creation (default: off)

  /tasks [--status &lt;running|completed|failed&gt;] [--agent &lt;type&gt;]
      List tasks with optional filters

  /tasks clear
      Hide completed tasks from sidebar (local cache)

  /tasks show [--all]
      Show all tasks or only active tasks in sidebar

<span style="font-weight: bold; color: var(--accent-cyan);">Agent Management:</span>
  /agents list
      List all running agents

  /agents kill &lt;task-id&gt; | --all
      Terminate a running agent task (or all agents)

  /agents attach &lt;task-id&gt;
      Show command to attach to an agent's session

  /agents redirect &lt;task-id&gt; &lt;message&gt;
      Send a message to redirect an agent

  /agents output &lt;task-id&gt; [lines]
      Show recent output from an agent's session

  /agents watch &lt;task-id&gt;
      Stream real-time output from an agent

<span style="font-weight: bold; color: var(--accent-cyan);">Examples:</span>
  /spawn "Add user authentication"
  /spawn "Fix login bug" --agent codex
  /agents list
  /tasks --status running
  /agents kill task-20250225-001
  /agents kill --all
`);
}

// Handle /spawn command
export async function handleSpawnCommand(
  terminal: HTMLElement,
  args: string[],
  writeLine: WriteLineFn,
  writeHtml: WriteHtmlFn,
): Promise<void> {
  if (!hasOrchestralAPI()) {
    writeHtml(
      terminal,
      `<span class="system-warn">[warn] Orchestral API not available</span>`,
    );
    return;
  }

  if (args.length === 0) {
    writeHtml(terminal, `<span class="system-info">Usage: /spawn &lt;description&gt; [--agent &lt;claude|codex|gemini&gt;] [--branch &lt;name&gt;] [--code] [--no-context]</span>`);
    return;
  }

  // Parse arguments
  const description: string[] = [];
  let agent: string | undefined;
  let branch: string | undefined;
  let openVsCode = false;
  let useContext = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--agent" && i + 1 < args.length) {
      agent = args[++i];
    } else if (arg === "--branch" && i + 1 < args.length) {
      branch = args[++i];
    } else if (arg === "--code") {
      openVsCode = true;
    } else if (arg === "--no-code") {
      openVsCode = false;
    } else if (arg === "--no-context") {
      useContext = false;
    } else {
      description.push(arg);
    }
  }

  const desc = description.join(" ");
  if (!desc) {
    writeHtml(terminal, `<span class="system-error">Error: Description is required</span>`);
    return;
  }

  writeSection(terminal, "Creating Task", "[spawn]", writeHtml);
  writeLine(terminal, `Description: ${desc}`);
  if (agent) writeLine(terminal, `Agent: ${agent}`);
  if (branch) writeLine(terminal, `Branch: ${branch}`);
  if (openVsCode) writeLine(terminal, `VS Code: auto-open enabled`);

  // Fetch and display relevant context
  let relevantContext: any = null;
  if (useContext) {
    try {
      writeLine(terminal, "");
      writeHtml(terminal, `<span style="color: var(--accent-cyan);">[context]</span> Searching for relevant context...`);

      const contextResult = await window.terminalAPI.contextSearch?.(desc);

      if (contextResult) {
        const hasContext =
          (contextResult.customers?.length ?? 0) > 0 ||
          (contextResult.projects?.length ?? 0) > 0 ||
          (contextResult.decisions?.length ?? 0) > 0 ||
          (contextResult.meetings?.length ?? 0) > 0;

        if (hasContext) {
          relevantContext = contextResult;

          // Build PromptContext for display
          const promptContext: PromptContext = {
            description: desc,
            customers: contextResult.customers || [],
            projects: contextResult.projects || [],
            decisions: contextResult.decisions || [],
          };

          // Use formatted display
          const contextLines = formatContextForDisplay(promptContext);
          for (const line of contextLines) {
            writeHtml(terminal, `<span style="color: var(--text-muted);">  ${line}</span>`);
          }

          const summary = generateContextSummary(promptContext);
          writeHtml(terminal, `<span class="system-info">  Context: ${summary}</span>`);
          writeHtml(terminal, `<span class="system-info">  Context will be injected into agent prompt</span>`);

          // Get smart pattern recommendations
          try {
            const patternResult = await window.terminalAPI.patternRecommend?.(desc, 2);
            if (patternResult?.patterns && patternResult.patterns.length > 0) {
              writeLine(terminal, "");
              writeHtml(terminal, `<span style="color: var(--text-muted);">  Recommended patterns:</span>`);
              for (const pattern of patternResult.patterns) {
                const scoreTag = pattern.score > 20 ? "★ " : "";
                const reason = pattern.reason ? ` <span style="color: var(--text-muted);">(${pattern.reason})</span>` : "";
                writeHtml(terminal, `<span style="color: var(--accent-cyan);">    ${scoreTag}${escapeHtml(pattern.name)}</span>${reason}`);
              }
            }
          } catch (patternError) {
            console.error("[Orchestral] Pattern recommendation error:", patternError);
          }
        } else {
          writeHtml(terminal, `<span style="color: var(--text-muted);">  No relevant context found</span>`);
        }
      }
    } catch (ctxError) {
      console.error("[Orchestral] Context search error:", ctxError);
    }
  }

  try {
    writeLine(terminal, "");
    const result = await window.terminalAPI.orchestralSpawn!({
      description: desc,
      agent,
      branch,
      useContext,
      relevantContext,
    });

    console.log("[Orchestral] Spawn result:", result);

    if (result.success && result.task) {
      writeLine(terminal, "");
      writeHtml(terminal, `<span class="system-ok">${result.task.message || "Task created"}</span>`);
      const spawnedTaskId = typeof result.task.id === "string" ? result.task.id : "";

      if (result.task.details) {
        writeLine(terminal, "");
        const detailLines = result.task.details.split("\n");
        for (const line of detailLines) {
          if (line.includes("Worktree:") || line.includes("Branch:") || line.includes("Repository:")) {
            writeHtml(terminal, `<span style="color: var(--accent-cyan);">${line}</span>`);
          } else {
            writeLine(terminal, line);
          }
        }
      }

      if (typeof result.task.pid === "number" && result.task.pid > 0 && spawnedTaskId) {
        writeLine(terminal, "");
        writeHtml(
          terminal,
          `<span class="system-ok">[run] Agent is running (PID: ${result.task.pid})</span>`,
        );
        writeHtml(
          terminal,
          `<span class="system-info">Track progress: /agents output ${spawnedTaskId} 80</span>`,
        );
      }

      if (result.task.worktreeCreated && result.task.worktree) {
        writeLine(terminal, "");
        writeSection(terminal, "Workspace Shortcuts", "[next]", writeHtml);
        if (spawnedTaskId) {
          writeHtml(terminal, `<span style="color: var(--text-primary);">1. Watch agent output:</span>`);
          writeHtml(
            terminal,
            `<span class="system-info">   /agents output ${spawnedTaskId} 80</span>`,
          );
          writeLine(terminal, "");
        }
        writeHtml(terminal, `<span style="color: var(--text-primary);">2. Open VS Code:</span>`);
        writeHtml(
          terminal,
          `<span class="system-info">   code --add "${result.task.worktree}"</span>`,
        );
        writeLine(terminal, "");
        writeHtml(terminal, `<span style="color: var(--text-primary);">3. Or navigate in terminal:</span>`);
        writeHtml(
          terminal,
          `<span class="system-info">   cd "${result.task.worktree}"</span>`,
        );

        // Try to open VS Code automatically only when explicitly requested.
        if (openVsCode) {
          writeLine(terminal, "");
          writeHtml(terminal, `<span style="color: var(--accent-cyan);">Opening VS Code...</span>`);
          try {
            await window.terminalAPI.execShell(`code --add "${result.task.worktree}"`);
            writeHtml(terminal, `<span class="system-ok">[ok] VS Code launch command sent</span>`);
          } catch (codeError) {
            console.error("[Orchestral] VS Code error:", codeError);
            writeHtml(terminal, `<span class="system-warn">[warn] Could not open VS Code automatically</span>`);
          }
        }
      }

      // Refresh the sidebar to show the new task/agent
      try {
        await Promise.all([refreshSidebarAgents(), refreshSidebarTasks()]);
      } catch {
        // Ignore refresh errors
      }

      writeLine(terminal, "");
      writeHtml(
        terminal,
        `<span class="system-info">Tip: Use /agents list to see all tasks</span>`,
      );
    } else {
      writeHtml(
        terminal,
        `<span class="system-error">[err] Failed: ${result.error || "Unknown error"}</span>`,
      );
    }
  } catch (err) {
    console.error("[Orchestral] Spawn error:", err);
    writeHtml(
      terminal,
      `<span class="system-error">[err] Error: ${escapeHtml(String(err))}</span>`,
    );
  }
}

// Handle /agents command
export async function handleAgentsCommand(
  terminal: HTMLElement,
  args: string[],
  writeLine: WriteLineFn,
  writeHtml: WriteHtmlFn,
): Promise<void> {
  if (!hasOrchestralAPI()) {
    writeHtml(
      terminal,
      `<span class="system-warn">[warn] Orchestral API not available</span>`,
    );
    return;
  }

  const subcommand = args[0]?.toLowerCase() || "list";

  switch (subcommand) {
    case "list": {
      writeSection(terminal, "Running Agents", "[agent]", writeHtml);
      writeLine(terminal, "Fetching agents...");

      try {
        const result = await window.terminalAPI.orchestralAgents!("list", []);

        if (result.tasks && result.tasks.length > 0) {
          for (const task of result.tasks) {
            writeLine(terminal, "");
            const agentTag = task.agent === "claude" ? "[claude]" : task.agent === "codex" ? "[codex]" : "[gemini]";
            writeHtml(terminal, `<span class="system-ok">${agentTag} ${task.id}</span>`);
            writeLine(terminal, `  ${task.description}`);
            writeLine(terminal, `  Started: ${new Date(task.startedAt).toLocaleTimeString()}`);
            if (task.tmuxSession) {
              writeLine(terminal, `  Session: ${task.tmuxSession}`);
            }
            if (task.branch) {
              writeLine(terminal, `  Branch: ${task.branch}`);
            }
          }
          writeLine(terminal, "");
          writeHtml(terminal, `<span class="system-info">Total: ${result.tasks.length} running agent(s)</span>`);
        } else {
          writeLine(terminal, "No running agents.");
        }
      } catch (err) {
        writeHtml(
          terminal,
          `<span class="system-error">[err] Error: ${escapeHtml(String(err))}</span>`,
        );
      }
      break;
    }

    case "kill": {
      const target = args[1];

      if (!target) {
        writeHtml(terminal, `<span class="system-info">Usage: /agents kill &lt;task-id&gt; | all | --all</span>`);
        return;
      }

      // Handle all/--all flag
      if (target === "all" || target === "--all") {
        writeLine(terminal, "Fetching all running agents...");

        try {
          const listResult = await window.terminalAPI.orchestralAgents!("list", []);

          if (!listResult.tasks || listResult.tasks.length === 0) {
            writeHtml(terminal, `<span class="system-info">No running agents to kill.</span>`);
            return;
          }

          writeHtml(terminal, `<span class="system-warn">Terminating ${listResult.tasks.length} agent(s)...</span>`);

          let killedCount = 0;
          let failedCount = 0;

          for (const task of listResult.tasks) {
            try {
              const result = await window.terminalAPI.orchestralAgents!("kill", [task.id]);
              if (result.success) {
                writeHtml(terminal, `<span class="system-ok">[ok] Killed ${task.id}</span>`);
                killedCount++;
              } else {
                writeHtml(terminal, `<span class="system-error">[err] Failed to kill ${task.id}: ${result.error || "Unknown"}</span>`);
                failedCount++;
              }
            } catch (err) {
              writeHtml(terminal, `<span class="system-error">[err] Error killing ${task.id}: ${escapeHtml(String(err))}</span>`);
              failedCount++;
            }
          }

          writeLine(terminal, "");
          writeHtml(terminal, `<span class="system-ok">Done: ${killedCount} killed, ${failedCount} failed</span>`);

          // Wait for backend to update, then refresh sidebar
          try {
            await new Promise(resolve => setTimeout(resolve, 500));
            await refreshSidebarAgents();
          } catch {
            // Ignore refresh errors
          }
        } catch (err) {
          writeHtml(terminal, `<span class="system-error">[err] Error: ${escapeHtml(String(err))}</span>`);
        }
        return;
      }

      // Handle single task kill
      writeLine(terminal, `Terminating task ${target}...`);

      try {
        const result = await window.terminalAPI.orchestralAgents!("kill", [target]);
        if (result.success) {
          writeHtml(terminal, `<span class="system-ok">[ok] Task ${target} terminated</span>`);
          // Wait for backend to update, then refresh sidebar
          try {
            await new Promise(resolve => setTimeout(resolve, 300));
            await refreshSidebarAgents();
          } catch {
            // Ignore refresh errors
          }
        } else {
          writeHtml(
            terminal,
            `<span class="system-error">[err] Failed: ${result.error || "Unknown error"}</span>`,
          );
        }
      } catch (err) {
        writeHtml(
          terminal,
          `<span class="system-error">[err] Error: ${escapeHtml(String(err))}</span>`,
        );
      }
      break;
    }

    case "attach": {
      const taskId = args[1];
      if (!taskId) {
        writeHtml(terminal, `<span class="system-info">Usage: /agents attach &lt;task-id&gt;</span>`);
        return;
      }

      try {
        const result = await window.terminalAPI.orchestralAgents!("attach", [taskId]);
        if (result.success && result.attachCommand) {
          writeSection(terminal, "Attach to Session", "[tmux]", writeHtml);
          writeLine(terminal, `Task: ${taskId}`);
          writeLine(terminal, "");
          writeHtml(terminal, `<span style="color: var(--accent-cyan);">Run in another terminal:</span>`);
          writeHtml(terminal, `<span style="color: var(--text-primary);">  ${result.attachCommand}</span>`);
          writeLine(terminal, "");
          writeHtml(terminal, `<span class="system-info">(Press Ctrl+B, then D to detach without killing)</span>`);
        } else {
          writeHtml(
            terminal,
            `<span class="system-error">[err] Task not found or no session available</span>`,
          );
        }
      } catch (err) {
        writeHtml(
          terminal,
          `<span class="system-error">[err] Error: ${escapeHtml(String(err))}</span>`,
        );
      }
      break;
    }

    case "redirect": {
      const taskId = args[1];
      const message = args.slice(2).join(" ");

      if (!taskId || !message) {
        writeHtml(terminal, `<span class="system-info">Usage: /agents redirect &lt;task-id&gt; &lt;message&gt;</span>`);
        return;
      }

      try {
        const result = await window.terminalAPI.orchestralAgents!("redirect", [taskId, message]);
        if (result.success) {
          writeHtml(terminal, `<span class="system-ok">[ok] Message sent to ${taskId}</span>`);
        } else {
          writeHtml(
            terminal,
            `<span class="system-error">[err] Failed: ${result.error || "Unknown error"}</span>`,
          );
        }
      } catch (err) {
        writeHtml(
          terminal,
          `<span class="system-error">[err] Error: ${escapeHtml(String(err))}</span>`,
        );
      }
      break;
    }

    case "output": {
      const taskId = args[1];
      const linesArg = args[2];
      const lines = linesArg ? parseInt(linesArg, 10) : 50;

      if (!taskId) {
        writeHtml(terminal, `<span class="system-info">Usage: /agents output &lt;task-id&gt; [lines]</span>`);
        return;
      }

      writeSection(terminal, `Agent Output: ${taskId}`, "[out]", writeHtml);

      try {
        // Try the new API first
        if (window.terminalAPI.agentGetOutput) {
          const result = await window.terminalAPI.agentGetOutput!(taskId, lines);
          if (result.success && result.output) {
            writeHtml(terminal, `<pre style="color: var(--text-primary); white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(result.output)}</pre>`);
          } else if (result.success) {
            writeHtml(terminal, `<span class="system-info">No output available yet</span>`);
          } else {
            writeHtml(
              terminal,
              `<span class="system-error">[err] Failed: ${result.error || "Unknown error"}</span>`,
            );
          }
        } else {
          // Fall back to legacy API
          const result = await window.terminalAPI.orchestralAgents!("output", [taskId, String(lines)]);
          if (result.success && result.output) {
            writeHtml(terminal, `<pre style="color: var(--text-primary); white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(result.output)}</pre>`);
          } else if (result.success) {
            writeHtml(terminal, `<span class="system-info">No output available or session is not active</span>`);
          } else {
            writeHtml(
              terminal,
              `<span class="system-error">[err] Failed: ${result.error || "Unknown error"}</span>`,
            );
          }
        }
      } catch (err) {
        writeHtml(
          terminal,
          `<span class="system-error">[err] Error: ${escapeHtml(String(err))}</span>`,
        );
      }
      break;
    }

    case "watch": {
      const taskId = args[1];
      if (!taskId) {
        writeHtml(terminal, `<span class="system-info">Usage: /agents watch &lt;task-id&gt;</span>`);
        return;
      }

      writeSection(terminal, `Watching Agent: ${taskId}`, "[watch]", writeHtml);
      writeHtml(terminal, `<span class="system-info">Streaming output... (Ctrl+C to stop)</span>`);

      // Subscribe to agent output
      if (window.terminalAPI.onAgentOutput) {
        const unsubscribe = window.terminalAPI.onAgentOutput!((data) => {
          if (data.taskId === taskId) {
            // Write output directly to terminal
            writeHtml(terminal, `<span style="color: var(--text-primary);">${escapeHtml(data.data)}</span>`);
            // Auto-scroll to bottom
            terminal.scrollTop = terminal.scrollHeight;
          }
        });

        // Store unsubscribe function for cleanup (in a real implementation)
        (terminal as any)._agentOutputUnsubscribe = unsubscribe;

        // Also show recent output
        try {
          const result = await window.terminalAPI.agentGetOutput!(taskId, 20);
          if (result.success && result.output) {
            writeHtml(terminal, `<span style="color: var(--text-muted);">--- Recent output ---</span>`);
            writeHtml(terminal, `<span style="color: var(--text-primary);">${escapeHtml(result.output)}</span>`);
            writeHtml(terminal, `<span style="color: var(--text-muted);">--- Live output ---</span>`);
          }
        } catch {
          // Ignore errors getting initial output
        }
      } else {
        writeHtml(terminal, `<span class="system-warn">[warn] Real-time output not available in this version</span>`);
      }
      break;
    }

    default:
      writeHtml(terminal, `<span class="system-info">Usage: /agents [list|kill|attach|redirect|output|watch] [args]</span>`);
      break;
  }
}

// Handle /tasks command
export async function handleTasksCommand(
  terminal: HTMLElement,
  args: string[],
  writeLine: WriteLineFn,
  writeHtml: WriteHtmlFn,
): Promise<void> {
  if (!hasOrchestralAPI()) {
    writeHtml(
      terminal,
      `<span class="system-warn">[warn] Orchestral API not available</span>`,
    );
    return;
  }

  const subcommand = args[0]?.toLowerCase();

  // Handle clear subcommand
  if (subcommand === "clear" || subcommand === "purge") {
    writeLine(terminal, "Clearing completed tasks from storage...");

    try {
      // Actually delete completed tasks from backend storage
      const result = await window.terminalAPI.orchestralTasks?.({}, "purge");

      if (result?.success) {
        writeHtml(terminal, `<span class="system-ok">[ok] ${result.message || "Tasks cleared"}</span>`);
        // Refresh sidebar to show updated state
        await refreshSidebarTasks();
      } else {
        writeHtml(terminal, `<span class="system-error">[err] ${result?.error || "Failed to clear tasks"}</span>`);
      }
    } catch (err) {
      writeHtml(terminal, `<span class="system-error">[err] Error: ${escapeHtml(String(err))}</span>`);
    }
    return;
  }

  // Handle purge-all subcommand - forcefully clear ALL tasks including stale "running" ones
  if (subcommand === "purge-all" || subcommand === "clear-all") {
    writeLine(terminal, "Forcefully clearing ALL tasks from storage (including stale running tasks)...");

    try {
      const result = await window.terminalAPI.orchestralTasks?.({}, "purge-all");

      if (result?.success) {
        writeHtml(terminal, `<span class="system-ok">[ok] ${result.message || "All tasks cleared"}</span>`);
        // Refresh sidebar to show updated state
        await refreshSidebarTasks();
      } else {
        writeHtml(terminal, `<span class="system-error">[err] ${result?.error || "Failed to clear tasks"}</span>`);
      }
    } catch (err) {
      writeHtml(terminal, `<span class="system-error">[err] Error: ${escapeHtml(String(err))}</span>`);
    }
    return;
  }

  // Handle show subcommand
  if (subcommand === "show") {
    const showAll = args.includes("--all");

    if (showAll) {
      writeLine(terminal, "Showing all tasks (including completed) in sidebar...");
      showAllTasks();
      writeHtml(terminal, `<span class="system-ok">[ok] Sidebar now shows all tasks</span>`);
    } else {
      writeLine(terminal, "Showing only running tasks in sidebar...");
      setHideCompletedTasks();
      writeHtml(terminal, `<span class="system-ok">[ok] Sidebar now shows only active tasks</span>`);
    }
    return;
  }

  // Parse filters for list command
  const filters: Record<string, string> = {};
  for (const arg of args) {
    if (arg.startsWith("--status=")) {
      filters.status = arg.slice(9);
    } else if (arg.startsWith("--agent=")) {
      filters.agent = arg.slice(8);
    } else if (arg.startsWith("--limit=")) {
      filters.limit = arg.slice(8);
    }
  }

  writeSection(terminal, "Tasks", "[tasks]", writeHtml);
  writeLine(terminal, "Fetching tasks...");

  try {
    const result = await window.terminalAPI.orchestralTasks!(filters);

    if (result.tasks && result.tasks.length > 0) {
      // Show summary counts
      const allResult = await window.terminalAPI.orchestralTasks!({});
      if (allResult.summary) {
        writeLine(terminal, "");
        writeHtml(terminal, `<span class="system-info">${allResult.summary}</span>`);
        writeLine(terminal, "");
      }

      for (const task of result.tasks) {
        const statusTag = task.status === "running" ? "[RUN]" :
                          task.status === "completed" ? "[DONE]" :
                          task.status === "failed" ? "[FAIL]" :
                          task.status === "pending" ? "[PEND]" : "[STOP]";
        const agentTag = task.agent === "claude" ? "[claude]" : task.agent === "codex" ? "[codex]" : "[gemini]";

        writeHtml(terminal, `<span style="color: var(--text-primary);">${statusTag} ${agentTag} ${task.id} [${task.status}]</span>`);
        writeLine(terminal, `  ${task.description}`);
        writeLine(terminal, `  Started: ${new Date(task.startedAt).toLocaleString()}`);

        if (task.completedAt) {
          const duration = Math.round((task.completedAt - task.startedAt) / 1000);
          writeLine(terminal, `  Duration: ${duration}s`);
        }
        if (task.exitCode !== undefined && task.exitCode !== null) {
          writeLine(terminal, `  Exit code: ${task.exitCode}`);
        }
        if (task.failureReason) {
          writeHtml(
            terminal,
            `  <span style="color: var(--accent-warning);">Failure: ${escapeHtml(String(task.failureReason))}</span>`,
          );
        }
        writeLine(terminal, "");
      }

      writeHtml(terminal, `<span class="system-info">Showing ${result.tasks.length} task(s)</span>`);
    } else {
      writeLine(terminal, "No tasks found.");
    }
  } catch (err) {
    writeHtml(
      terminal,
      `<span class="system-error">[err] Error: ${escapeHtml(String(err))}</span>`,
    );
  }
}

// Export help function
export { showOrchestralHelp };
