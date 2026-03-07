import { EventEmitter } from "node:events";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { app } from "electron";
import type { CyDeckEffectiveConfig, CyDeckRuntimeProviderConfig } from "./cydeck-config.js";
import {
  applyCyDeckOpenClawEnv,
  buildCyDeckOpenClawEnv,
  resolveCyDeckOpenClawBridgePaths,
  writeCyDeckOpenClawBridge,
  type CyDeckOpenClawBridgePaths,
} from "./openclaw-gateway-bridge.js";
import type { GatewayLike, GatewayState, GatewayStatus } from "./gateway-like.js";
import { rotateGatewayAuthToken } from "./gateway-auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);

type SpawnFn = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;

type WaitForPortFn = (port: number, timeoutMs: number) => Promise<void>;

type GatewayLaunch = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
};

export type OpenClawGatewayManagerOptions = {
  effectiveConfig: CyDeckEffectiveConfig;
  spawnImpl?: SpawnFn;
  waitForPortImpl?: WaitForPortFn;
  log?: Pick<typeof console, "log" | "warn" | "error">;
};

function createTcpProbeWaiter(port: number, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({
        host: "127.0.0.1",
        port,
      });

      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });

      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Gateway failed to listen on port ${port} within ${timeoutMs}ms`));
          return;
        }
        setTimeout(tryConnect, 100);
      });
    };

    tryConnect();
  });
}

function resolveGatewayCommand(): { command: string; baseArgs: string[]; cwd: string } {
  const repoRoot = path.resolve(__dirname, "../../../../");
  if (!app.isPackaged) {
    return {
      // In Electron dev, process.execPath points at electron.exe, not node.exe.
      // Match the proven agent launch path so the root gateway starts under Node.
      command: "node",
      baseArgs: [path.join(repoRoot, "scripts", "run-node.mjs"), "--profile", "desktop", "gateway"],
      cwd: repoRoot,
    };
  }

  return {
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    baseArgs: ["-y", "openclaw", "--profile", "desktop", "gateway"],
    cwd: process.cwd(),
  };
}

async function taskkillProcessTree(pid: number): Promise<void> {
  if (process.platform !== "win32") {
    return;
  }
  try {
    await execFileAsync("taskkill", ["/F", "/T", "/PID", String(pid)], {
      windowsHide: true,
    });
  } catch {
    // Best effort.
  }
}

export class OpenClawGatewayManager extends EventEmitter implements GatewayLike {
  private readonly spawnImpl: SpawnFn;
  private readonly waitForPortImpl: WaitForPortFn;
  private readonly log: Pick<typeof console, "log" | "warn" | "error">;

  private effectiveConfig: CyDeckEffectiveConfig;
  private bridgePaths: CyDeckOpenClawBridgePaths;
  private port: number;
  private authToken: string;
  private child: ChildProcessWithoutNullStreams | null = null;
  private status: GatewayStatus = "stopped";
  private lastError: string | undefined;

  constructor(port: number, authToken: string, options: OpenClawGatewayManagerOptions) {
    super();
    this.port = Number.isFinite(port) && port > 0 ? Math.floor(port) : 19001;
    this.authToken = authToken.trim();
    this.effectiveConfig = {
      ...options.effectiveConfig,
      config: {
        ...options.effectiveConfig.config,
        gateway: {
          ...options.effectiveConfig.config.gateway,
          port: this.port,
        },
      },
    };
    this.bridgePaths = resolveCyDeckOpenClawBridgePaths(this.effectiveConfig.stateDir);
    this.spawnImpl = options.spawnImpl ?? spawn;
    this.waitForPortImpl = options.waitForPortImpl ?? createTcpProbeWaiter;
    this.log = options.log ?? console;
    this.syncBridgeArtifacts();
  }

  getState(): GatewayState {
    return {
      status: this.status,
      port: this.port,
      pid: this.child?.pid,
      error: this.lastError,
    };
  }

  getAuthToken(): string {
    return this.authToken;
  }

  isRunning(): boolean {
    return this.status === "running";
  }

  reloadRuntimeProvider(runtimeProvider?: CyDeckRuntimeProviderConfig): void {
    if (!runtimeProvider) {
      return;
    }
    this.effectiveConfig = {
      ...this.effectiveConfig,
      runtimeProvider,
    };
    this.syncBridgeArtifacts();
  }

  reloadWorkspacePath(workspacePath?: string): void {
    const normalized = typeof workspacePath === "string" ? workspacePath.trim() : "";
    if (!normalized) {
      return;
    }
    this.effectiveConfig = {
      ...this.effectiveConfig,
      workspacePath: normalized,
      config: {
        ...this.effectiveConfig.config,
        workspace: {
          ...this.effectiveConfig.config.workspace,
          path: normalized,
        },
      },
    };
    this.syncBridgeArtifacts();
  }

  rotateAuthToken(newToken?: string): { token: string; path: string } {
    if (newToken && newToken.trim()) {
      this.authToken = newToken.trim();
      this.syncBridgeArtifacts();
      if (this.isRunning()) {
        void this.restart().catch((err) => {
          this.log.error("[CyDeckGateway] Failed to restart after auth token update:", err);
        });
      }
      return { token: this.authToken, path: "" };
    }

    const rotated = rotateGatewayAuthToken();
    this.authToken = rotated.token;
    this.syncBridgeArtifacts();
    if (this.isRunning()) {
      void this.restart().catch((err) => {
        this.log.error("[CyDeckGateway] Failed to restart after auth token rotation:", err);
      });
    }
    return rotated;
  }

  async start(): Promise<void> {
    if (this.status === "running" || this.status === "starting") {
      return;
    }

    this.setState("starting");
    this.syncBridgeArtifacts();

    const launch = this.buildLaunch();
    const child = this.spawnImpl(launch.command, launch.args, {
      cwd: launch.cwd,
      env: launch.env,
      shell: false,
      windowsHide: true,
      stdio: "pipe",
    });
    this.child = child;

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        this.log.log(`[CyDeckGateway] ${text}`);
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        this.log.warn(`[CyDeckGateway][stderr] ${text}`);
      }
    });

    child.once("exit", (code, signal) => {
      const message =
        this.status === "stopping"
          ? undefined
          : `Gateway exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "none"})`;
      this.child = null;
      this.setState(message ? "error" : "stopped", message);
    });

    try {
      await this.waitForPortImpl(this.port, 15_000);
      this.setState("running");
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      await this.stop();
      this.setState("error", this.lastError);
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (this.status === "stopped" || this.status === "stopping") {
      return;
    }

    this.setState("stopping");
    const child = this.child;
    this.child = null;

    if (child) {
      const exitPromise = new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
      });

      if (!child.killed) {
        child.kill();
      }

      const forcedKillTimer = setTimeout(() => {
        if (child.pid) {
          void taskkillProcessTree(child.pid);
        }
      }, 1500);

      await exitPromise.catch(() => undefined);
      clearTimeout(forcedKillTimer);
    }

    this.setState("stopped");
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  private buildLaunch(): GatewayLaunch {
    const command = resolveGatewayCommand();
    const env = {
      ...process.env,
      ...buildCyDeckOpenClawEnv({
        config: this.effectiveConfig,
        authToken: this.authToken,
        paths: this.bridgePaths,
      }),
      OPENCLAW_QUIET_BUILD: "1",
    };

    return {
      command: command.command,
      args: [
        ...command.baseArgs,
        "--port",
        String(this.port),
        "--bind",
        "loopback",
        "--token",
        this.authToken,
        "--allow-unconfigured",
      ],
      cwd: command.cwd,
      env,
    };
  }

  private syncBridgeArtifacts(): void {
    this.bridgePaths = writeCyDeckOpenClawBridge({
      config: this.effectiveConfig,
      authToken: this.authToken,
    });
    applyCyDeckOpenClawEnv({
      targetEnv: process.env,
      config: this.effectiveConfig,
      authToken: this.authToken,
      paths: this.bridgePaths,
    });
  }

  private setState(status: GatewayStatus, error?: string): void {
    const previousStatus = this.status;
    const previousError = this.lastError;

    this.status = status;
    this.lastError = status === "error" ? error ?? "Unknown gateway error" : undefined;

    if (previousStatus === this.status && previousError === this.lastError) {
      return;
    }

    this.emit("state-changed", this.getState());
  }
}
