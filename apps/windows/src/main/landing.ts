import fs from "node:fs";
import path from "node:path";

export type LandingFileId = "agents" | "soul" | "identity" | "user" | "memory";
export type LandingAppendTarget = "agents" | "soul" | "memory";

export type LandingSetKey =
  | "identity.name"
  | "identity.creature"
  | "identity.vibe"
  | "identity.emoji"
  | "identity.avatar"
  | "user.name"
  | "user.preferredName"
  | "user.pronouns"
  | "user.timezone"
  | "user.language";

export type LandingFileStatus = {
  id: LandingFileId;
  fileName: string;
  path: string;
  exists: boolean;
  bytes: number;
  configured: boolean;
};

export type LandingPromptFile = {
  id: LandingFileId;
  fileName: string;
  missing: boolean;
  content: string;
};

export type LandingWizardProgress = {
  workspacePath: string;
  stepIndex: number;
  updatedAt: string;
};

const LANDING_PROMPT_MAX_CHARS = 20_000;
const LANDING_WIZARD_STATE_FILE = "landing-wizard-state.json";
const LANDING_WIZARD_TOTAL_STEPS = 6;

type LandingFieldTarget = {
  fileId: LandingFileId;
  label: string;
};

const LANDING_FILE_NAMES: Record<LandingFileId, string> = {
  agents: "AGENTS.md",
  soul: "SOUL.md",
  identity: "IDENTITY.md",
  user: "USER.md",
  memory: "MEMORY.md",
};

const LANDING_FIELD_TARGETS: Record<LandingSetKey, LandingFieldTarget> = {
  "identity.name": { fileId: "identity", label: "Name" },
  "identity.creature": { fileId: "identity", label: "Creature" },
  "identity.vibe": { fileId: "identity", label: "Vibe" },
  "identity.emoji": { fileId: "identity", label: "Emoji" },
  "identity.avatar": { fileId: "identity", label: "Avatar" },
  "user.name": { fileId: "user", label: "Name" },
  "user.preferredName": { fileId: "user", label: "Preferred Name" },
  "user.pronouns": { fileId: "user", label: "Pronouns" },
  "user.timezone": { fileId: "user", label: "Timezone" },
  "user.language": { fileId: "user", label: "Language" },
};

const LANDING_TEMPLATES: Record<LandingFileId, string> = {
  agents: `# AGENTS.md

## Session Start

1. Read SOUL.md
2. Read IDENTITY.md
3. Read USER.md
4. Read memory logs when needed
5. Load MEMORY.md only in private main/direct sessions

## Operating Rules

- Keep replies concise and actionable.
- Ask before external side effects.
- Protect user privacy and secrets.

## Notes
`,
  soul: `# SOUL.md

## Mission

- Deliver direct, useful, and trustworthy help.

## Core Values

- Clarity over flourish.
- Pragmatism over ceremony.
- Rigor over guesswork.

## Response Contract

- Lead with the answer, then provide supporting detail.
- State assumptions when certainty is limited.
- Surface risks and next actions explicitly.

## Safety Boundaries

- Never expose secrets or private data.
- Ask before destructive or external side effects.
- Prefer verification over confident speculation.

## Session Directives
`,
  identity: `# IDENTITY.md

- Name:
- Creature:
- Vibe:
- Emoji:
- Avatar:
`,
  user: `# USER.md

- Name:
- Preferred Name:
- Pronouns:
- Timezone:
- Language:

## Notes
`,
  memory: `# MEMORY.md

## Long-term Facts
`,
};

const LANDING_FILE_ORDER: LandingFileId[] = ["agents", "soul", "identity", "user", "memory"];
const LANDING_APPEND_HEADINGS: Record<LandingAppendTarget, string> = {
  agents: "Operating Rules",
  soul: "Session Directives",
  memory: "Long-term Facts",
};

export function resolveLandingFilePath(workspacePath: string, fileId: LandingFileId): string {
  return path.join(workspacePath, LANDING_FILE_NAMES[fileId]);
}

export function isLandingSetKey(value: string): value is LandingSetKey {
  return Object.hasOwn(LANDING_FIELD_TARGETS, value);
}

export function isLandingAppendTarget(value: string): value is LandingAppendTarget {
  return value === "agents" || value === "soul" || value === "memory";
}

export function ensureLandingWorkspaceFiles(workspacePath: string): {
  created: string[];
  existing: string[];
} {
  fs.mkdirSync(workspacePath, { recursive: true });
  fs.mkdirSync(path.join(workspacePath, "memory"), { recursive: true });

  const created: string[] = [];
  const existing: string[] = [];

  for (const fileId of LANDING_FILE_ORDER) {
    const fileName = LANDING_FILE_NAMES[fileId];
    const filePath = resolveLandingFilePath(workspacePath, fileId);
    if (fs.existsSync(filePath)) {
      existing.push(fileName);
      continue;
    }
    fs.writeFileSync(filePath, LANDING_TEMPLATES[fileId], "utf-8");
    created.push(fileName);
  }

  return { created, existing };
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function trimForPrompt(content: string, fileName: string): string {
  const text = content.trimEnd();
  if (text.length <= LANDING_PROMPT_MAX_CHARS) {
    return text;
  }
  const headChars = Math.floor(LANDING_PROMPT_MAX_CHARS * 0.7);
  const tailChars = Math.floor(LANDING_PROMPT_MAX_CHARS * 0.2);
  const head = text.slice(0, headChars);
  const tail = text.slice(-tailChars);
  return [
    head,
    "",
    `[...truncated, read ${fileName} for full content...]`,
    "",
    tail,
  ].join("\n");
}

export function isPrivateLandingSession(sessionKey?: string): boolean {
  const key = (sessionKey ?? "").trim().toLowerCase();
  if (!key) {
    return true;
  }
  if (key === "default" || key === "main" || key === "direct") {
    return true;
  }
  const nonPrivateMarkers = ["group", "channel", "subagent", "cron"];
  for (const marker of nonPrivateMarkers) {
    const pattern = new RegExp(`(^|:)${marker}(:|$)`, "i");
    if (pattern.test(key)) {
      return false;
    }
  }
  return true;
}

function resolveLandingPromptFileIds(sessionKey?: string): LandingFileId[] {
  const base: LandingFileId[] = ["agents", "soul", "identity", "user"];
  if (isPrivateLandingSession(sessionKey)) {
    base.push("memory");
  }
  return base;
}

export function loadLandingPromptFiles(
  workspacePath: string,
  sessionKey?: string,
): LandingPromptFile[] {
  const fileIds = resolveLandingPromptFileIds(sessionKey);
  return fileIds.map((fileId) => {
    const fileName = LANDING_FILE_NAMES[fileId];
    const filePath = resolveLandingFilePath(workspacePath, fileId);
    if (!fs.existsSync(filePath)) {
      return {
        id: fileId,
        fileName,
        missing: true,
        content: `[MISSING] Expected at: ${filePath}`,
      };
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    return {
      id: fileId,
      fileName,
      missing: false,
      content: trimForPrompt(raw, fileName),
    };
  });
}

export function buildLandingSystemPrompt(workspacePath: string, sessionKey?: string): string | null {
  const files = loadLandingPromptFiles(workspacePath, sessionKey);
  const lines: string[] = [
    "CyDeck landing context is loaded from workspace files.",
    "Apply these instructions unless higher-priority policy overrides them.",
    "",
    `Workspace: ${workspacePath}`,
    `Session privacy: ${isPrivateLandingSession(sessionKey) ? "private(main/direct)" : "shared(group/channel/subagent/cron)"}`,
    "",
    "## Workspace Files",
  ];

  for (const file of files) {
    if (!file.content.trim()) {
      continue;
    }
    lines.push(`### ${file.fileName}`, "", file.content, "");
  }

  const prompt = lines.join("\n").trim();
  return prompt.length > 0 ? prompt : null;
}

function isConfiguredFile(fileId: LandingFileId, content: string): boolean {
  const normalized = normalizeText(content);
  if (!normalized) {
    return false;
  }

  const template = normalizeText(LANDING_TEMPLATES[fileId]);
  if (normalized === template) {
    return false;
  }

  if (fileId === "identity") {
    return /-\s*Name:\s*\S+/i.test(content) || /-\s*Emoji:\s*\S+/i.test(content);
  }
  if (fileId === "user") {
    return /-\s*Name:\s*\S+/i.test(content) || /-\s*Preferred Name:\s*\S+/i.test(content);
  }
  return true;
}

export function getLandingWorkspaceStatus(workspacePath: string): {
  files: LandingFileStatus[];
  completed: boolean;
} {
  const files: LandingFileStatus[] = LANDING_FILE_ORDER.map((fileId) => {
    const fileName = LANDING_FILE_NAMES[fileId];
    const filePath = resolveLandingFilePath(workspacePath, fileId);
    if (!fs.existsSync(filePath)) {
      return {
        id: fileId,
        fileName,
        path: filePath,
        exists: false,
        bytes: 0,
        configured: false,
      };
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const bytes = Buffer.byteLength(content, "utf-8");
    return {
      id: fileId,
      fileName,
      path: filePath,
      exists: true,
      bytes,
      configured: isConfiguredFile(fileId, content),
    };
  });

  const completed = files.every((file) => file.exists && file.configured);
  return { files, completed };
}

function clampLandingWizardStepIndex(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const normalized = Math.floor(value);
  if (normalized < 0) {
    return 0;
  }
  if (normalized > LANDING_WIZARD_TOTAL_STEPS) {
    return LANDING_WIZARD_TOTAL_STEPS;
  }
  return normalized;
}

function hasMarkdownFieldValue(content: string, label: string): boolean {
  const escaped = escapeRegex(label);
  const pattern = new RegExp(
    `^[ \\t]*-[ \\t]*(?:\\*\\*)?${escaped}(?:\\*\\*)?[ \\t]*:[ \\t]*(.*)$`,
    "im",
  );
  const match = content.match(pattern);
  if (!match) {
    return false;
  }
  return match[1].trim().length > 0;
}

function readLandingFileIfExists(workspacePath: string, fileId: LandingFileId): string | null {
  const filePath = resolveLandingFilePath(workspacePath, fileId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, "utf-8");
}

export function getLandingWizardNextStepIndex(workspacePath: string): number {
  const identity = readLandingFileIfExists(workspacePath, "identity");
  if (!identity || !hasMarkdownFieldValue(identity, "Name")) {
    return 0;
  }

  const user = readLandingFileIfExists(workspacePath, "user");
  if (!user || !hasMarkdownFieldValue(user, "Name")) {
    return 1;
  }
  if (!hasMarkdownFieldValue(user, "Timezone")) {
    return 2;
  }

  const soul = readLandingFileIfExists(workspacePath, "soul");
  if (!soul || !isConfiguredFile("soul", soul)) {
    return 3;
  }

  const agents = readLandingFileIfExists(workspacePath, "agents");
  if (!agents || !isConfiguredFile("agents", agents)) {
    return 4;
  }

  const memory = readLandingFileIfExists(workspacePath, "memory");
  if (!memory || !isConfiguredFile("memory", memory)) {
    return 5;
  }

  return LANDING_WIZARD_TOTAL_STEPS;
}

function resolveLandingWizardStatePath(stateDir: string): string {
  return path.join(stateDir, LANDING_WIZARD_STATE_FILE);
}

export function loadLandingWizardProgress(stateDir: string): LandingWizardProgress | null {
  const statePath = resolveLandingWizardStatePath(stateDir);
  if (!fs.existsSync(statePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(statePath, "utf-8");
    if (!raw.trim()) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const workspacePath =
      typeof record.workspacePath === "string" ? record.workspacePath.trim() : "";
    if (!workspacePath) {
      return null;
    }
    const stepIndex = clampLandingWizardStepIndex(
      typeof record.stepIndex === "number" ? record.stepIndex : 0,
    );
    const updatedAt =
      typeof record.updatedAt === "string" && record.updatedAt.trim()
        ? record.updatedAt
        : new Date(0).toISOString();
    return {
      workspacePath,
      stepIndex,
      updatedAt,
    };
  } catch {
    return null;
  }
}

export function saveLandingWizardProgress(
  stateDir: string,
  workspacePath: string,
  stepIndex: number,
): LandingWizardProgress {
  const normalizedWorkspacePath = workspacePath.trim();
  if (!normalizedWorkspacePath) {
    throw new Error("Workspace path cannot be empty");
  }
  const progress: LandingWizardProgress = {
    workspacePath: normalizedWorkspacePath,
    stepIndex: clampLandingWizardStepIndex(stepIndex),
    updatedAt: new Date().toISOString(),
  };
  const statePath = resolveLandingWizardStatePath(stateDir);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(progress, null, 2)}\n`, "utf-8");
  return progress;
}

export function clearLandingWizardProgress(stateDir: string): void {
  const statePath = resolveLandingWizardStatePath(stateDir);
  if (!fs.existsSync(statePath)) {
    return;
  }
  fs.rmSync(statePath, { force: true });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function upsertMarkdownField(content: string, label: string, value: string): string {
  const escaped = escapeRegex(label);
  const regex = new RegExp(
    `^[ \\t]*-[ \\t]*(?:\\*\\*)?${escaped}(?:\\*\\*)?[ \\t]*:.*$`,
    "im",
  );
  if (regex.test(content)) {
    return content.replace(regex, `- ${label}: ${value}`);
  }
  const suffix = content.endsWith("\n") ? "" : "\n";
  return `${content}${suffix}- ${label}: ${value}\n`;
}

function appendMarkdownListItemToHeading(content: string, heading: string, value: string): string {
  const lineBreak = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/u);
  const normalizedHeading = heading.trim().toLowerCase();

  let headingIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim().startsWith("##")) {
      continue;
    }
    const title = line.trim().replace(/^##+\s*/u, "").trim().toLowerCase();
    if (title === normalizedHeading) {
      headingIndex = index;
      break;
    }
  }

  if (headingIndex < 0) {
    const suffix = content.endsWith("\n") || content.endsWith("\r\n") ? "" : lineBreak;
    return `${content}${suffix}- ${value}${lineBreak}`;
  }

  let insertIndex = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (lines[index].trim().startsWith("##")) {
      insertIndex = index;
      break;
    }
  }
  while (insertIndex > headingIndex + 1 && lines[insertIndex - 1].trim() === "") {
    insertIndex -= 1;
  }

  const updated = [...lines];
  if (insertIndex > headingIndex + 1 && updated[insertIndex - 1].trim() !== "") {
    updated.splice(insertIndex, 0, "");
    insertIndex += 1;
  }
  updated.splice(insertIndex, 0, `- ${value}`);
  return updated.join(lineBreak);
}

function readLandingFileWithTemplate(workspacePath: string, fileId: LandingFileId): {
  filePath: string;
  content: string;
} {
  const filePath = resolveLandingFilePath(workspacePath, fileId);
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, LANDING_TEMPLATES[fileId], "utf-8");
  }
  return {
    filePath,
    content: fs.readFileSync(filePath, "utf-8"),
  };
}

export function setLandingField(workspacePath: string, key: LandingSetKey, value: string): {
  filePath: string;
  fileName: string;
  key: LandingSetKey;
  value: string;
} {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    throw new Error("Value cannot be empty");
  }

  const target = LANDING_FIELD_TARGETS[key];
  const { filePath, content } = readLandingFileWithTemplate(workspacePath, target.fileId);
  const next = upsertMarkdownField(content, target.label, normalizedValue);
  fs.writeFileSync(filePath, next, "utf-8");
  return {
    filePath,
    fileName: LANDING_FILE_NAMES[target.fileId],
    key,
    value: normalizedValue,
  };
}

export function appendLandingNote(
  workspacePath: string,
  target: LandingAppendTarget,
  note: string,
): { filePath: string; fileName: string; note: string } {
  const normalizedNote = note.trim();
  if (!normalizedNote) {
    throw new Error("Note cannot be empty");
  }

  const fileId: LandingFileId = target;
  const { filePath, content } = readLandingFileWithTemplate(workspacePath, fileId);
  const heading = LANDING_APPEND_HEADINGS[target];
  const next = appendMarkdownListItemToHeading(content, heading, normalizedNote);
  const withTrailingLineBreak = next.endsWith("\n") || next.endsWith("\r\n") ? next : `${next}\n`;
  fs.writeFileSync(filePath, withTrailingLineBreak, "utf-8");

  return {
    filePath,
    fileName: LANDING_FILE_NAMES[fileId],
    note: normalizedNote,
  };
}
