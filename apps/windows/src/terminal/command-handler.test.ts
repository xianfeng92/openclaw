import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handleSpawnCommandMock = vi.fn();
const handleAgentsCommandMock = vi.fn();
const handleTasksCommandMock = vi.fn();
const showOrchestralHelpMock = vi.fn();

vi.mock("./orchestral-commands.js", () => ({
  handleSpawnCommand: handleSpawnCommandMock,
  handleAgentsCommand: handleAgentsCommandMock,
  handleTasksCommand: handleTasksCommandMock,
  showOrchestralHelp: showOrchestralHelpMock,
}));

type TerminalApiMock = {
  orchestralTasks: ReturnType<typeof vi.fn>;
  patternRate: ReturnType<typeof vi.fn>;
  patternSave: ReturnType<typeof vi.fn>;
  landingInit: ReturnType<typeof vi.fn>;
  landingSet: ReturnType<typeof vi.fn>;
  landingAdd: ReturnType<typeof vi.fn>;
  landingStatus: ReturnType<typeof vi.fn>;
  landingWizardSave: ReturnType<typeof vi.fn>;
  landingWizardClear: ReturnType<typeof vi.fn>;
  getGatewayInfo: ReturnType<typeof vi.fn>;
  getGatewayAuthSync: ReturnType<typeof vi.fn>;
};

type CommandHandlerModule = typeof import("./command-handler.js");

class MockElement {
  className = "";
  innerHTML = "";
  children: MockElement[] = [];
  scrollTop = 0;
  scrollHeight = 0;
  private value = "";

  constructor(readonly tagName: string) {}

  set textContent(input: string) {
    this.value = input;
    this.innerHTML = escapeHtml(input);
  }

  get textContent(): string {
    return this.value;
  }

  appendChild(node: MockElement): MockElement {
    this.children.push(node);
    this.scrollHeight = this.children.length;
    return node;
  }

  insertBefore(node: MockElement, before: MockElement | null): MockElement {
    if (!before) {
      return this.appendChild(node);
    }
    const index = this.children.indexOf(before);
    if (index < 0) {
      return this.appendChild(node);
    }
    this.children.splice(index, 0, node);
    this.scrollHeight = this.children.length;
    return node;
  }

  querySelector(selector: string): MockElement | null {
    if (selector !== ".input-line") {
      return null;
    }
    return (
      this.children.find((child) => child.className.split(/\s+/u).includes("input-line")) ?? null
    );
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function createTerminalRoot(): MockElement {
  const terminal = new MockElement("div");
  const inputLine = new MockElement("div");
  inputLine.className = "input-line";
  terminal.appendChild(inputLine);
  return terminal;
}

function collectOutputLines(terminal: MockElement): string[] {
  return terminal.children
    .filter((child) => !child.className.split(/\s+/u).includes("input-line"))
    .map((child) => child.textContent || child.innerHTML);
}

function createTerminalApiMock(
  overrides: Partial<TerminalApiMock> = {},
): TerminalApiMock {
  return {
    orchestralTasks: overrides.orchestralTasks ?? vi.fn(async () => ({ success: true, tasks: [] })),
    patternRate: overrides.patternRate ?? vi.fn(async () => ({ success: true })),
    patternSave: overrides.patternSave ?? vi.fn(async () => ({ success: true, id: "pattern-1" })),
    landingInit:
      overrides.landingInit ??
      vi.fn(async () => ({
        success: true,
        configPath: "C:/mock/cydeck.json",
        stateDir: "C:/mock/state",
        workspacePath: "C:/mock/workspace",
        files: [],
        created: [],
        existing: [],
      })),
    landingSet:
      overrides.landingSet ??
      vi.fn(async (key: string, value: string) => ({
        success: true,
        key,
        value,
        workspacePath: "C:/mock/workspace",
      })),
    landingAdd:
      overrides.landingAdd ??
      vi.fn(async (target: string, note: string) => ({
        success: true,
        target,
        note,
        fileName: `${target}.md`,
        workspacePath: "C:/mock/workspace",
      })),
    landingStatus:
      overrides.landingStatus ??
      vi.fn(async () => ({
        success: true,
        workspacePath: "C:/mock/workspace",
        completed: true,
        files: [],
      })),
    landingWizardSave:
      overrides.landingWizardSave ??
      vi.fn(async () => ({
        success: true,
        workspacePath: "C:/mock/workspace",
        completed: false,
        nextStepIndex: 0,
        wizardStepIndex: 0,
      })),
    landingWizardClear:
      overrides.landingWizardClear ??
      vi.fn(async () => ({
        success: true,
        workspacePath: "C:/mock/workspace",
        completed: false,
        nextStepIndex: 0,
      })),
    getGatewayInfo: overrides.getGatewayInfo ?? vi.fn(async () => ({ port: 18789 })),
    getGatewayAuthSync: overrides.getGatewayAuthSync ?? vi.fn(() => null),
  };
}

function installDomGlobals(api: TerminalApiMock): void {
  const documentMock = {
    createElement: (tagName: string) => new MockElement(tagName),
  };

  Object.assign(globalThis, {
    document: documentMock,
    window: {
      terminalAPI: {
        ...api,
        execShell: vi.fn(),
        onShellOutput: vi.fn(() => () => {}),
      },
      setInterval,
      clearInterval,
    },
  });
}

async function loadCommandHandlerModule(): Promise<CommandHandlerModule> {
  vi.resetModules();
  return await import("./command-handler.js");
}

describe("command-handler task/session/history command flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "document");
    Reflect.deleteProperty(globalThis, "window");
  });

  it("lists known sessions and marks current session for /session list", async () => {
    const api = createTerminalApiMock();
    installDomGlobals(api);
    const commandHandler = await loadCommandHandlerModule();
    const terminal = createTerminalRoot();

    await commandHandler.handleCommand(
      terminal as unknown as HTMLElement,
      "/session project-alpha",
    );
    await commandHandler.handleCommand(terminal as unknown as HTMLElement, "/session list");

    const lines = collectOutputLines(terminal);
    expect(lines).toContain("Known sessions:");
    expect(lines).toContain("* project-alpha");
    expect(lines).toContain("- default");
  });

  it("runs history clear hook and renders cleared count", async () => {
    const api = createTerminalApiMock();
    installDomGlobals(api);
    const commandHandler = await loadCommandHandlerModule();
    const terminal = createTerminalRoot();
    const clearHistory = vi.fn(() => 3);

    commandHandler.registerTerminalCommandRuntimeHooks({
      clearHistory,
      listHistory: vi.fn(() => ["one", "two", "three"]),
    });

    await commandHandler.handleCommand(terminal as unknown as HTMLElement, "/history clear");

    const lines = collectOutputLines(terminal);
    expect(clearHistory).toHaveBeenCalledTimes(1);
    expect(lines).toContain("History cleared (3 entries).");
  });

  it("defaults /task complete status to success when omitted", async () => {
    const orchestralTasks = vi.fn(async () => ({ success: true }));
    const api = createTerminalApiMock({ orchestralTasks });
    installDomGlobals(api);
    const commandHandler = await loadCommandHandlerModule();
    const terminal = createTerminalRoot();

    await commandHandler.handleCommand(terminal as unknown as HTMLElement, "/task complete task-123");

    expect(orchestralTasks).toHaveBeenCalledWith(
      { taskId: "task-123", success: "true" },
      "complete",
    );
    const lines = collectOutputLines(terminal);
    expect(lines.some((line) => line.includes("marked as completed"))).toBe(true);
  });

  it("rejects invalid /task complete status values", async () => {
    const orchestralTasks = vi.fn(async () => ({ success: true }));
    const api = createTerminalApiMock({ orchestralTasks });
    installDomGlobals(api);
    const commandHandler = await loadCommandHandlerModule();
    const terminal = createTerminalRoot();

    await commandHandler.handleCommand(
      terminal as unknown as HTMLElement,
      "/task complete task-123 unknown",
    );

    expect(orchestralTasks).not.toHaveBeenCalled();
    const lines = collectOutputLines(terminal);
    expect(lines.some((line) => line.includes("Usage: /task complete"))).toBe(true);
  });

  it("delegates /task list to tasks command renderer", async () => {
    const api = createTerminalApiMock();
    installDomGlobals(api);
    const commandHandler = await loadCommandHandlerModule();
    const terminal = createTerminalRoot();

    await commandHandler.handleCommand(terminal as unknown as HTMLElement, "/task list");

    expect(handleTasksCommandMock).toHaveBeenCalledTimes(1);
  });

  it("renders /task status details from orchestral tasks payload", async () => {
    const orchestralTasks = vi.fn(async () => ({
      success: true,
      tasks: [
        {
          id: "task-9",
          status: "failed",
          description: "demo task",
          agent: "main",
          failureReason: "boom",
        },
      ],
    }));
    const api = createTerminalApiMock({ orchestralTasks });
    installDomGlobals(api);
    const commandHandler = await loadCommandHandlerModule();
    const terminal = createTerminalRoot();

    await commandHandler.handleCommand(terminal as unknown as HTMLElement, "/task status task-9");

    expect(orchestralTasks).toHaveBeenCalledWith({});
    const lines = collectOutputLines(terminal);
    expect(lines.some((line) => line.includes("Status: failed"))).toBe(true);
    expect(lines.some((line) => line.includes("Reason: boom"))).toBe(true);
  });

  it("starts landing wizard and shows step prompt", async () => {
    const landingInit = vi.fn(async () => ({
      success: true,
      workspacePath: "C:/workspace",
      files: [],
      nextStepIndex: 0,
    }));
    const landingWizardSave = vi.fn(async () => ({ success: true }));
    const api = createTerminalApiMock({ landingInit, landingWizardSave });
    installDomGlobals(api);
    const commandHandler = await loadCommandHandlerModule();
    const terminal = createTerminalRoot();

    await commandHandler.handleCommand(terminal as unknown as HTMLElement, "/landing start");

    expect(landingInit).toHaveBeenCalledTimes(1);
    expect(landingWizardSave).toHaveBeenCalledWith(0);
    const lines = collectOutputLines(terminal);
    expect(lines.some((line) => line.includes("Landing Wizard"))).toBe(true);
    expect(lines.some((line) => line.includes("Step 1/6"))).toBe(true);
    expect(lines.some((line) => line.includes("identity.name"))).toBe(true);
  });

  it("supports /landing start --reset and restarts from step 1", async () => {
    const landingInit = vi.fn(async () => ({
      success: true,
      workspacePath: "C:/workspace",
      files: [],
      nextStepIndex: 4,
      wizardStepIndex: 3,
    }));
    const landingWizardSave = vi.fn(async () => ({ success: true }));
    const landingWizardClear = vi.fn(async () => ({ success: true }));
    const api = createTerminalApiMock({ landingInit, landingWizardSave, landingWizardClear });
    installDomGlobals(api);
    const commandHandler = await loadCommandHandlerModule();
    const terminal = createTerminalRoot();

    await commandHandler.handleCommand(terminal as unknown as HTMLElement, "/landing start --reset");

    expect(landingWizardClear).toHaveBeenCalledTimes(1);
    expect(landingWizardSave).toHaveBeenCalledWith(0);
    const lines = collectOutputLines(terminal);
    expect(lines.some((line) => line.includes("Reset persisted wizard progress"))).toBe(true);
    expect(lines.some((line) => line.includes("Step 1/6"))).toBe(true);
  });

  it("auto-jumps /landing start to first missing step", async () => {
    const landingInit = vi.fn(async () => ({
      success: true,
      workspacePath: "C:/workspace",
      files: [],
      nextStepIndex: 3,
      wizardStepIndex: 2,
    }));
    const landingWizardSave = vi.fn(async () => ({ success: true }));
    const api = createTerminalApiMock({ landingInit, landingWizardSave });
    installDomGlobals(api);
    const commandHandler = await loadCommandHandlerModule();
    const terminal = createTerminalRoot();

    await commandHandler.handleCommand(terminal as unknown as HTMLElement, "/landing start");

    expect(landingWizardSave).toHaveBeenCalledWith(3);
    const lines = collectOutputLines(terminal);
    expect(lines.some((line) => line.includes("Auto-jump to first missing step 4/6"))).toBe(true);
    expect(lines.some((line) => line.includes("Step 4/6"))).toBe(true);
  });

  it("consumes plain message input for landing wizard steps without gateway connect", async () => {
    const landingSet = vi.fn(async (key: string, value: string) => ({
      success: true,
      key,
      value,
      workspacePath: "C:/workspace",
    }));
    const getGatewayInfo = vi.fn(async () => ({ port: 18789 }));
    const api = createTerminalApiMock({ landingSet, getGatewayInfo });
    installDomGlobals(api);
    const commandHandler = await loadCommandHandlerModule();
    const terminal = createTerminalRoot();

    await commandHandler.handleCommand(terminal as unknown as HTMLElement, "/landing start");
    await commandHandler.handleCommand(terminal as unknown as HTMLElement, "CyDeck");

    expect(landingSet).toHaveBeenCalledWith("identity.name", "CyDeck");
    expect(getGatewayInfo).not.toHaveBeenCalled();
    const lines = collectOutputLines(terminal);
    expect(lines.some((line) => line.includes("Step 2/6"))).toBe(true);
  });

  it("completes full landing wizard flow and runs final status check", async () => {
    const landingSet = vi.fn(async (key: string, value: string) => ({ success: true, key, value }));
    const landingAdd = vi.fn(async (target: string, note: string) => ({ success: true, target, note }));
    const landingStatus = vi.fn(async () => ({
      success: true,
      workspacePath: "C:/workspace",
      completed: true,
      files: [],
    }));
    const api = createTerminalApiMock({
      landingSet,
      landingAdd,
      landingStatus,
    });
    installDomGlobals(api);
    const commandHandler = await loadCommandHandlerModule();
    const terminal = createTerminalRoot();

    await commandHandler.handleCommand(terminal as unknown as HTMLElement, "/landing start");
    await commandHandler.handleCommand(terminal as unknown as HTMLElement, "CyDeck");
    await commandHandler.handleCommand(terminal as unknown as HTMLElement, "Peter");
    await commandHandler.handleCommand(terminal as unknown as HTMLElement, "Asia/Shanghai");
    await commandHandler.handleCommand(terminal as unknown as HTMLElement, "Be direct and evidence-driven");
    await commandHandler.handleCommand(terminal as unknown as HTMLElement, "Ask before external side effects");
    await commandHandler.handleCommand(terminal as unknown as HTMLElement, "User prefers concise replies in Chinese");

    expect(landingSet).toHaveBeenNthCalledWith(1, "identity.name", "CyDeck");
    expect(landingSet).toHaveBeenNthCalledWith(2, "user.name", "Peter");
    expect(landingSet).toHaveBeenNthCalledWith(3, "user.timezone", "Asia/Shanghai");
    expect(landingAdd).toHaveBeenNthCalledWith(1, "soul", "Be direct and evidence-driven");
    expect(landingAdd).toHaveBeenNthCalledWith(2, "agents", "Ask before external side effects");
    expect(landingAdd).toHaveBeenNthCalledWith(3, "memory", "User prefers concise replies in Chinese");
    expect(landingStatus).toHaveBeenCalledTimes(1);

    const lines = collectOutputLines(terminal);
    expect(lines.some((line) => line.includes("Landing Wizard Complete"))).toBe(true);
    expect(lines.some((line) => line.includes("Landing is complete"))).toBe(true);
  });

  it("supports landing wizard skip and cancel commands", async () => {
    const landingSet = vi.fn(async () => ({ success: true }));
    const landingWizardClear = vi.fn(async () => ({ success: true }));
    const api = createTerminalApiMock({ landingSet, landingWizardClear });
    installDomGlobals(api);
    const commandHandler = await loadCommandHandlerModule();
    const terminal = createTerminalRoot();

    await commandHandler.handleCommand(terminal as unknown as HTMLElement, "/landing start");
    await commandHandler.handleCommand(terminal as unknown as HTMLElement, "/landing skip");
    await commandHandler.handleCommand(terminal as unknown as HTMLElement, "/landing cancel");

    expect(landingSet).not.toHaveBeenCalled();
    expect(landingWizardClear).toHaveBeenCalledTimes(1);
    const lines = collectOutputLines(terminal);
    expect(lines.some((line) => line.includes("Skipped step 1/6"))).toBe(true);
    expect(lines.some((line) => line.includes("Landing wizard cancelled"))).toBe(true);
  });

  it("resumes landing wizard from persisted state when process restarts", async () => {
    const landingStatus = vi.fn(async () => ({
      success: true,
      workspacePath: "C:/workspace",
      files: [],
      completed: false,
      wizardStepIndex: 2,
      nextStepIndex: 4,
    }));
    const landingWizardSave = vi.fn(async () => ({ success: true }));
    const api = createTerminalApiMock({ landingStatus, landingWizardSave });
    installDomGlobals(api);
    const commandHandler = await loadCommandHandlerModule();
    const terminal = createTerminalRoot();

    await commandHandler.handleCommand(terminal as unknown as HTMLElement, "/landing resume");

    expect(landingStatus).toHaveBeenCalledTimes(1);
    expect(landingWizardSave).toHaveBeenCalledWith(4);
    const lines = collectOutputLines(terminal);
    expect(lines.some((line) => line.includes("Resumed persisted wizard state at step 5/6"))).toBe(true);
    expect(lines.some((line) => line.includes("Step 5/6"))).toBe(true);
  });

  it("restores wizard progress after module reload and resumes at next missing step", async () => {
    const firstLandingSet = vi.fn(async (key: string, value: string) => ({
      success: true,
      key,
      value,
      workspacePath: "C:/workspace",
    }));
    const firstLandingWizardSave = vi.fn(async () => ({ success: true }));
    const firstApi = createTerminalApiMock({
      landingInit: vi.fn(async () => ({
        success: true,
        workspacePath: "C:/workspace",
        files: [],
        nextStepIndex: 0,
      })),
      landingSet: firstLandingSet,
      landingWizardSave: firstLandingWizardSave,
    });

    installDomGlobals(firstApi);
    const commandHandlerBeforeRestart = await loadCommandHandlerModule();
    const terminalBeforeRestart = createTerminalRoot();
    await commandHandlerBeforeRestart.handleCommand(terminalBeforeRestart as unknown as HTMLElement, "/landing start");
    await commandHandlerBeforeRestart.handleCommand(terminalBeforeRestart as unknown as HTMLElement, "CyDeck");
    expect(firstLandingWizardSave).toHaveBeenCalledWith(1);

    const secondLandingStatus = vi.fn(async () => ({
      success: true,
      workspacePath: "C:/workspace",
      files: [],
      completed: false,
      wizardStepIndex: 1,
      nextStepIndex: 1,
    }));
    const secondLandingWizardSave = vi.fn(async () => ({ success: true }));
    const secondApi = createTerminalApiMock({
      landingStatus: secondLandingStatus,
      landingWizardSave: secondLandingWizardSave,
    });

    installDomGlobals(secondApi);
    const commandHandlerAfterRestart = await loadCommandHandlerModule();
    const terminalAfterRestart = createTerminalRoot();
    await commandHandlerAfterRestart.handleCommand(terminalAfterRestart as unknown as HTMLElement, "/landing resume");

    expect(secondLandingStatus).toHaveBeenCalledTimes(1);
    expect(secondLandingWizardSave).toHaveBeenCalledWith(1);
    const lines = collectOutputLines(terminalAfterRestart);
    expect(lines.some((line) => line.includes("Resumed persisted wizard state at step 2/6"))).toBe(true);
    expect(lines.some((line) => line.includes("Step 2/6"))).toBe(true);
  });

  it("shows actionable next-step hints in /landing status", async () => {
    const api = createTerminalApiMock({
      landingStatus: vi.fn(async () => ({
        success: true,
        workspacePath: "C:/workspace",
        files: [],
        completed: false,
        wizardStepIndex: 2,
        nextStepIndex: 3,
      })),
    });
    installDomGlobals(api);
    const commandHandler = await loadCommandHandlerModule();
    const terminal = createTerminalRoot();

    await commandHandler.handleCommand(terminal as unknown as HTMLElement, "/landing status");

    const lines = collectOutputLines(terminal);
    expect(lines.some((line) => line.includes("Next: /landing resume"))).toBe(true);
  });

  it("uses generated description for /pattern save when --desc is omitted", async () => {
    const patternSave = vi.fn(async () => ({ success: true, id: "pattern-42" }));
    const api = createTerminalApiMock({ patternSave });
    installDomGlobals(api);
    const commandHandler = await loadCommandHandlerModule();
    const terminal = createTerminalRoot();

    await commandHandler.handleCommand(
      terminal as unknown as HTMLElement,
      "/pattern save BugFixTemplate coding First understand expected behavior and constraints",
    );

    expect(patternSave).toHaveBeenCalledTimes(1);
    expect(patternSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "BugFixTemplate",
        category: "coding",
        prompt: "First understand expected behavior and constraints",
        description: "First understand expected behavior and constraints",
      }),
    );
  });

  it("uses explicit --desc value for /pattern save", async () => {
    const patternSave = vi.fn(async () => ({ success: true, id: "pattern-99" }));
    const api = createTerminalApiMock({ patternSave });
    installDomGlobals(api);
    const commandHandler = await loadCommandHandlerModule();
    const terminal = createTerminalRoot();

    await commandHandler.handleCommand(
      terminal as unknown as HTMLElement,
      "/pattern save BugFixTemplate coding First understand expected behavior --desc Login incident baseline",
    );

    expect(patternSave).toHaveBeenCalledTimes(1);
    expect(patternSave).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "First understand expected behavior",
        description: "Login incident baseline",
      }),
    );
  });
});
