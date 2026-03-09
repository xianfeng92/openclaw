import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";

export type CyDeckProvider = "openai" | "anthropic" | "google";

export type CyDeckProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
};

export type CyDeckConfig = {
  version: number;
  ai: {
    defaultProvider: CyDeckProvider;
    providers: Record<CyDeckProvider, CyDeckProviderConfig>;
  };
  workspace: {
    path: string;
    autoCreate: boolean;
  };
  gateway: {
    port: number;
    autoStart: boolean;
  };
  ui: {
    theme: string;
  };
};

export type CyDeckConfigIssueCode =
  | "read_failed"
  | "parse_failed"
  | "write_failed"
  | "missing_env_var"
  | "invalid_field"
  | "workspace_path_invalid"
  | "workspace_not_found";

export type CyDeckConfigIssueSeverity = "error" | "warning";

export type CyDeckConfigIssue = {
  code: CyDeckConfigIssueCode;
  severity: CyDeckConfigIssueSeverity;
  message: string;
  path?: string;
  varName?: string;
};

export type CyDeckConfigValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  issues: CyDeckConfigIssue[];
};

export type CyDeckConfigLoadResult = {
  config: CyDeckConfig;
  configPath: string;
  stateDir: string;
  fromFile: boolean;
  validation: CyDeckConfigValidation;
  warnings: string[];
  issues: CyDeckConfigIssue[];
};

export type CyDeckConfigSaveResult = {
  success: boolean;
  configPath: string;
  issues: CyDeckConfigIssue[];
};

export type CyDeckRuntimeProviderConfig = CyDeckProviderConfig & {
  provider: CyDeckProvider;
};

export type CyDeckEffectiveConfig = CyDeckConfigLoadResult & {
  runtimeProvider: CyDeckRuntimeProviderConfig;
  workspacePath: string;
};

type ValidateCyDeckConfigOptions = {
  seedIssues?: readonly CyDeckConfigIssue[];
  workspacePath?: string;
};

const CONFIG_FILENAME = "cydeck.json";
const PROVIDERS: ReadonlyArray<CyDeckProvider> = ["openai", "anthropic", "google"];
const ENV_VAR_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

export const DEFAULT_CYDECK_CONFIG: CyDeckConfig = {
  version: 1,
  ai: {
    defaultProvider: "openai",
    providers: {
      openai: {
        apiKey: "${OPENAI_API_KEY}",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        maxTokens: 4096,
      },
      anthropic: {
        apiKey: "${ANTHROPIC_API_KEY}",
        baseUrl: "https://api.anthropic.com/v1",
        model: "claude-3-5-sonnet",
        maxTokens: 8192,
      },
      google: {
        apiKey: "${GEMINI_API_KEY}",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        model: "gemini-2.0-flash",
        maxTokens: 8192,
      },
    },
  },
  workspace: {
    path: "./workspace",
    autoCreate: true,
  },
  gateway: {
    port: 19001,
    autoStart: true,
  },
  ui: {
    theme: "cydeck",
  },
};

function isSupportedProvider(value: string): value is CyDeckProvider {
  return (PROVIDERS as readonly string[]).includes(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function parsePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const parsed = Math.floor(value);
  return parsed > 0 ? parsed : fallback;
}

function createIssue(
  code: CyDeckConfigIssueCode,
  severity: CyDeckConfigIssueSeverity,
  message: string,
  issuePath?: string,
  varName?: string,
): CyDeckConfigIssue {
  return {
    code,
    severity,
    message,
    path: issuePath,
    varName,
  };
}

function dedupeIssues(issues: readonly CyDeckConfigIssue[]): CyDeckConfigIssue[] {
  const seen = new Set<string>();
  const deduped: CyDeckConfigIssue[] = [];

  for (const issue of issues) {
    const key = `${issue.code}|${issue.severity}|${issue.path ?? ""}|${issue.varName ?? ""}|${issue.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(issue);
  }

  return deduped;
}

function toValidation(issues: readonly CyDeckConfigIssue[]): CyDeckConfigValidation {
  const normalized = dedupeIssues(issues);
  const errors = normalized
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.message);
  const warnings = normalized
    .filter((issue) => issue.severity === "warning")
    .map((issue) => issue.message);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    issues: normalized,
  };
}

function resolveAppUserDataDir(): string {
  try {
    return app.getPath("userData");
  } catch {
    return path.join(os.homedir(), ".cydeck");
  }
}

function expandHomePrefix(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (trimmed.startsWith("~")) {
    return trimmed.replace(/^~(?=$|[\\/])/, os.homedir());
  }

  return trimmed;
}

function resolvePathFromCwd(input: string): string {
  const expanded = expandHomePrefix(input);
  if (!expanded) {
    return expanded;
  }
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(expanded);
}

function resolvePathFromBase(input: string, baseDir: string): string {
  const expanded = expandHomePrefix(input);
  if (!expanded) {
    return expanded;
  }
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(baseDir, expanded);
}

function substituteString(
  value: string,
  env: NodeJS.ProcessEnv,
  configPath: string,
  issues: CyDeckConfigIssue[],
): string {
  if (!value.includes("$")) {
    return value;
  }

  const chunks: string[] = [];

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char !== "$") {
      chunks.push(char);
      continue;
    }

    const next = value[i + 1];
    const afterNext = value[i + 2];

    // Escaped variable: $${VAR} -> ${VAR}
    if (next === "$" && afterNext === "{") {
      const start = i + 3;
      const end = value.indexOf("}", start);
      if (end !== -1) {
        const envVarName = value.slice(start, end);
        if (ENV_VAR_NAME_PATTERN.test(envVarName)) {
          chunks.push(`\${${envVarName}}`);
          i = end;
          continue;
        }
      }
    }

    // Normal substitution: ${VAR} -> env value
    if (next === "{") {
      const start = i + 2;
      const end = value.indexOf("}", start);
      if (end !== -1) {
        const envVarName = value.slice(start, end);
        if (ENV_VAR_NAME_PATTERN.test(envVarName)) {
          const envValue = env[envVarName];
          if (envValue === undefined || envValue === "") {
            issues.push(
              createIssue(
                "missing_env_var",
                "warning",
                `Missing environment variable "${envVarName}" at "${configPath}"`,
                configPath,
                envVarName,
              ),
            );
            chunks.push("");
          } else {
            chunks.push(envValue);
          }
          i = end;
          continue;
        }
      }
    }

    chunks.push(char);
  }

  return chunks.join("");
}

function substituteAny(
  value: unknown,
  env: NodeJS.ProcessEnv,
  configPath: string,
  issues: CyDeckConfigIssue[],
): unknown {
  if (typeof value === "string") {
    return substituteString(value, env, configPath, issues);
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => substituteAny(item, env, `${configPath}[${index}]`, issues));
  }

  if (asRecord(value)) {
    const record = asRecord(value) as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(record)) {
      const childPath = configPath ? `${configPath}.${key}` : key;
      next[key] = substituteAny(val, env, childPath, issues);
    }
    return next;
  }

  return value;
}

function coerceProviderConfig(
  value: unknown,
  fallback: CyDeckProviderConfig,
): CyDeckProviderConfig {
  const record = asRecord(value) ?? {};
  return {
    apiKey: parseString(record.apiKey, fallback.apiKey),
    baseUrl: parseString(record.baseUrl, fallback.baseUrl),
    model: parseString(record.model, fallback.model),
    maxTokens: parsePositiveInt(record.maxTokens, fallback.maxTokens),
  };
}

function mergeWithDefaults(rawConfig: unknown): CyDeckConfig {
  const root = asRecord(rawConfig) ?? {};
  const ai = asRecord(root.ai) ?? {};
  const providers = asRecord(ai.providers) ?? {};
  const workspace = asRecord(root.workspace) ?? {};
  const gateway = asRecord(root.gateway) ?? {};
  const ui = asRecord(root.ui) ?? {};

  const defaultProviderRaw = parseString(ai.defaultProvider, DEFAULT_CYDECK_CONFIG.ai.defaultProvider);
  const defaultProvider = isSupportedProvider(defaultProviderRaw)
    ? defaultProviderRaw
    : DEFAULT_CYDECK_CONFIG.ai.defaultProvider;

  return {
    version: parsePositiveInt(root.version, DEFAULT_CYDECK_CONFIG.version),
    ai: {
      defaultProvider,
      providers: {
        openai: coerceProviderConfig(providers.openai, DEFAULT_CYDECK_CONFIG.ai.providers.openai),
        anthropic: coerceProviderConfig(
          providers.anthropic,
          DEFAULT_CYDECK_CONFIG.ai.providers.anthropic,
        ),
        google: coerceProviderConfig(providers.google, DEFAULT_CYDECK_CONFIG.ai.providers.google),
      },
    },
    workspace: {
      path: parseString(workspace.path, DEFAULT_CYDECK_CONFIG.workspace.path),
      autoCreate: parseBoolean(workspace.autoCreate, DEFAULT_CYDECK_CONFIG.workspace.autoCreate),
    },
    gateway: {
      port: parsePositiveInt(gateway.port, DEFAULT_CYDECK_CONFIG.gateway.port),
      autoStart: parseBoolean(gateway.autoStart, DEFAULT_CYDECK_CONFIG.gateway.autoStart),
    },
    ui: {
      theme: parseString(ui.theme, DEFAULT_CYDECK_CONFIG.ui.theme),
    },
  };
}

function resolveConfigEnvTemplates(
  config: CyDeckConfig,
  env: NodeJS.ProcessEnv,
): { config: CyDeckConfig; issues: CyDeckConfigIssue[] } {
  const issues: CyDeckConfigIssue[] = [];
  const substituted = substituteAny(config, env, "", issues) as CyDeckConfig;
  return {
    config: substituted,
    issues: dedupeIssues(issues),
  };
}

export function validateCyDeckConfig(
  config: CyDeckConfig,
  options: ValidateCyDeckConfigOptions = {},
): CyDeckConfigValidation {
  const issues: CyDeckConfigIssue[] = [...(options.seedIssues ?? [])];

  const addError = (
    message: string,
    issuePath?: string,
    code: CyDeckConfigIssueCode = "invalid_field",
  ) => {
    issues.push(createIssue(code, "error", message, issuePath));
  };

  const addWarning = (
    message: string,
    issuePath?: string,
    code: CyDeckConfigIssueCode = "invalid_field",
  ) => {
    issues.push(createIssue(code, "warning", message, issuePath));
  };

  if (!Number.isInteger(config.version) || config.version < 1) {
    addError(`version must be a positive integer (got ${String(config.version)})`, "version");
  }

  if (!isSupportedProvider(config.ai.defaultProvider)) {
    addError(
      `Unsupported ai.defaultProvider: ${String(config.ai.defaultProvider)}`,
      "ai.defaultProvider",
    );
  }

  for (const provider of PROVIDERS) {
    const providerConfig = config.ai.providers[provider];
    if (!providerConfig) {
      addError(`Missing provider config: ai.providers.${provider}`, `ai.providers.${provider}`);
      continue;
    }

    if (!providerConfig.baseUrl.trim()) {
      addError(
        `ai.providers.${provider}.baseUrl must not be empty`,
        `ai.providers.${provider}.baseUrl`,
      );
    }

    if (!providerConfig.model.trim()) {
      addError(`ai.providers.${provider}.model must not be empty`, `ai.providers.${provider}.model`);
    }

    if (!Number.isInteger(providerConfig.maxTokens) || providerConfig.maxTokens < 1) {
      addError(
        `ai.providers.${provider}.maxTokens must be a positive integer`,
        `ai.providers.${provider}.maxTokens`,
      );
    }
  }

  const defaultProviderConfig = config.ai.providers[config.ai.defaultProvider];
  if (!defaultProviderConfig.apiKey.trim()) {
    addWarning(
      `No API key configured for provider "${config.ai.defaultProvider}"`,
      `ai.providers.${config.ai.defaultProvider}.apiKey`,
    );
  }

  if (!Number.isInteger(config.gateway.port) || config.gateway.port < 1 || config.gateway.port > 65535) {
    addError(
      `gateway.port must be an integer between 1 and 65535 (got ${String(config.gateway.port)})`,
      "gateway.port",
    );
  }

  if (!config.workspace.path.trim()) {
    addError("workspace.path must not be empty", "workspace.path");
  } else if (config.workspace.path.includes("\u0000")) {
    addError("workspace.path contains invalid null bytes", "workspace.path", "workspace_path_invalid");
  }

  const workspacePath = options.workspacePath?.trim();
  if (workspacePath) {
    try {
      if (fs.existsSync(workspacePath)) {
        const stat = fs.statSync(workspacePath);
        if (!stat.isDirectory()) {
          addError(
            `workspace.path resolves to a non-directory: ${workspacePath}`,
            "workspace.path",
            "workspace_path_invalid",
          );
        }
      } else if (!config.workspace.autoCreate) {
        addWarning(
          `workspace.path does not exist and workspace.autoCreate is false: ${workspacePath}`,
          "workspace.path",
          "workspace_not_found",
        );
      }
    } catch (err) {
      addError(
        `Failed to inspect workspace.path (${workspacePath}): ${err instanceof Error ? err.message : String(err)}`,
        "workspace.path",
        "workspace_path_invalid",
      );
    }
  }

  return toValidation(issues);
}

export function resolveCyDeckStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CYDECK_STATE_DIR?.trim();
  if (override) {
    return resolvePathFromCwd(override);
  }
  return path.join(resolveAppUserDataDir(), "cydeck");
}

export function resolveCyDeckConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CYDECK_CONFIG_PATH?.trim();
  if (override) {
    return resolvePathFromCwd(override);
  }
  return path.join(resolveCyDeckStateDir(env), CONFIG_FILENAME);
}

export function loadCyDeckConfig(env: NodeJS.ProcessEnv = process.env): CyDeckConfigLoadResult {
  const stateDir = resolveCyDeckStateDir(env);
  const configPath = resolveCyDeckConfigPath(env);
  const issues: CyDeckConfigIssue[] = [];

  let fromFile = false;
  let parsed: unknown = {};

  if (fs.existsSync(configPath)) {
    fromFile = true;
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      try {
        parsed = raw.trim() ? JSON.parse(raw) : {};
      } catch (err) {
        issues.push(
          createIssue(
            "parse_failed",
            "error",
            `Failed to parse config at ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
            configPath,
          ),
        );
        parsed = {};
      }
    } catch (err) {
      issues.push(
        createIssue(
          "read_failed",
          "error",
          `Failed to read config at ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
          configPath,
        ),
      );
      parsed = {};
    }
  } else {
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(
        configPath,
        `${JSON.stringify(DEFAULT_CYDECK_CONFIG, null, 2)}\n`,
        { encoding: "utf-8", mode: 0o600 },
      );
      parsed = DEFAULT_CYDECK_CONFIG;
    } catch (err) {
      issues.push(
        createIssue(
          "write_failed",
          "error",
          `Failed to initialize config at ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
          configPath,
        ),
      );
      parsed = DEFAULT_CYDECK_CONFIG;
    }
  }

  const merged = mergeWithDefaults(parsed);
  const resolved = resolveConfigEnvTemplates(merged, env);
  const mergedIssues = dedupeIssues([...issues, ...resolved.issues]);
  const validation = validateCyDeckConfig(resolved.config, {
    seedIssues: resolved.issues,
  });

  return {
    config: resolved.config,
    configPath,
    stateDir,
    fromFile,
    validation,
    warnings: mergedIssues
      .filter((issue) => issue.severity === "warning")
      .map((issue) => issue.message),
    issues: mergedIssues,
  };
}

export function saveCyDeckConfig(
  config: CyDeckConfig,
  env: NodeJS.ProcessEnv = process.env,
): CyDeckConfigSaveResult {
  const stateDir = resolveCyDeckStateDir(env);
  const configPath = resolveCyDeckConfigPath(env);
  const normalized = mergeWithDefaults(config);

  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
    return {
      success: true,
      configPath,
      issues: [],
    };
  } catch (err) {
    const issue = createIssue(
      "write_failed",
      "error",
      `Failed to write config at ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
      configPath,
    );
    return {
      success: false,
      configPath,
      issues: [issue],
    };
  }
}

export function getRuntimeProviderConfig(
  config: CyDeckConfig,
  provider: CyDeckProvider = config.ai.defaultProvider,
): CyDeckRuntimeProviderConfig {
  return {
    provider,
    ...config.ai.providers[provider],
  };
}

export function getEffectiveConfig(env: NodeJS.ProcessEnv = process.env): CyDeckEffectiveConfig {
  const loaded = loadCyDeckConfig(env);
  const configDirectory = path.dirname(loaded.configPath);
  const workspacePath = resolvePathFromBase(loaded.config.workspace.path, configDirectory);
  const config: CyDeckConfig = {
    ...loaded.config,
    workspace: {
      ...loaded.config.workspace,
      path: workspacePath,
    },
  };

  const seedIssues = loaded.issues.filter((issue) => issue.code === "missing_env_var");
  const validation = validateCyDeckConfig(config, {
    seedIssues,
    workspacePath,
  });
  const issues = dedupeIssues([...loaded.issues, ...validation.issues]);

  return {
    ...loaded,
    config,
    workspacePath,
    runtimeProvider: getRuntimeProviderConfig(config),
    validation,
    warnings: issues
      .filter((issue) => issue.severity === "warning")
      .map((issue) => issue.message),
    issues,
  };
}
