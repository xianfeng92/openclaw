import type {
  TerminalConfigIssue,
  TerminalConfigValidation,
} from "../preload/terminal-api";

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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function redactSecret(value: string): string {
  if (!value.trim()) {
    return value;
  }
  if (value.includes("${")) {
    return value;
  }
  if (value.length <= 8) {
    return "********";
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function redactConfig(value: unknown, keyHint = ""): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactConfig(item, keyHint));
  }
  const record = asRecord(value);
  if (record) {
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) {
      next[key] = redactConfig(child, key);
    }
    return next;
  }
  if (typeof value === "string" && /(api[_-]?key|token|secret)/i.test(keyHint)) {
    return redactSecret(value);
  }
  return value;
}

function renderValidation(
  terminal: HTMLElement,
  validation: TerminalConfigValidation | undefined,
  issues: TerminalConfigIssue[] | undefined,
  deps: Pick<CommandRenderDeps, "writeHtml" | "escapeHtml">,
): void {
  if (!validation) {
    return;
  }

  if (validation.valid) {
    deps.writeHtml(terminal, `<span class="system-ok">[ok] Config validation passed</span>`);
  } else {
    deps.writeHtml(
      terminal,
      `<span class="system-error">[err] Config validation failed (${validation.errors.length} error(s))</span>`,
    );
  }

  const effectiveIssues = issues ?? validation.issues;
  for (const issue of effectiveIssues) {
    const cssClass = issue.severity === "error" ? "system-error" : "system-warn";
    const pathSuffix = issue.path ? ` (${issue.path})` : "";
    deps.writeHtml(
      terminal,
      `<span class="${cssClass}">[${issue.severity}] ${deps.escapeHtml(issue.message)}${deps.escapeHtml(pathSuffix)}</span>`,
    );
  }
}

export async function handleConfigCommand(
  terminal: HTMLElement,
  args: string[],
  deps: CommandRenderDeps,
): Promise<void> {
  const action = (args[0] || "show").toLowerCase();

  switch (action) {
    case "help": {
      deps.writeHtml(
        terminal,
        `
<span class="system-ok"><strong>Config Commands</strong></span>

<span class="system-info">Usage:</span>
  /config show
  /config set &lt;key&gt; &lt;value&gt;
  /config apply
  /config validate
  /config reset
  /config path

<span class="system-info">Common keys:</span>
  ai.defaultProvider
  ai.providers.openai.apiKey
  ai.providers.openai.baseUrl
  ai.providers.openai.model
  ai.providers.openai.maxTokens
  ai.providers.google.apiKey
  ai.providers.google.baseUrl
  ai.providers.google.model
  ai.providers.google.maxTokens
  workspace.path
  workspace.autoCreate
  gateway.port
  gateway.autoStart
  terminal.allowShell
  ui.theme

<span class="system-info">Examples:</span>
  /config set gateway.port 19001
  /config set gateway.autoStart true
  /config set ai.defaultProvider google
  /config set ai.providers.google.model gemini-2.5-flash
  /config set terminal.allowShell true
  /config apply
  /config set workspace.path "./workspace"
        `.trim(),
      );
      return;
    }

    case "show": {
      const result = await window.terminalAPI.configGet();
      if (!result.success) {
        deps.writeHtml(terminal, `<span class="system-error">[err] ${deps.escapeHtml(result.error || "Failed to load config")}</span>`);
        return;
      }

      deps.writeSection(terminal, "CyDeck Config", "[config]");
      deps.writeHtml(terminal, `<span class="system-info">Path: ${deps.escapeHtml(result.configPath)}</span>`);
      deps.writeHtml(terminal, `<span class="system-info">State Dir: ${deps.escapeHtml(result.stateDir)}</span>`);
      if (result.workspacePath) {
        deps.writeHtml(terminal, `<span class="system-info">Workspace: ${deps.escapeHtml(result.workspacePath)}</span>`);
      }
      if (result.runtimeProvider) {
        const runtimeProvider = asRecord(result.runtimeProvider);
        if (runtimeProvider) {
          const provider = typeof runtimeProvider.provider === "string" ? runtimeProvider.provider : "unknown";
          const model = typeof runtimeProvider.model === "string" ? runtimeProvider.model : "unknown";
          deps.writeHtml(
            terminal,
            `<span class="system-info">Runtime Provider: ${deps.escapeHtml(provider)} / ${deps.escapeHtml(model)}</span>`,
          );
        }
      }

      renderValidation(terminal, result.validation, result.issues, deps);

      if (result.config) {
        deps.writeLine(terminal, "");
        deps.writeHtml(terminal, `<span class="system-info">Resolved Config (redacted):</span>`);
        const redacted = redactConfig(result.config);
        deps.writeHtml(
          terminal,
          `<pre class="assistant-code"><code>${deps.escapeHtml(JSON.stringify(redacted, null, 2))}</code></pre>`,
        );
      }
      return;
    }

    case "set": {
      const key = args[1];
      const value = args.slice(2).join(" ");
      if (!key || !value.trim()) {
        deps.writeHtml(
          terminal,
          `<span class="system-info">Usage: /config set &lt;key&gt; &lt;value&gt;</span>`,
        );
        return;
      }

      const result = await window.terminalAPI.configSet(key, value);
      if (!result.success) {
        deps.writeHtml(terminal, `<span class="system-error">[err] ${deps.escapeHtml(result.error || "Failed to set config value")}</span>`);
        return;
      }

      deps.writeHtml(
        terminal,
        `<span class="system-ok">[ok] Updated ${deps.escapeHtml(result.key || key)} = ${deps.escapeHtml(String(result.value ?? value))}</span>`,
      );
      renderValidation(terminal, result.validation, result.issues, deps);
      return;
    }

    case "validate": {
      const result = await window.terminalAPI.configValidate();
      if (!result.success) {
        deps.writeHtml(terminal, `<span class="system-error">[err] ${deps.escapeHtml(result.error || "Failed to validate config")}</span>`);
        return;
      }

      deps.writeSection(terminal, "Config Validation", "[config]");
      deps.writeHtml(terminal, `<span class="system-info">Path: ${deps.escapeHtml(result.configPath)}</span>`);
      renderValidation(terminal, result.validation, result.issues, deps);
      return;
    }

    case "apply": {
      const result = await window.terminalAPI.configApply();
      if (!result.success) {
        deps.writeHtml(terminal, `<span class="system-error">[err] ${deps.escapeHtml(result.error || "Failed to apply config")}</span>`);
        return;
      }

      deps.writeHtml(terminal, `<span class="system-ok">[ok] Config applied to live gateway</span>`);
      const runtimeProvider = asRecord(result.runtimeProvider);
      if (runtimeProvider) {
        const provider = typeof runtimeProvider.provider === "string" ? runtimeProvider.provider : "unknown";
        const model = typeof runtimeProvider.model === "string" ? runtimeProvider.model : "unknown";
        deps.writeHtml(
          terminal,
          `<span class="system-info">Runtime Provider: ${deps.escapeHtml(provider)} / ${deps.escapeHtml(model)}</span>`,
        );
      }
      renderValidation(terminal, result.validation, result.issues, deps);
      return;
    }

    case "reset": {
      const result = await window.terminalAPI.configReset();
      if (!result.success) {
        deps.writeHtml(terminal, `<span class="system-error">[err] ${deps.escapeHtml(result.error || "Failed to reset config")}</span>`);
        return;
      }

      deps.writeHtml(terminal, `<span class="system-ok">[ok] Config reset to defaults</span>`);
      deps.writeHtml(terminal, `<span class="system-info">Path: ${deps.escapeHtml(result.configPath)}</span>`);
      renderValidation(terminal, result.validation, result.issues, deps);
      return;
    }

    case "path": {
      const result = await window.terminalAPI.configPath();
      if (!result.success) {
        deps.writeHtml(terminal, `<span class="system-error">[err] ${deps.escapeHtml(result.error || "Failed to resolve config paths")}</span>`);
        return;
      }

      deps.writeSection(terminal, "Config Paths", "[config]");
      deps.writeHtml(terminal, `<span class="system-info">Config: ${deps.escapeHtml(result.configPath)}</span>`);
      deps.writeHtml(terminal, `<span class="system-info">State: ${deps.escapeHtml(result.stateDir)}</span>`);
      return;
    }

    default: {
      deps.writeHtml(
        terminal,
        `<span class="system-warn">[warn] Unknown /config action: ${deps.escapeHtml(action)}</span>`,
      );
      deps.writeHtml(terminal, `<span class="system-info">Use /config help for usage.</span>`);
    }
  }
}
