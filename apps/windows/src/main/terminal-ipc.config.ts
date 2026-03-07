import * as path from "path";
import { ipcMain } from "electron";
import {
  getEffectiveConfig,
  resolveCyDeckConfigPath,
  resolveCyDeckStateDir,
} from "./cydeck-config.js";
import type { CyDeckConfigIssue, CyDeckConfigValidation, CyDeckRuntimeProviderConfig } from "./cydeck-config.js";
import {
  assignConfigPathValue,
  coerceCyDeckConfigValue,
  formatMutableConfigKeysForHelp,
  isCyDeckMutableConfigKey,
} from "./cydeck-config-ipc.js";
import {
  cloneDefaultCyDeckConfigRecord,
  loadEditableCyDeckConfigDocument,
  writeCyDeckConfigDocument,
} from "./cydeck-config-document.js";
import type { GatewayLike } from "./gateway-like.js";
import {
  appendLandingNote,
  clearLandingWizardProgress,
  ensureLandingWorkspaceFiles,
  getLandingWizardNextStepIndex,
  getLandingWorkspaceStatus,
  isLandingAppendTarget,
  isLandingSetKey,
  loadLandingWizardProgress,
  saveLandingWizardProgress,
  setLandingField,
} from "./landing.js";

type TerminalConfigBaseResult = {
  success: boolean;
  configPath: string;
  stateDir: string;
  error?: string;
};

type TerminalConfigGetResult = TerminalConfigBaseResult & {
  config?: unknown;
  runtimeProvider?: unknown;
  workspacePath?: string;
  validation?: CyDeckConfigValidation;
  warnings?: string[];
  issues?: CyDeckConfigIssue[];
};

type TerminalConfigSetResult = TerminalConfigBaseResult & {
  key?: string;
  value?: string | number | boolean;
  validation?: CyDeckConfigValidation;
  warnings?: string[];
  issues?: CyDeckConfigIssue[];
};

type TerminalConfigValidateResult = TerminalConfigBaseResult & {
  validation?: CyDeckConfigValidation;
  warnings?: string[];
  issues?: CyDeckConfigIssue[];
};

type TerminalConfigResetResult = TerminalConfigBaseResult & {
  validation?: CyDeckConfigValidation;
  warnings?: string[];
  issues?: CyDeckConfigIssue[];
};

type TerminalConfigApplyResult = TerminalConfigBaseResult & {
  runtimeProvider?: unknown;
  validation?: CyDeckConfigValidation;
  warnings?: string[];
  issues?: CyDeckConfigIssue[];
};

type TerminalLandingFileStatus = {
  id: string;
  fileName: string;
  path: string;
  exists: boolean;
  bytes: number;
  configured: boolean;
};

type TerminalLandingStatusResult = TerminalConfigBaseResult & {
  workspacePath: string;
  files?: TerminalLandingFileStatus[];
  completed?: boolean;
  nextStepIndex?: number;
  wizardStepIndex?: number;
  wizardUpdatedAt?: string;
};

type TerminalLandingInitResult = TerminalLandingStatusResult & {
  created?: string[];
  existing?: string[];
};

type TerminalLandingSetResult = TerminalLandingStatusResult & {
  key?: string;
  value?: string;
  filePath?: string;
  fileName?: string;
  note?: string;
  target?: string;
};

function normalizePathForCompare(input: string): string {
  const normalized = path.normalize(input).replace(/[\\/]+$/u, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function getLandingWizardMeta(
  stateDir: string,
  workspacePath: string,
): { wizardStepIndex?: number; wizardUpdatedAt?: string } {
  const progress = loadLandingWizardProgress(stateDir);
  if (!progress) {
    return {};
  }
  if (
    normalizePathForCompare(progress.workspacePath) !==
    normalizePathForCompare(workspacePath)
  ) {
    return {};
  }
  return {
    wizardStepIndex: progress.stepIndex,
    wizardUpdatedAt: progress.updatedAt,
  };
}

function applyRuntimeProviderToGateway(
  gatewayManager: GatewayLike | undefined,
  runtimeProvider: CyDeckRuntimeProviderConfig,
): { success: boolean; error?: string } {
  if (!gatewayManager) {
    return { success: false, error: "Gateway is not initialized" };
  }

  if (typeof gatewayManager.reloadRuntimeProvider !== "function") {
    return { success: false, error: "Current gateway does not support runtime provider reload" };
  }

  try {
    gatewayManager.reloadRuntimeProvider(runtimeProvider);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function applyWorkspacePathToGateway(
  gatewayManager: GatewayLike | undefined,
  workspacePath: string,
): { success: boolean; error?: string } {
  if (!gatewayManager) {
    return { success: false, error: "Gateway is not initialized" };
  }

  if (typeof gatewayManager.reloadWorkspacePath !== "function") {
    return { success: false, error: "Current gateway does not support workspace path reload" };
  }

  try {
    gatewayManager.reloadWorkspacePath(workspacePath);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function registerTerminalConfigIpcHandlers(options: {
  getGatewayManager: () => GatewayLike | undefined;
}): void {
  const { getGatewayManager } = options;

  ipcMain.handle("terminal:get-gateway-info", async (): Promise<{ port?: number; token?: string }> => {
    const gatewayManager = getGatewayManager();
    if (!gatewayManager) {
      return {};
    }

    const state = gatewayManager.getState();
    const token = gatewayManager.getAuthToken();

    return {
      port: state.port,
      token,
    };
  });

  ipcMain.handle("terminal:config-get", async (): Promise<TerminalConfigGetResult> => {
    try {
      const effective = getEffectiveConfig();
      return {
        success: true,
        configPath: effective.configPath,
        stateDir: effective.stateDir,
        config: effective.config,
        runtimeProvider: effective.runtimeProvider,
        workspacePath: effective.workspacePath,
        validation: effective.validation,
        warnings: effective.warnings,
        issues: effective.issues,
      };
    } catch (err) {
      return {
        success: false,
        configPath: resolveCyDeckConfigPath(),
        stateDir: resolveCyDeckStateDir(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle("terminal:config-path", async (): Promise<TerminalConfigBaseResult> => {
    return {
      success: true,
      configPath: resolveCyDeckConfigPath(),
      stateDir: resolveCyDeckStateDir(),
    };
  });

  ipcMain.handle("terminal:config-validate", async (): Promise<TerminalConfigValidateResult> => {
    try {
      const effective = getEffectiveConfig();
      return {
        success: true,
        configPath: effective.configPath,
        stateDir: effective.stateDir,
        validation: effective.validation,
        warnings: effective.warnings,
        issues: effective.issues,
      };
    } catch (err) {
      return {
        success: false,
        configPath: resolveCyDeckConfigPath(),
        stateDir: resolveCyDeckStateDir(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle("terminal:config-apply", async (): Promise<TerminalConfigApplyResult> => {
    try {
      const effective = getEffectiveConfig();
      const gatewayManager = getGatewayManager();
      const applyRuntimeResult = applyRuntimeProviderToGateway(gatewayManager, effective.runtimeProvider);
      if (!applyRuntimeResult.success) {
        return {
          success: false,
          configPath: effective.configPath,
          stateDir: effective.stateDir,
          runtimeProvider: effective.runtimeProvider,
          validation: effective.validation,
          warnings: effective.warnings,
          issues: effective.issues,
          error: applyRuntimeResult.error,
        };
      }

      const applyWorkspaceResult = applyWorkspacePathToGateway(gatewayManager, effective.workspacePath);
      if (!applyWorkspaceResult.success) {
        return {
          success: false,
          configPath: effective.configPath,
          stateDir: effective.stateDir,
          runtimeProvider: effective.runtimeProvider,
          validation: effective.validation,
          warnings: effective.warnings,
          issues: effective.issues,
          error: applyWorkspaceResult.error,
        };
      }

      return {
        success: true,
        configPath: effective.configPath,
        stateDir: effective.stateDir,
        runtimeProvider: effective.runtimeProvider,
        validation: effective.validation,
        warnings: effective.warnings,
        issues: effective.issues,
      };
    } catch (err) {
      return {
        success: false,
        configPath: resolveCyDeckConfigPath(),
        stateDir: resolveCyDeckStateDir(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle("terminal:landing-status", async (): Promise<TerminalLandingStatusResult> => {
    try {
      const effective = getEffectiveConfig();
      const status = getLandingWorkspaceStatus(effective.workspacePath);
      const nextStepIndex = getLandingWizardNextStepIndex(effective.workspacePath);
      const wizardMeta = getLandingWizardMeta(effective.stateDir, effective.workspacePath);
      return {
        success: true,
        configPath: effective.configPath,
        stateDir: effective.stateDir,
        workspacePath: effective.workspacePath,
        files: status.files,
        completed: status.completed,
        nextStepIndex,
        ...wizardMeta,
      };
    } catch (err) {
      return {
        success: false,
        configPath: resolveCyDeckConfigPath(),
        stateDir: resolveCyDeckStateDir(),
        workspacePath: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle("terminal:landing-init", async (): Promise<TerminalLandingInitResult> => {
    try {
      const effective = getEffectiveConfig();
      const init = ensureLandingWorkspaceFiles(effective.workspacePath);
      const status = getLandingWorkspaceStatus(effective.workspacePath);
      const nextStepIndex = getLandingWizardNextStepIndex(effective.workspacePath);
      const wizardMeta = getLandingWizardMeta(effective.stateDir, effective.workspacePath);
      return {
        success: true,
        configPath: effective.configPath,
        stateDir: effective.stateDir,
        workspacePath: effective.workspacePath,
        created: init.created,
        existing: init.existing,
        files: status.files,
        completed: status.completed,
        nextStepIndex,
        ...wizardMeta,
      };
    } catch (err) {
      return {
        success: false,
        configPath: resolveCyDeckConfigPath(),
        stateDir: resolveCyDeckStateDir(),
        workspacePath: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle(
    "terminal:landing-set",
    async (_event, key: string, value: string): Promise<TerminalLandingSetResult> => {
      try {
        const normalizedKey = String(key).trim();
        if (!isLandingSetKey(normalizedKey)) {
          return {
            success: false,
            configPath: resolveCyDeckConfigPath(),
            stateDir: resolveCyDeckStateDir(),
            workspacePath: "",
            error: `Unsupported landing key: ${normalizedKey}`,
          };
        }

        const effective = getEffectiveConfig();
        ensureLandingWorkspaceFiles(effective.workspacePath);
        const result = setLandingField(effective.workspacePath, normalizedKey, value);
        const status = getLandingWorkspaceStatus(effective.workspacePath);
        const nextStepIndex = getLandingWizardNextStepIndex(effective.workspacePath);
        const wizardMeta = getLandingWizardMeta(effective.stateDir, effective.workspacePath);
        return {
          success: true,
          configPath: effective.configPath,
          stateDir: effective.stateDir,
          workspacePath: effective.workspacePath,
          key: result.key,
          value: result.value,
          filePath: result.filePath,
          fileName: result.fileName,
          files: status.files,
          completed: status.completed,
          nextStepIndex,
          ...wizardMeta,
        };
      } catch (err) {
        return {
          success: false,
          configPath: resolveCyDeckConfigPath(),
          stateDir: resolveCyDeckStateDir(),
          workspacePath: "",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    "terminal:landing-add",
    async (_event, target: string, note: string): Promise<TerminalLandingSetResult> => {
      try {
        const normalizedTarget = String(target).trim().toLowerCase();
        if (!isLandingAppendTarget(normalizedTarget)) {
          return {
            success: false,
            configPath: resolveCyDeckConfigPath(),
            stateDir: resolveCyDeckStateDir(),
            workspacePath: "",
            error: `Unsupported landing add target: ${target}`,
          };
        }

        const effective = getEffectiveConfig();
        ensureLandingWorkspaceFiles(effective.workspacePath);
        const result = appendLandingNote(effective.workspacePath, normalizedTarget, note);
        const status = getLandingWorkspaceStatus(effective.workspacePath);
        const nextStepIndex = getLandingWizardNextStepIndex(effective.workspacePath);
        const wizardMeta = getLandingWizardMeta(effective.stateDir, effective.workspacePath);
        return {
          success: true,
          configPath: effective.configPath,
          stateDir: effective.stateDir,
          workspacePath: effective.workspacePath,
          target: normalizedTarget,
          note: result.note,
          filePath: result.filePath,
          fileName: result.fileName,
          files: status.files,
          completed: status.completed,
          nextStepIndex,
          ...wizardMeta,
        };
      } catch (err) {
        return {
          success: false,
          configPath: resolveCyDeckConfigPath(),
          stateDir: resolveCyDeckStateDir(),
          workspacePath: "",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    "terminal:landing-wizard-save",
    async (_event, stepIndex: number): Promise<TerminalLandingStatusResult> => {
      try {
        const effective = getEffectiveConfig();
        ensureLandingWorkspaceFiles(effective.workspacePath);
        saveLandingWizardProgress(effective.stateDir, effective.workspacePath, stepIndex);
        const status = getLandingWorkspaceStatus(effective.workspacePath);
        const nextStepIndex = getLandingWizardNextStepIndex(effective.workspacePath);
        const wizardMeta = getLandingWizardMeta(effective.stateDir, effective.workspacePath);
        return {
          success: true,
          configPath: effective.configPath,
          stateDir: effective.stateDir,
          workspacePath: effective.workspacePath,
          files: status.files,
          completed: status.completed,
          nextStepIndex,
          ...wizardMeta,
        };
      } catch (err) {
        return {
          success: false,
          configPath: resolveCyDeckConfigPath(),
          stateDir: resolveCyDeckStateDir(),
          workspacePath: "",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle("terminal:landing-wizard-clear", async (): Promise<TerminalLandingStatusResult> => {
    try {
      const effective = getEffectiveConfig();
      clearLandingWizardProgress(effective.stateDir);
      const status = getLandingWorkspaceStatus(effective.workspacePath);
      const nextStepIndex = getLandingWizardNextStepIndex(effective.workspacePath);
      return {
        success: true,
        configPath: effective.configPath,
        stateDir: effective.stateDir,
        workspacePath: effective.workspacePath,
        files: status.files,
        completed: status.completed,
        nextStepIndex,
      };
    } catch (err) {
      return {
        success: false,
        configPath: resolveCyDeckConfigPath(),
        stateDir: resolveCyDeckStateDir(),
        workspacePath: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle("terminal:config-reset", async (): Promise<TerminalConfigResetResult> => {
    const configPath = resolveCyDeckConfigPath();
    const stateDir = resolveCyDeckStateDir();
    const writeResult = writeCyDeckConfigDocument(configPath, stateDir, cloneDefaultCyDeckConfigRecord());
    if (!writeResult.success) {
      return {
        success: false,
        configPath,
        stateDir,
        error: writeResult.error,
      };
    }

    try {
      const effective = getEffectiveConfig();
      return {
        success: true,
        configPath: effective.configPath,
        stateDir: effective.stateDir,
        validation: effective.validation,
        warnings: effective.warnings,
        issues: effective.issues,
      };
    } catch (err) {
      return {
        success: false,
        configPath,
        stateDir,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle(
    "terminal:config-set",
    async (_event, key: string, rawValue: string): Promise<TerminalConfigSetResult> => {
      const normalizedKey = typeof key === "string" ? key.trim() : "";
      const normalizedRawValue = typeof rawValue === "string" ? rawValue : "";
      const configPath = resolveCyDeckConfigPath();
      const stateDir = resolveCyDeckStateDir();

      if (!normalizedKey) {
        return {
          success: false,
          configPath,
          stateDir,
          error: "Missing config key. Usage: /config set <key> <value>",
        };
      }

      if (!isCyDeckMutableConfigKey(normalizedKey)) {
        return {
          success: false,
          configPath,
          stateDir,
          error: `Unsupported config key "${normalizedKey}". Mutable keys: ${formatMutableConfigKeysForHelp()}`,
        };
      }

      const coerced = coerceCyDeckConfigValue(normalizedKey, normalizedRawValue);
      if (!coerced.ok) {
        return {
          success: false,
          configPath,
          stateDir,
          error: coerced.error,
        };
      }

      const editable = loadEditableCyDeckConfigDocument();
      if (!editable.success || !editable.document) {
        return {
          success: false,
          configPath: editable.configPath,
          stateDir: editable.stateDir,
          error: editable.error ?? "Failed to load editable config document",
        };
      }

      assignConfigPathValue(editable.document, normalizedKey, coerced.value);
      const writeResult = writeCyDeckConfigDocument(editable.configPath, editable.stateDir, editable.document);
      if (!writeResult.success) {
        return {
          success: false,
          configPath: editable.configPath,
          stateDir: editable.stateDir,
          error: writeResult.error,
        };
      }

      try {
        const effective = getEffectiveConfig();
        const gatewayManager = getGatewayManager();
        const shouldApplyRuntimeProvider =
          normalizedKey === "ai.defaultProvider" || normalizedKey.startsWith("ai.providers.");
        if (shouldApplyRuntimeProvider) {
          const applyResult = applyRuntimeProviderToGateway(gatewayManager, effective.runtimeProvider);
          if (!applyResult.success) {
            return {
              success: false,
              configPath: effective.configPath,
              stateDir: effective.stateDir,
              key: normalizedKey,
              value: coerced.value,
              validation: effective.validation,
              warnings: effective.warnings,
              issues: effective.issues,
              error: applyResult.error,
            };
          }
        }

        if (normalizedKey === "workspace.path") {
          const applyResult = applyWorkspacePathToGateway(gatewayManager, effective.workspacePath);
          if (!applyResult.success) {
            return {
              success: false,
              configPath: effective.configPath,
              stateDir: effective.stateDir,
              key: normalizedKey,
              value: coerced.value,
              validation: effective.validation,
              warnings: effective.warnings,
              issues: effective.issues,
              error: applyResult.error,
            };
          }
        }

        return {
          success: true,
          configPath: effective.configPath,
          stateDir: effective.stateDir,
          key: normalizedKey,
          value: coerced.value,
          validation: effective.validation,
          warnings: effective.warnings,
          issues: effective.issues,
        };
      } catch (err) {
        return {
          success: false,
          configPath: editable.configPath,
          stateDir: editable.stateDir,
          error: err instanceof Error ? err.message : String(err),
          key: normalizedKey,
          value: coerced.value,
        };
      }
    },
  );
}
