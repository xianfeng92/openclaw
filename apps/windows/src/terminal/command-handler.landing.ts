import type { TerminalLandingFileStatus } from "../preload/terminal-api";

type WriteHtmlFn = (terminal: HTMLElement, html: string) => void;
type WriteSectionFn = (terminal: HTMLElement, title: string, icon: string) => void;
type EscapeHtmlFn = (text: string) => string;
type RenderLandingFilesFn = (
  terminal: HTMLElement,
  files: TerminalLandingFileStatus[] | undefined,
) => void;

type LandingRenderDeps = {
  writeHtml: WriteHtmlFn;
  writeSection: WriteSectionFn;
  escapeHtml: EscapeHtmlFn;
  renderLandingFiles: RenderLandingFilesFn;
};

type LandingWizardSetKey = "identity.name" | "user.name" | "user.timezone";
type LandingWizardAddTarget = "soul" | "agents" | "memory";

type LandingWizardStep =
  | {
      mode: "set";
      key: LandingWizardSetKey;
      title: string;
      prompt: string;
      example: string;
    }
  | {
      mode: "add";
      target: LandingWizardAddTarget;
      title: string;
      prompt: string;
      example: string;
    };

type LandingWizardState = {
  workspacePath: string;
  stepIndex: number;
};

const LANDING_WIZARD_STEPS: LandingWizardStep[] = [
  {
    mode: "set",
    key: "identity.name",
    title: "Identity Name",
    prompt: "Who is the CyDeck agent identity? (identity.name)",
    example: "CyDeck",
  },
  {
    mode: "set",
    key: "user.name",
    title: "User Name",
    prompt: "What should I call you? (user.name)",
    example: "Peter",
  },
  {
    mode: "set",
    key: "user.timezone",
    title: "User Timezone",
    prompt: "What timezone should I use? (user.timezone)",
    example: "Asia/Shanghai",
  },
  {
    mode: "add",
    target: "soul",
    title: "SOUL Directive",
    prompt: "Add one SOUL session directive (non-negotiable behavior).",
    example: "Lead with the answer, then give concise evidence.",
  },
  {
    mode: "add",
    target: "agents",
    title: "Agent Rule",
    prompt: "Add one AGENTS operating rule.",
    example: "Ask before external side effects.",
  },
  {
    mode: "add",
    target: "memory",
    title: "Long-term Memory",
    prompt: "Add one long-term MEMORY fact.",
    example: "User prefers concise replies in Chinese.",
  },
];

let landingWizardState: LandingWizardState | null = null;

export function isLandingWizardActive(): boolean {
  return landingWizardState !== null;
}

function getLandingWizardStep(): LandingWizardStep | null {
  if (!landingWizardState) {
    return null;
  }
  return LANDING_WIZARD_STEPS[landingWizardState.stepIndex] ?? null;
}

function clampLandingWizardStepIndex(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  const normalized = Math.floor(value);
  if (normalized < 0) {
    return 0;
  }
  if (normalized > LANDING_WIZARD_STEPS.length) {
    return LANDING_WIZARD_STEPS.length;
  }
  return normalized;
}

function formatLandingWizardStep(stepIndex: number): string {
  const normalized = clampLandingWizardStepIndex(stepIndex);
  if (normalized >= LANDING_WIZARD_STEPS.length) {
    return `complete (${LANDING_WIZARD_STEPS.length}/${LANDING_WIZARD_STEPS.length})`;
  }
  return `${normalized + 1}/${LANDING_WIZARD_STEPS.length}`;
}

async function persistLandingWizardState(
  terminal: HTMLElement,
  deps: Pick<LandingRenderDeps, "writeHtml" | "escapeHtml">,
): Promise<void> {
  if (!landingWizardState) {
    return;
  }
  const result = await window.terminalAPI.landingWizardSave(landingWizardState.stepIndex);
  if (!result.success) {
    deps.writeHtml(
      terminal,
      `<span class="system-warn">[warn] Failed to persist landing wizard state: ${deps.escapeHtml(result.error || "Unknown error")}</span>`,
    );
  }
}

async function clearLandingWizardState(
  terminal: HTMLElement,
  deps: Pick<LandingRenderDeps, "writeHtml" | "escapeHtml">,
): Promise<void> {
  const result = await window.terminalAPI.landingWizardClear();
  if (!result.success) {
    deps.writeHtml(
      terminal,
      `<span class="system-warn">[warn] Failed to clear landing wizard state: ${deps.escapeHtml(result.error || "Unknown error")}</span>`,
    );
  }
}

function renderLandingWizardStep(terminal: HTMLElement, deps: LandingRenderDeps): void {
  const step = getLandingWizardStep();
  if (!step || !landingWizardState) {
    return;
  }

  const stepNumber = landingWizardState.stepIndex + 1;
  deps.writeHtml(terminal, `<span class="system-info">Step ${stepNumber}/${LANDING_WIZARD_STEPS.length}: ${deps.escapeHtml(step.title)}</span>`);
  deps.writeHtml(terminal, `<span class="system-info">${deps.escapeHtml(step.prompt)}</span>`);
  deps.writeHtml(terminal, `<span class="system-muted">Example: ${deps.escapeHtml(step.example)}</span>`);
  deps.writeHtml(terminal, `<span class="system-muted">Type your answer and press Enter. Commands: /landing skip, /landing cancel</span>`);
}

async function finishLandingWizard(terminal: HTMLElement, deps: LandingRenderDeps): Promise<void> {
  landingWizardState = null;
  await clearLandingWizardState(terminal, deps);
  const status = await window.terminalAPI.landingStatus();
  deps.writeSection(terminal, "Landing Wizard Complete", "[landing]");
  if (!status.success) {
    deps.writeHtml(terminal, `<span class="system-warn">[warn] Wizard finished, but status check failed: ${deps.escapeHtml(status.error || "Unknown error")}</span>`);
    deps.writeHtml(terminal, `<span class="system-info">Run /landing status to inspect files.</span>`);
    return;
  }

  deps.writeHtml(terminal, `<span class="system-info">Workspace: ${deps.escapeHtml(status.workspacePath)}</span>`);
  deps.renderLandingFiles(terminal, status.files);
  if (status.completed) {
    deps.writeHtml(terminal, `<span class="system-ok">[ok] Landing is complete and ready.</span>`);
  } else {
    deps.writeHtml(terminal, `<span class="system-warn">[warn] Landing still has template fields. Run /landing status for details.</span>`);
  }
}

export async function consumeLandingWizardMessageInput(
  terminal: HTMLElement,
  content: string,
  deps: LandingRenderDeps,
): Promise<boolean> {
  const step = getLandingWizardStep();
  if (!step || !landingWizardState) {
    return false;
  }

  const answer = content.trim();
  if (!answer) {
    deps.writeHtml(terminal, `<span class="system-warn">[warn] Input cannot be empty.</span>`);
    renderLandingWizardStep(terminal, deps);
    return true;
  }

  if (step.mode === "set") {
    const result = await window.terminalAPI.landingSet(step.key, answer);
    if (!result.success) {
      deps.writeHtml(terminal, `<span class="system-error">[err] ${deps.escapeHtml(result.error || "Failed to save landing value")}</span>`);
      deps.writeHtml(terminal, `<span class="system-info">Try again, or use /landing skip /landing cancel.</span>`);
      return true;
    }
    deps.writeHtml(
      terminal,
      `<span class="system-ok">[ok] ${deps.escapeHtml(result.key || step.key)} = ${deps.escapeHtml(result.value || answer)}</span>`,
    );
    if (result.fileName) {
      deps.writeHtml(terminal, `<span class="system-info">Updated: ${deps.escapeHtml(result.fileName)}</span>`);
    }
  } else {
    const result = await window.terminalAPI.landingAdd(step.target, answer);
    if (!result.success) {
      deps.writeHtml(terminal, `<span class="system-error">[err] ${deps.escapeHtml(result.error || "Failed to append landing note")}</span>`);
      deps.writeHtml(terminal, `<span class="system-info">Try again, or use /landing skip /landing cancel.</span>`);
      return true;
    }
    deps.writeHtml(
      terminal,
      `<span class="system-ok">[ok] Added note to ${deps.escapeHtml(result.fileName || step.target)}</span>`,
    );
  }

  landingWizardState.stepIndex += 1;
  if (landingWizardState.stepIndex >= LANDING_WIZARD_STEPS.length) {
    await finishLandingWizard(terminal, deps);
    return true;
  }

  await persistLandingWizardState(terminal, deps);
  renderLandingWizardStep(terminal, deps);
  return true;
}

async function startLandingWizard(
  terminal: HTMLElement,
  deps: LandingRenderDeps,
  options: { reset?: boolean } = {},
): Promise<void> {
  const forceReset = options.reset === true;
  if (forceReset) {
    landingWizardState = null;
    await clearLandingWizardState(terminal, deps);
    deps.writeHtml(terminal, `<span class="system-info">Reset persisted wizard progress. Starting from step 1.</span>`);
  }

  const result = await window.terminalAPI.landingInit();
  if (!result.success) {
    deps.writeHtml(terminal, `<span class="system-error">[err] ${deps.escapeHtml(result.error || "Failed to start landing setup")}</span>`);
    return;
  }

  if (landingWizardState) {
    deps.writeHtml(terminal, `<span class="system-warn">[warn] Restarting landing wizard from current workspace state.</span>`);
  }

  const nextStepIndex = forceReset ? 0 : clampLandingWizardStepIndex(result.nextStepIndex);
  const savedStepIndex =
    !forceReset && typeof result.wizardStepIndex === "number"
      ? clampLandingWizardStepIndex(result.wizardStepIndex)
      : null;

  landingWizardState = {
    workspacePath: result.workspacePath,
    stepIndex: nextStepIndex,
  };

  deps.writeSection(terminal, "Landing Wizard", "[landing]");
  deps.writeHtml(terminal, `<span class="system-info">Workspace: ${deps.escapeHtml(result.workspacePath)}</span>`);
  deps.renderLandingFiles(terminal, result.files);
  if (savedStepIndex !== null) {
    deps.writeHtml(
      terminal,
      `<span class="system-info">Recovered saved wizard progress at step ${formatLandingWizardStep(savedStepIndex)}.</span>`,
    );
  }
  if (nextStepIndex >= LANDING_WIZARD_STEPS.length) {
    deps.writeHtml(terminal, `<span class="system-ok">[ok] Landing is already complete. No wizard steps are pending.</span>`);
    await finishLandingWizard(terminal, deps);
    return;
  }
  if (nextStepIndex > 0) {
    deps.writeHtml(
      terminal,
      `<span class="system-info">Auto-jump to first missing step ${formatLandingWizardStep(nextStepIndex)}.</span>`,
    );
  }
  deps.writeHtml(terminal, `<span class="system-muted">This wizard asks one question per step and writes files immediately.</span>`);
  await persistLandingWizardState(terminal, deps);
  renderLandingWizardStep(terminal, deps);
}

export async function handleLandingCommand(
  terminal: HTMLElement,
  args: string[],
  deps: LandingRenderDeps,
): Promise<void> {
  const action = (args[0] || "help").toLowerCase();

  switch (action) {
    case "help": {
      deps.writeHtml(
        terminal,
        `
<span class="system-ok"><strong>Landing Commands</strong></span>

<span class="system-info">Goal:</span>
  Bootstrap and configure the shared OpenClaw workspace files used by CyDeck

<span class="system-info">Usage:</span>
  /landing status
  /landing init
  /landing start
  /landing start --reset
  /landing resume
  /landing skip
  /landing cancel
  /landing set &lt;key&gt; &lt;value&gt;
  /landing add &lt;agents|soul|memory&gt; &lt;text&gt;

<span class="system-info">Wizard:</span>
  Run /landing start, then type answers directly (no slash command needed).
  Use /landing start --reset to force restart from step 1.

<span class="system-info">Managed files:</span>
  AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md, HEARTBEAT.md, BOOTSTRAP.md, MEMORY.md

<span class="system-info">Set keys:</span>
  identity.name
  identity.creature
  identity.vibe
  identity.emoji
  identity.avatar
  user.name
  user.preferredName
  user.pronouns
  user.timezone
  user.language

<span class="system-info">Examples:</span>
  /landing init
  /landing set identity.name Cydec
  /landing set user.timezone Asia/Shanghai
  /landing add soul Be direct and evidence-driven
  /landing add agents Ask before external side effects
  /landing add memory User prefers concise replies in Chinese
        `.trim(),
      );
      return;
    }

    case "status": {
      const result = await window.terminalAPI.landingStatus();
      if (!result.success) {
        deps.writeHtml(terminal, `<span class="system-error">[err] ${deps.escapeHtml(result.error || "Failed to load landing status")}</span>`);
        return;
      }
      deps.writeSection(terminal, "Landing Status", "[landing]");
      deps.writeHtml(terminal, `<span class="system-info">Workspace: ${deps.escapeHtml(result.workspacePath)}</span>`);
      deps.renderLandingFiles(terminal, result.files);
      if (result.completed) {
        deps.writeHtml(terminal, `<span class="system-info">Next: /landing start --reset (optional full re-onboarding)</span>`);
      } else if (typeof result.wizardStepIndex === "number") {
        deps.writeHtml(terminal, `<span class="system-info">Next: /landing resume</span>`);
      } else {
        deps.writeHtml(terminal, `<span class="system-info">Next: /landing start</span>`);
      }
      if (typeof result.wizardStepIndex === "number") {
        const wizardStep = clampLandingWizardStepIndex(result.wizardStepIndex);
        deps.writeHtml(
          terminal,
          `<span class="system-info">Persisted wizard progress: step ${formatLandingWizardStep(wizardStep)}</span>`,
        );
      }
      if (result.completed) {
        deps.writeHtml(terminal, `<span class="system-ok">[ok] Landing is complete</span>`);
      } else {
        deps.writeHtml(terminal, `<span class="system-warn">[warn] Landing is not complete. Run /landing start</span>`);
        if (typeof result.nextStepIndex === "number") {
          const nextStep = clampLandingWizardStepIndex(result.nextStepIndex);
          if (nextStep < LANDING_WIZARD_STEPS.length) {
            deps.writeHtml(
              terminal,
              `<span class="system-info">First missing wizard step: ${nextStep + 1}/${LANDING_WIZARD_STEPS.length}</span>`,
            );
          }
        }
      }
      return;
    }

    case "init": {
      const result = await window.terminalAPI.landingInit();
      if (!result.success) {
        deps.writeHtml(terminal, `<span class="system-error">[err] ${deps.escapeHtml(result.error || "Failed to init landing files")}</span>`);
        return;
      }
      deps.writeSection(terminal, "Landing Init", "[landing]");
      deps.writeHtml(terminal, `<span class="system-info">Workspace: ${deps.escapeHtml(result.workspacePath)}</span>`);
      const created = result.created ?? [];
      const existing = result.existing ?? [];
      deps.writeHtml(terminal, `<span class="system-info">Created: ${deps.escapeHtml(String(created.length))}</span>`);
      if (created.length > 0) {
        deps.writeHtml(terminal, `<span class="system-info">  ${deps.escapeHtml(created.join(", "))}</span>`);
      }
      deps.writeHtml(terminal, `<span class="system-info">Existing: ${deps.escapeHtml(String(existing.length))}</span>`);
      deps.renderLandingFiles(terminal, result.files);
      return;
    }

    case "start": {
      await startLandingWizard(terminal, deps, { reset: args.includes("--reset") });
      return;
    }

    case "resume": {
      if (!landingWizardState) {
        const status = await window.terminalAPI.landingStatus();
        if (!status.success) {
          deps.writeHtml(terminal, `<span class="system-error">[err] ${deps.escapeHtml(status.error || "Failed to load landing status")}</span>`);
          return;
        }
        if (typeof status.wizardStepIndex !== "number") {
          deps.writeHtml(terminal, `<span class="system-warn">[warn] No persisted landing wizard state. Run /landing start.</span>`);
          return;
        }
        const resumeStep = clampLandingWizardStepIndex(status.nextStepIndex ?? status.wizardStepIndex);
        if (resumeStep >= LANDING_WIZARD_STEPS.length) {
          await clearLandingWizardState(terminal, deps);
          deps.writeHtml(terminal, `<span class="system-ok">[ok] Landing is already complete.</span>`);
          return;
        }
        landingWizardState = {
          workspacePath: status.workspacePath,
          stepIndex: resumeStep,
        };
        await persistLandingWizardState(terminal, deps);
        deps.writeHtml(
          terminal,
          `<span class="system-info">Resumed persisted wizard state at step ${formatLandingWizardStep(resumeStep)}.</span>`,
        );
      }
      deps.writeSection(terminal, "Landing Wizard", "[landing]");
      deps.writeHtml(terminal, `<span class="system-info">Workspace: ${deps.escapeHtml(landingWizardState.workspacePath)}</span>`);
      renderLandingWizardStep(terminal, deps);
      return;
    }

    case "skip": {
      if (!landingWizardState) {
        deps.writeHtml(terminal, `<span class="system-warn">[warn] No active landing wizard. Run /landing start.</span>`);
        return;
      }
      const skippedStep = getLandingWizardStep();
      if (!skippedStep) {
        landingWizardState = null;
        await clearLandingWizardState(terminal, deps);
        deps.writeHtml(terminal, `<span class="system-warn">[warn] Landing wizard state was invalid and has been reset.</span>`);
        return;
      }
      const skippedIndex = landingWizardState.stepIndex + 1;
      deps.writeHtml(
        terminal,
        `<span class="system-warn">[warn] Skipped step ${skippedIndex}/${LANDING_WIZARD_STEPS.length}: ${deps.escapeHtml(skippedStep.title)}</span>`,
      );
      landingWizardState.stepIndex += 1;
      if (landingWizardState.stepIndex >= LANDING_WIZARD_STEPS.length) {
        await finishLandingWizard(terminal, deps);
        return;
      }
      await persistLandingWizardState(terminal, deps);
      renderLandingWizardStep(terminal, deps);
      return;
    }

    case "cancel": {
      if (landingWizardState) {
        landingWizardState = null;
        await clearLandingWizardState(terminal, deps);
        deps.writeHtml(terminal, `<span class="system-ok">[ok] Landing wizard cancelled.</span>`);
        return;
      }
      const status = await window.terminalAPI.landingStatus();
      if (!status.success) {
        deps.writeHtml(terminal, `<span class="system-error">[err] ${deps.escapeHtml(status.error || "Failed to load landing status")}</span>`);
        return;
      }
      if (typeof status.wizardStepIndex !== "number") {
        deps.writeHtml(terminal, `<span class="system-warn">[warn] No active landing wizard.</span>`);
        return;
      }
      await clearLandingWizardState(terminal, deps);
      deps.writeHtml(terminal, `<span class="system-ok">[ok] Cleared persisted landing wizard state.</span>`);
      return;
    }

    case "set": {
      const key = args[1];
      const value = args.slice(2).join(" ");
      if (!key || !value.trim()) {
        deps.writeHtml(terminal, `<span class="system-info">Usage: /landing set &lt;key&gt; &lt;value&gt;</span>`);
        return;
      }
      const result = await window.terminalAPI.landingSet(key, value);
      if (!result.success) {
        deps.writeHtml(terminal, `<span class="system-error">[err] ${deps.escapeHtml(result.error || "Failed to set landing value")}</span>`);
        return;
      }
      deps.writeHtml(
        terminal,
        `<span class="system-ok">[ok] ${deps.escapeHtml(result.key || key)} = ${deps.escapeHtml(result.value || value)}</span>`,
      );
      if (result.fileName) {
        deps.writeHtml(terminal, `<span class="system-info">Updated: ${deps.escapeHtml(result.fileName)}</span>`);
      }
      return;
    }

    case "add": {
      const target = args[1];
      const note = args.slice(2).join(" ");
      if (!target || !note.trim()) {
        deps.writeHtml(terminal, `<span class="system-info">Usage: /landing add &lt;agents|soul|memory&gt; &lt;text&gt;</span>`);
        return;
      }
      const result = await window.terminalAPI.landingAdd(target, note);
      if (!result.success) {
        deps.writeHtml(terminal, `<span class="system-error">[err] ${deps.escapeHtml(result.error || "Failed to append landing note")}</span>`);
        return;
      }
      deps.writeHtml(
        terminal,
        `<span class="system-ok">[ok] Added note to ${deps.escapeHtml(result.fileName || target)}</span>`,
      );
      return;
    }

    default: {
      deps.writeHtml(
        terminal,
        `<span class="system-warn">[warn] Unknown /landing action: ${deps.escapeHtml(action)}</span>`,
      );
      deps.writeHtml(terminal, `<span class="system-info">Use /landing help for usage.</span>`);
    }
  }
}
