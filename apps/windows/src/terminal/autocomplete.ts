export type TerminalAutocompleteState = {
  before: string;
  after: string;
  candidates: string[];
  index: number;
};

export type ResolveTerminalAutocompleteRequest = {
  input: string;
  cursorPos: number;
  isWindows: boolean;
  previousState?: TerminalAutocompleteState | null;
};

export type ResolveTerminalAutocompleteResult = {
  value: string;
  cursorPos: number;
  didComplete: boolean;
  state: TerminalAutocompleteState | null;
};

type CompletionPlan = {
  replaceStart: number;
  replaceEnd: number;
  before: string;
  after: string;
  candidates: string[];
};

const TOP_LEVEL_SLASH_COMMANDS = [
  "help",
  "?",
  "clear",
  "cls",
  "status",
  "config",
  "landing",
  "agent",
  "session",
  "whoami",
  "env",
  "environment",
  "echo",
  "date",
  "time",
  "history",
  "connect",
  "disconnect",
  "spawn",
  "agents",
  "tasks",
  "task",
  "orchestral",
  "orch",
  "context",
  "review",
  "pattern",
  "pr",
  "workflow",
  "test-agent-output",
] as const;

const COMMAND_SUBCOMMANDS: Record<string, readonly string[]> = {
  "/session": ["new", "list"],
  "/history": ["clear"],
  "/agents": ["list", "kill"],
  "/tasks": ["clear", "show"],
  "/context": ["list", "search", "load", "clear", "summary"],
  "/review": ["diff", "status"],
  "/pattern": ["help", "list", "save", "apply", "rate"],
  "/task": ["help", "complete", "list", "status"],
  "/pr": ["help", "create", "list", "status", "view"],
  "/workflow": ["help", "list", "create", "run", "show", "delete"],
  "/config": ["help", "show", "set", "apply", "validate", "reset", "path"],
  "/landing": ["help", "status", "init", "start", "set", "add"],
} as const;

const CONFIG_SET_KEYS = [
  "ai.defaultProvider",
  "ai.providers.openai.apiKey",
  "ai.providers.openai.baseUrl",
  "ai.providers.openai.model",
  "ai.providers.openai.maxTokens",
  "ai.providers.anthropic.apiKey",
  "ai.providers.anthropic.baseUrl",
  "ai.providers.anthropic.model",
  "ai.providers.anthropic.maxTokens",
  "ai.providers.google.apiKey",
  "ai.providers.google.baseUrl",
  "ai.providers.google.model",
  "ai.providers.google.maxTokens",
  "workspace.path",
  "workspace.autoCreate",
  "gateway.port",
  "gateway.autoStart",
  "ui.theme",
] as const;

const LANDING_SET_KEYS = [
  "identity.name",
  "identity.creature",
  "identity.vibe",
  "identity.emoji",
  "identity.avatar",
  "user.name",
  "user.preferredName",
  "user.pronouns",
  "user.timezone",
  "user.language",
] as const;

const LANDING_ADD_TARGETS = ["agents", "soul", "memory"] as const;
const AGENT_NAMES = ["main", "claude", "gpt", "local"] as const;
const PROVIDER_NAMES = ["openai", "anthropic", "google"] as const;
const BOOLEAN_VALUES = ["true", "false"] as const;
const FLAG_VALUES = ["--all"] as const;

const SHELL_COMMANDS_WINDOWS = [
  "dir", "ls", "cd", "pwd", "cls", "echo", "type", "cat", "del", "rm",
  "copy", "cp", "move", "mv", "mkdir", "md", "rmdir", "rd",
  "git", "npm", "pnpm", "node", "python", "python3", "pip",
] as const;

const SHELL_COMMANDS_UNIX = [
  "ls", "cd", "pwd", "clear", "echo", "cat", "less", "more", "head", "tail",
  "grep", "find", "rm", "cp", "mv", "mkdir", "rmdir", "chmod", "chown",
  "git", "npm", "pnpm", "node", "python", "python3", "pip", "curl", "wget",
  "ssh", "vim", "nano", "top", "htop", "ps", "kill", "df", "du",
] as const;

function clampCursor(input: string, cursorPos: number): number {
  if (!Number.isFinite(cursorPos)) {
    return input.length;
  }
  return Math.max(0, Math.min(input.length, Math.floor(cursorPos)));
}

function uniqueOrdered(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function filterByPrefix(candidates: readonly string[], prefix: string): string[] {
  const normalizedPrefix = prefix.toLowerCase();
  return candidates.filter((candidate) =>
    candidate.toLowerCase().startsWith(normalizedPrefix)
  );
}

function tokenRangeAtCursor(input: string, cursorPos: number): {
  start: number;
  end: number;
  token: string;
} {
  const safeCursor = clampCursor(input, cursorPos);
  const beforeCursor = input.slice(0, safeCursor);
  const afterCursor = input.slice(safeCursor);
  const leftToken = beforeCursor.match(/\S+$/)?.[0] ?? "";
  const rightToken = afterCursor.match(/^\S+/)?.[0] ?? "";
  const start = safeCursor - leftToken.length;
  const end = safeCursor + rightToken.length;
  return {
    start,
    end,
    token: input.slice(start, end),
  };
}

function shouldCycleFromState(
  input: string,
  cursorPos: number,
  state: TerminalAutocompleteState | null | undefined,
): state is TerminalAutocompleteState {
  if (!state || state.candidates.length < 2) {
    return false;
  }
  if (!input.startsWith(state.before) || !input.endsWith(state.after)) {
    return false;
  }
  const suffixLength = state.after.length;
  const current = input.slice(
    state.before.length,
    suffixLength > 0 ? input.length - suffixLength : undefined,
  );
  if (!state.candidates.includes(current)) {
    return false;
  }
  const expectedCursor = state.before.length + current.length;
  return cursorPos === expectedCursor;
}

function buildTopLevelSlashCommands(): string[] {
  return TOP_LEVEL_SLASH_COMMANDS.map((command) => `/${command}`);
}

function getCommandArgumentCandidates(
  command: string,
  tokensBeforeCursor: string[],
  argIndex: number,
): readonly string[] {
  const action = tokensBeforeCursor[1]?.toLowerCase() ?? "";

  if (command === "/config") {
    if (argIndex === 1) {
      return COMMAND_SUBCOMMANDS[command] ?? [];
    }
    if (action === "set" && argIndex === 2) {
      return CONFIG_SET_KEYS;
    }
    if (action === "set" && argIndex === 3) {
      const key = tokensBeforeCursor[2] ?? "";
      if (key === "ai.defaultProvider") {
        return PROVIDER_NAMES;
      }
      if (key === "workspace.autoCreate" || key === "gateway.autoStart") {
        return BOOLEAN_VALUES;
      }
      return [];
    }
    return [];
  }

  if (command === "/landing") {
    if (argIndex === 1) {
      return COMMAND_SUBCOMMANDS[command] ?? [];
    }
    if (action === "set" && argIndex === 2) {
      return LANDING_SET_KEYS;
    }
    if (action === "add" && argIndex === 2) {
      return LANDING_ADD_TARGETS;
    }
    return [];
  }

  if (command === "/agent" && argIndex === 1) {
    return AGENT_NAMES;
  }

  if (command === "/agents" && action === "kill" && argIndex === 2) {
    return FLAG_VALUES;
  }

  if (command === "/tasks" && action === "show" && argIndex === 2) {
    return FLAG_VALUES;
  }

  return COMMAND_SUBCOMMANDS[command] ?? [];
}

function buildSlashPlan(input: string, cursorPos: number): CompletionPlan | null {
  const safeCursor = clampCursor(input, cursorPos);
  const beforeCursor = input.slice(0, safeCursor);
  const tokenRange = tokenRangeAtCursor(input, safeCursor);
  const endsWithWhitespace = /\s$/.test(beforeCursor);
  const tokensBeforeCursor =
    beforeCursor.trim().length > 0 ? beforeCursor.trim().split(/\s+/) : [];
  const commandToken = tokensBeforeCursor[0] ?? "";

  if (tokenRange.token.startsWith("/")) {
    const candidates = filterByPrefix(buildTopLevelSlashCommands(), tokenRange.token);
    if (candidates.length === 0) {
      return null;
    }
    return {
      replaceStart: tokenRange.start,
      replaceEnd: tokenRange.end,
      before: input.slice(0, tokenRange.start),
      after: input.slice(tokenRange.end),
      candidates,
    };
  }

  if (!commandToken.startsWith("/")) {
    return null;
  }

  const normalizedCommand = commandToken.toLowerCase();
  const argIndex = endsWithWhitespace ? tokensBeforeCursor.length : tokensBeforeCursor.length - 1;
  if (argIndex <= 0) {
    return null;
  }

  const currentPrefix = endsWithWhitespace
    ? ""
    : (tokensBeforeCursor[tokensBeforeCursor.length - 1] ?? "");
  const candidates = filterByPrefix(
    getCommandArgumentCandidates(normalizedCommand, tokensBeforeCursor, argIndex),
    currentPrefix,
  );
  if (candidates.length === 0) {
    return null;
  }

  return {
    replaceStart: tokenRange.start,
    replaceEnd: tokenRange.end,
    before: input.slice(0, tokenRange.start),
    after: input.slice(tokenRange.end),
    candidates,
  };
}

function buildShellPlan(
  input: string,
  cursorPos: number,
  isWindows: boolean,
): CompletionPlan | null {
  const safeCursor = clampCursor(input, cursorPos);
  const tokenRange = tokenRangeAtCursor(input, safeCursor);
  if (!tokenRange.token.startsWith("!")) {
    return null;
  }

  const shellCandidates = isWindows ? SHELL_COMMANDS_WINDOWS : SHELL_COMMANDS_UNIX;
  const prefix = tokenRange.token.slice(1);
  const commands = filterByPrefix(shellCandidates, prefix).map((candidate) => `!${candidate}`);
  const candidates = uniqueOrdered(commands);
  if (candidates.length === 0) {
    return null;
  }

  return {
    replaceStart: tokenRange.start,
    replaceEnd: tokenRange.end,
    before: input.slice(0, tokenRange.start),
    after: input.slice(tokenRange.end),
    candidates,
  };
}

function buildCompletionPlan(
  input: string,
  cursorPos: number,
  isWindows: boolean,
): CompletionPlan | null {
  return buildSlashPlan(input, cursorPos) ?? buildShellPlan(input, cursorPos, isWindows);
}

function applyCandidate(
  before: string,
  candidate: string,
  after: string,
  appendTrailingSpace: boolean,
): { value: string; cursorPos: number } {
  const trailingSpace = appendTrailingSpace ? " " : "";
  const value = `${before}${candidate}${trailingSpace}${after}`;
  const cursorPos = before.length + candidate.length + trailingSpace.length;
  return { value, cursorPos };
}

export function resolveTerminalAutocomplete(
  request: ResolveTerminalAutocompleteRequest,
): ResolveTerminalAutocompleteResult {
  const safeCursor = clampCursor(request.input, request.cursorPos);
  if (shouldCycleFromState(request.input, safeCursor, request.previousState)) {
    const nextIndex = (request.previousState.index + 1) % request.previousState.candidates.length;
    const candidate = request.previousState.candidates[nextIndex];
    const applied = applyCandidate(
      request.previousState.before,
      candidate,
      request.previousState.after,
      false,
    );
    return {
      ...applied,
      didComplete: true,
      state: {
        ...request.previousState,
        index: nextIndex,
      },
    };
  }

  const plan = buildCompletionPlan(request.input, safeCursor, request.isWindows);
  if (!plan || plan.candidates.length === 0) {
    return {
      value: request.input,
      cursorPos: safeCursor,
      didComplete: false,
      state: null,
    };
  }

  const candidate = plan.candidates[0];
  const appendTrailingSpace = plan.candidates.length === 1 && plan.after.length === 0;
  const applied = applyCandidate(plan.before, candidate, plan.after, appendTrailingSpace);

  return {
    ...applied,
    didComplete: true,
    state:
      plan.candidates.length > 1
        ? {
            before: plan.before,
            after: plan.after,
            candidates: plan.candidates,
            index: 0,
          }
        : null,
  };
}
