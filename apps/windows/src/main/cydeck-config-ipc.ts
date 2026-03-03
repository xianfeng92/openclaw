import type { CyDeckProvider } from "./cydeck-config.js";

const PROVIDERS: readonly CyDeckProvider[] = ["openai", "anthropic", "google"];
const PROVIDER_FIELDS = ["apiKey", "baseUrl", "model", "maxTokens"] as const;

const PROVIDER_CONFIG_KEYS = PROVIDERS.flatMap((provider) =>
  PROVIDER_FIELDS.map((field) => `ai.providers.${provider}.${field}`),
);

export const CYDECK_MUTABLE_CONFIG_KEYS = [
  "ai.defaultProvider",
  ...PROVIDER_CONFIG_KEYS,
  "workspace.path",
  "workspace.autoCreate",
  "gateway.port",
  "gateway.autoStart",
  "ui.theme",
] as const;

const MUTABLE_CONFIG_KEY_SET = new Set<string>(CYDECK_MUTABLE_CONFIG_KEYS);

export type CyDeckMutableConfigKey = (typeof CYDECK_MUTABLE_CONFIG_KEYS)[number];

export type CoerceCyDeckConfigValueResult =
  | { ok: true; value: string | number | boolean }
  | { ok: false; error: string };

export function isCyDeckMutableConfigKey(value: string): value is CyDeckMutableConfigKey {
  return MUTABLE_CONFIG_KEY_SET.has(value);
}

function parseBoolean(rawValue: string): boolean | undefined {
  const normalized = rawValue.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function maybeStripQuotes(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }

  const startsWithSingle = trimmed.startsWith("'");
  const endsWithSingle = trimmed.endsWith("'");
  if (startsWithSingle && endsWithSingle) {
    return trimmed.slice(1, -1);
  }

  const startsWithDouble = trimmed.startsWith('"');
  const endsWithDouble = trimmed.endsWith('"');
  if (startsWithDouble && endsWithDouble) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

export function coerceCyDeckConfigValue(
  key: CyDeckMutableConfigKey,
  rawValue: string,
): CoerceCyDeckConfigValueResult {
  const value = rawValue.trim();
  if (!value) {
    return { ok: false, error: "Value cannot be empty" };
  }

  if (key === "ai.defaultProvider") {
    if (PROVIDERS.includes(value as CyDeckProvider)) {
      return { ok: true, value: value as CyDeckProvider };
    }
    return {
      ok: false,
      error: `ai.defaultProvider must be one of: ${PROVIDERS.join(", ")}`,
    };
  }

  if (key === "workspace.autoCreate" || key === "gateway.autoStart") {
    const parsed = parseBoolean(value);
    if (parsed === undefined) {
      return { ok: false, error: `${key} must be true or false` };
    }
    return { ok: true, value: parsed };
  }

  if (key === "gateway.port" || key.endsWith(".maxTokens")) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return { ok: false, error: `${key} must be a positive integer` };
    }
    if (key === "gateway.port" && parsed > 65535) {
      return { ok: false, error: "gateway.port must be between 1 and 65535" };
    }
    return { ok: true, value: parsed };
  }

  return { ok: true, value: maybeStripQuotes(rawValue) };
}

export function assignConfigPathValue(
  target: Record<string, unknown>,
  keyPath: string,
  value: unknown,
): void {
  const segments = keyPath.split(".").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) {
    return;
  }

  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const next = cursor[segment];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }

  const leaf = segments[segments.length - 1];
  cursor[leaf] = value;
}

export function formatMutableConfigKeysForHelp(): string {
  return CYDECK_MUTABLE_CONFIG_KEYS.join(", ");
}
