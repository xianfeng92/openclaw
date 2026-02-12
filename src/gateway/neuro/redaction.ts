import { createHash } from "node:crypto";

export type NeuroContextSource = "clipboard" | "active_window" | "terminal" | "fs" | "editor";
export type NeuroRedactionLevel = "none" | "mask" | "hash" | "block";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
interface JsonObject {
  [key: string]: JsonValue;
}

type RedactionState = {
  level: NeuroRedactionLevel;
  reasons: Set<string>;
  dropped: boolean;
};

type RedactionRule = {
  level: Exclude<NeuroRedactionLevel, "none">;
  reason: string;
  pattern: RegExp;
  replace: (match: string, groups: string[]) => string;
};

export type NeuroRedactionInput = {
  source: NeuroContextSource;
  payload: Record<string, unknown>;
};

export type NeuroRedactionResult = {
  payload: Record<string, unknown>;
  redaction: {
    applied: boolean;
    level: NeuroRedactionLevel;
    reasons: string[];
  };
  bounds: {
    bytes: number;
    dropped: boolean;
  };
};

export const NEURO_SOURCE_FILTER_LIMITS = {
  terminalLineCap: 100,
  clipboardTextBytes: 10 * 1024,
  editorSelectionBytes: 8 * 1024,
} as const;

const REDACTION_LEVEL_WEIGHT: Record<NeuroRedactionLevel, number> = {
  none: 0,
  mask: 1,
  hash: 2,
  block: 3,
};

const CLIPBOARD_TEXT_KEYS = new Set(["text", "content"]);
const EDITOR_TEXT_KEYS = new Set(["selection", "text"]);
const TERMINAL_TEXT_KEYS = new Set(["text", "output", "stdout", "stderr", "line"]);
const FS_BLOCKED_FIELD_PATTERN =
  /^(content|contents|raw|raw_text|rawtext|blob|base64|buffer|bytes|data)$/i;

const REDACTION_RULES: RedactionRule[] = [
  {
    level: "block",
    reason: "pattern.secret.private_key_block",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: () => "[REDACTED:PRIVATE_KEY_BLOCK]",
  },
  {
    level: "hash",
    reason: "pattern.secret.assignment",
    pattern:
      /\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)|api[_-]?key|token|secret|password|passwd)\b(\s*[:=]\s*)(["']?)([^\s"'`]+)\3/gi,
    replace: (_match, groups) => {
      const key = groups[0] ?? "secret";
      const separator = groups[1] ?? "=";
      const quote = groups[2] ?? "";
      const value = groups[3] ?? "";
      return `${key}${separator}${quote}${hashLiteral(value)}${quote}`;
    },
  },
  {
    level: "hash",
    reason: "pattern.secret.json_field",
    pattern: /"(?:apiKey|token|secret|password|passwd|accessToken|refreshToken)"\s*:\s*"([^"]+)"/gi,
    replace: (match, groups) => {
      const value = groups[0] ?? "";
      if (!value) {
        return match;
      }
      return match.replace(value, hashLiteral(value));
    },
  },
  {
    level: "hash",
    reason: "pattern.secret.bearer",
    pattern: /\bBearer\s+([A-Za-z0-9._\-+=]{12,})\b/g,
    replace: (_match, groups) => `Bearer ${hashLiteral(groups[0] ?? "")}`,
  },
  {
    level: "hash",
    reason: "pattern.secret.provider_token",
    pattern:
      /\b(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|xapp-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z\-_]{20,}|npm_[A-Za-z0-9]{10,}|\d{6,}:[A-Za-z0-9_-]{20,})\b/g,
    replace: (_match, groups) => hashLiteral(groups[0] ?? ""),
  },
  {
    level: "mask",
    reason: "pattern.sensitive.email",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replace: (match) => maskEmail(match),
  },
  {
    level: "mask",
    reason: "pattern.sensitive.phone",
    pattern: /\+?\d(?:[\d\s().-]{7,}\d)/g,
    replace: (match) => maskLiteral(match),
  },
];

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJsonValue(value: unknown): JsonValue | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return undefined;
  }
  if (Array.isArray(value)) {
    const mapped = value
      .map((entry) => toJsonValue(entry))
      .filter((entry): entry is JsonValue => entry !== undefined);
    return mapped;
  }
  if (typeof value === "object") {
    const next: JsonObject = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const mapped = toJsonValue(entry);
      if (mapped !== undefined) {
        next[key] = mapped;
      }
    }
    return next;
  }
  return undefined;
}

function toJsonObject(payload: Record<string, unknown>): JsonObject {
  const normalized = toJsonValue(payload);
  if (!normalized || Array.isArray(normalized) || !isJsonObject(normalized)) {
    return {};
  }
  return normalized;
}

function payloadBytes(payload: JsonObject): number {
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}

function mergeLevel(current: NeuroRedactionLevel, next: NeuroRedactionLevel): NeuroRedactionLevel {
  return REDACTION_LEVEL_WEIGHT[next] > REDACTION_LEVEL_WEIGHT[current] ? next : current;
}

function addReason(
  state: RedactionState,
  level: NeuroRedactionLevel,
  reason: string,
  options?: { dropped?: boolean },
): void {
  state.reasons.add(reason);
  state.level = mergeLevel(state.level, level);
  if (options?.dropped) {
    state.dropped = true;
  }
}

function mapJsonStrings(
  value: JsonValue,
  mapper: (text: string, path: string[]) => string,
  path: string[] = [],
): JsonValue {
  if (typeof value === "string") {
    return mapper(value, path);
  }
  if (Array.isArray(value)) {
    return value.map((entry, idx) => mapJsonStrings(entry, mapper, [...path, String(idx)]));
  }
  if (isJsonObject(value)) {
    const next: JsonObject = {};
    for (const [key, entry] of Object.entries(value)) {
      next[key] = mapJsonStrings(entry, mapper, [...path, key]);
    }
    return next;
  }
  return value;
}

function stripUrlSensitiveParts(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    const noHash = value.split("#", 1)[0] ?? value;
    return noHash.split("?", 1)[0] ?? value;
  }
}

function keepLastLines(value: string, lineCap: number): string {
  const lines = value.split(/\r?\n/);
  if (lines.length <= lineCap) {
    return value;
  }
  return lines.slice(lines.length - lineCap).join("\n");
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {
    return value;
  }
  let left = 0;
  let right = value.length;
  while (left < right) {
    const mid = Math.ceil((left + right) / 2);
    const candidate = value.slice(0, mid);
    if (Buffer.byteLength(candidate, "utf8") <= maxBytes) {
      left = mid;
    } else {
      right = mid - 1;
    }
  }
  return value.slice(0, left);
}

function applyFsSourceFilter(value: JsonValue, state: RedactionState): JsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => applyFsSourceFilter(entry, state));
  }
  if (!isJsonObject(value)) {
    return value;
  }
  const next: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    if (FS_BLOCKED_FIELD_PATTERN.test(key)) {
      addReason(state, "block", "source.filter.fs_payload_content_removed", { dropped: true });
      continue;
    }
    next[key] = applyFsSourceFilter(entry, state);
  }
  return next;
}

function applySourcePreFilter(
  source: NeuroContextSource,
  payload: JsonObject,
  state: RedactionState,
): JsonObject {
  let next: JsonValue = payload;
  if (source === "fs") {
    next = applyFsSourceFilter(next, state);
  }
  if (source === "active_window") {
    next = mapJsonStrings(next, (value, path) => {
      const key = path[path.length - 1];
      if (key !== "url") {
        return value;
      }
      const stripped = stripUrlSensitiveParts(value);
      if (stripped !== value) {
        addReason(state, "mask", "source.filter.active_window_url_query_removed", {
          dropped: true,
        });
      }
      return stripped;
    });
  }
  if (source === "terminal") {
    next = mapJsonStrings(next, (value, path) => {
      const key = path[path.length - 1] ?? "";
      if (!TERMINAL_TEXT_KEYS.has(key)) {
        return value;
      }
      const capped = keepLastLines(value, NEURO_SOURCE_FILTER_LIMITS.terminalLineCap);
      if (capped !== value) {
        addReason(state, "none", "source.filter.terminal_line_cap", { dropped: true });
      }
      return capped;
    });
  }
  if (source === "clipboard") {
    next = mapJsonStrings(next, (value, path) => {
      const key = path[path.length - 1] ?? "";
      if (!CLIPBOARD_TEXT_KEYS.has(key)) {
        return value;
      }
      const capped = truncateUtf8(value, NEURO_SOURCE_FILTER_LIMITS.clipboardTextBytes);
      if (capped !== value) {
        addReason(state, "none", "source.filter.clipboard_byte_cap", { dropped: true });
      }
      return capped;
    });
  }
  if (source === "editor") {
    next = mapJsonStrings(next, (value, path) => {
      const key = path[path.length - 1] ?? "";
      if (!EDITOR_TEXT_KEYS.has(key)) {
        return value;
      }
      const capped = truncateUtf8(value, NEURO_SOURCE_FILTER_LIMITS.editorSelectionBytes);
      if (capped !== value) {
        addReason(state, "none", "source.filter.editor_selection_byte_cap", { dropped: true });
      }
      return capped;
    });
  }
  return isJsonObject(next) ? next : {};
}

function hashLiteral(value: string): string {
  if (!value) {
    return "sha256:empty";
  }
  return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function maskLiteral(value: string, keepStart = 2, keepEnd = 2): string {
  if (value.length <= keepStart + keepEnd) {
    return "***";
  }
  const start = value.slice(0, keepStart);
  const end = value.slice(-keepEnd);
  return `${start}***${end}`;
}

function maskEmail(value: string): string {
  const [local, domain] = value.split("@");
  if (!local || !domain) {
    return maskLiteral(value, 1, 1);
  }
  if (local.length === 1) {
    return `*@${domain}`;
  }
  return `${local[0]}***${local.slice(-1)}@${domain}`;
}

function redactString(value: string, state: RedactionState): string {
  let next = value;
  // Ordered strongest-to-weakest to avoid weaker transforms mutating stronger replacements.
  for (const rule of REDACTION_RULES) {
    next = next.replace(rule.pattern, (...args: unknown[]) => {
      const match = typeof args[0] === "string" ? args[0] : "";
      const groups = args.slice(1, -2).map((entry) => (typeof entry === "string" ? entry : ""));
      addReason(state, rule.level, rule.reason);
      return rule.replace(match, groups);
    });
  }
  return next;
}

export function applyNeuroRedaction(input: NeuroRedactionInput): NeuroRedactionResult {
  const state: RedactionState = {
    level: "none",
    reasons: new Set<string>(),
    dropped: false,
  };
  const jsonPayload = toJsonObject(input.payload);
  const preFiltered = applySourcePreFilter(input.source, jsonPayload, state);
  const redactedValue = mapJsonStrings(preFiltered, (value) => redactString(value, state));
  const redacted = isJsonObject(redactedValue) ? redactedValue : {};
  const reasons = Array.from(state.reasons).toSorted();
  return {
    payload: redacted,
    redaction: {
      applied: reasons.length > 0,
      level: state.level,
      reasons,
    },
    bounds: {
      bytes: payloadBytes(redacted),
      dropped: state.dropped,
    },
  };
}
