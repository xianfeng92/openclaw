import fs from "node:fs";
import path from "node:path";
import type { CyDeckEffectiveConfig } from "./cydeck-config.js";

export const CYDECK_RUNTIME_FILENAME = "cydeck-runtime.json";

export type CyDeckRuntimeDescriptor = {
  version: 1;
  workspacePath: string;
  updatedAt: string;
};

export type CyDeckOpenClawBridgePaths = {
  rootDir: string;
  stateDir: string;
  configPath: string;
  runtimePath: string;
};

function normalizeProviderEnvEntries(config: CyDeckEffectiveConfig): Record<string, string> {
  const envEntries: Record<string, string> = {};
  const providers = config.config.ai.providers;

  if (providers.openai.apiKey.trim()) {
    envEntries.OPENAI_API_KEY = providers.openai.apiKey.trim();
  }
  if (providers.anthropic.apiKey.trim()) {
    envEntries.ANTHROPIC_API_KEY = providers.anthropic.apiKey.trim();
  }
  if (providers.google.apiKey.trim()) {
    envEntries.GEMINI_API_KEY = providers.google.apiKey.trim();
    envEntries.GOOGLE_API_KEY = providers.google.apiKey.trim();
  }

  return envEntries;
}

function buildOpenClawConfig(params: {
  config: CyDeckEffectiveConfig;
  authToken: string;
}): Record<string, unknown> {
  const { config, authToken } = params;
  const provider = config.runtimeProvider.provider;
  const modelRef = `${provider}/${config.runtimeProvider.model}`;

  return {
    gateway: {
      mode: "local",
      port: config.config.gateway.port,
      bind: "loopback",
      auth: {
        mode: "token",
        token: authToken,
      },
      controlUi: {
        enabled: false,
      },
      http: {
        endpoints: {
          chatCompletions: {
            enabled: false,
          },
          responses: {
            enabled: false,
          },
        },
      },
    },
    agents: {
      defaults: {
        model: {
          primary: modelRef,
        },
        models: {
          [modelRef]: {
            alias: "cydeck-primary",
          },
        },
      },
    },
    models: {
      providers: {
        [provider]: {
          apiKey: config.runtimeProvider.apiKey,
          baseUrl: config.runtimeProvider.baseUrl,
        },
      },
    },
  };
}

export function resolveCyDeckOpenClawBridgePaths(cydeckStateDir: string): CyDeckOpenClawBridgePaths {
  const rootDir = path.join(cydeckStateDir, "openclaw-gateway");
  const stateDir = path.join(rootDir, "state");
  return {
    rootDir,
    stateDir,
    configPath: path.join(stateDir, "openclaw.json"),
    runtimePath: path.join(stateDir, CYDECK_RUNTIME_FILENAME),
  };
}

export function writeCyDeckOpenClawBridge(params: {
  config: CyDeckEffectiveConfig;
  authToken: string;
}): CyDeckOpenClawBridgePaths {
  const paths = resolveCyDeckOpenClawBridgePaths(params.config.stateDir);
  fs.mkdirSync(paths.stateDir, { recursive: true });

  const openclawConfig = buildOpenClawConfig(params);
  const runtimeDescriptor: CyDeckRuntimeDescriptor = {
    version: 1,
    workspacePath: params.config.workspacePath,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(paths.configPath, `${JSON.stringify(openclawConfig, null, 2)}\n`, "utf-8");
  fs.writeFileSync(paths.runtimePath, `${JSON.stringify(runtimeDescriptor, null, 2)}\n`, "utf-8");

  return paths;
}

export function buildCyDeckOpenClawEnv(params: {
  config: CyDeckEffectiveConfig;
  authToken: string;
  paths?: CyDeckOpenClawBridgePaths;
}): NodeJS.ProcessEnv {
  const paths = params.paths ?? resolveCyDeckOpenClawBridgePaths(params.config.stateDir);
  return {
    ...normalizeProviderEnvEntries(params.config),
    OPENCLAW_PROFILE: "desktop",
    OPENCLAW_STATE_DIR: paths.stateDir,
    OPENCLAW_CONFIG_PATH: paths.configPath,
    OPENCLAW_CYDECK_RUNTIME_PATH: paths.runtimePath,
    OPENCLAW_GATEWAY_PORT: String(params.config.config.gateway.port),
    OPENCLAW_GATEWAY_TOKEN: params.authToken,
  };
}

export function applyCyDeckOpenClawEnv(params: {
  targetEnv?: NodeJS.ProcessEnv;
  config: CyDeckEffectiveConfig;
  authToken: string;
  paths?: CyDeckOpenClawBridgePaths;
}): NodeJS.ProcessEnv {
  const targetEnv = params.targetEnv ?? process.env;
  const patch = buildCyDeckOpenClawEnv({
    config: params.config,
    authToken: params.authToken,
    paths: params.paths,
  });

  for (const [key, value] of Object.entries(patch)) {
    targetEnv[key] = value;
  }

  return targetEnv;
}
