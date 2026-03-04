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
  overrides: Partial<Pick<TerminalApiMock, "orchestralTasks" | "patternRate">> = {},
): TerminalApiMock {
  return {
    orchestralTasks: overrides.orchestralTasks ?? vi.fn(async () => ({ success: true, tasks: [] })),
    patternRate: overrides.patternRate ?? vi.fn(async () => ({ success: true })),
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
        getGatewayInfo: vi.fn(async () => ({ port: 18789 })),
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
});
