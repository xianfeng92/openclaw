import type { OpenClawConfig } from "../config/config.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { resolveAgentIdentity } from "../agents/identity.js";
import { loadAgentIdentity } from "../commands/agents.config.js";
import { normalizeAgentId } from "../routing/session-key.js";

const MAX_ASSISTANT_NAME = 50;
const MAX_ASSISTANT_AVATAR = 200;
const MAX_ASSISTANT_EMOJI = 16;

export const DEFAULT_ASSISTANT_IDENTITY: AssistantIdentity = {
  agentId: "main",
  name: "Assistant",
  avatar: "A",
};

export type AssistantIdentity = {
  agentId: string;
  name: string;
  avatar: string;
  emoji?: string;
};

function coerceIdentityText(value: string | undefined, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return trimmed.slice(0, maxLength);
}

function coerceIdentityRaw(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function isAvatarUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^data:image\//i.test(value);
}

function looksLikeAvatarPath(value: string): boolean {
  if (/[\\/]/.test(value)) {
    return true;
  }
  return /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(value);
}

function normalizeAvatarValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  // Never truncate: dropping avoids producing broken URLs/data URIs/paths.
  if (trimmed.length > MAX_ASSISTANT_AVATAR) {
    return undefined;
  }
  if (isAvatarUrl(trimmed)) {
    return trimmed;
  }
  if (looksLikeAvatarPath(trimmed)) {
    return trimmed;
  }
  if (!/\s/.test(trimmed) && trimmed.length <= 4) {
    return trimmed;
  }
  return undefined;
}

const EMOJI_RE =
  /(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})(?:\uFE0F|\uFE0E)?(?:\u200D(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})(?:\uFE0F|\uFE0E)?)*?/gu;

function normalizeEmojiValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  // If the user wrote "🤖 (or ⚠️ when alarmed)", keep the first emoji cluster.
  // This avoids leaking parenthetical commentary into the UI.
  const match = trimmed.match(EMOJI_RE)?.[0];
  if (match?.trim()) {
    return match.trim();
  }
  if (trimmed.length > MAX_ASSISTANT_EMOJI) {
    return undefined;
  }
  let hasNonAscii = false;
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed.charCodeAt(i) > 127) {
      hasNonAscii = true;
      break;
    }
  }
  if (!hasNonAscii) {
    return undefined;
  }
  if (isAvatarUrl(trimmed) || looksLikeAvatarPath(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function resolveAssistantIdentity(params: {
  cfg: OpenClawConfig;
  agentId?: string | null;
  workspaceDir?: string | null;
}): AssistantIdentity {
  const agentId = normalizeAgentId(params.agentId ?? resolveDefaultAgentId(params.cfg));
  const workspaceDir = params.workspaceDir ?? resolveAgentWorkspaceDir(params.cfg, agentId);
  const configAssistant = params.cfg.ui?.assistant;
  const agentIdentity = resolveAgentIdentity(params.cfg, agentId);
  const fileIdentity = workspaceDir ? loadAgentIdentity(workspaceDir) : null;

  const name =
    coerceIdentityText(configAssistant?.name, MAX_ASSISTANT_NAME) ??
    coerceIdentityText(agentIdentity?.name, MAX_ASSISTANT_NAME) ??
    coerceIdentityText(fileIdentity?.name, MAX_ASSISTANT_NAME) ??
    DEFAULT_ASSISTANT_IDENTITY.name;

  const avatarCandidates = [
    coerceIdentityRaw(configAssistant?.avatar),
    coerceIdentityRaw(agentIdentity?.avatar),
    coerceIdentityRaw(agentIdentity?.emoji),
    coerceIdentityRaw(fileIdentity?.avatar),
    coerceIdentityRaw(fileIdentity?.emoji),
  ];
  const avatar =
    avatarCandidates.map((candidate) => normalizeAvatarValue(candidate)).find(Boolean) ??
    DEFAULT_ASSISTANT_IDENTITY.avatar;

  const emojiCandidates = [
    coerceIdentityRaw(agentIdentity?.emoji),
    coerceIdentityRaw(fileIdentity?.emoji),
    coerceIdentityRaw(agentIdentity?.avatar),
    coerceIdentityRaw(fileIdentity?.avatar),
  ];
  const emoji = emojiCandidates.map((candidate) => normalizeEmojiValue(candidate)).find(Boolean);

  return { agentId, name, avatar, emoji };
}
