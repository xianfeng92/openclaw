import { ChildProcess, spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { EventEmitter } from "events";
import { app, net } from "electron";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type GatewayStatus = "stopped" | "starting" | "running" | "stopping" | "error";

export interface GatewayState {
  status: GatewayStatus;
  port: number;
  pid?: number;
  error?: string;
}

export class GatewayManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private status: GatewayStatus = "stopped";
  private port = 19001;
  private error: string | null = null;
  private externalProcess = false; // Track if gateway was started externally

  constructor() {
    super();
    // Read port from env or use default
    this.port = parseInt(process.env.OPENCLAW_GATEWAY_PORT || process.env.OPENCLAW_PORT || "19001", 10);
  }

  /**
   * Check if Gateway is already running on the configured port
   */
  private async isGatewayRunning(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = net.request({
        method: "GET",
        url: `http://127.0.0.1:${this.port}/`,
      });
      let resolved = false;

      const done = (result: boolean) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          // electron's ClientRequest is not Node's http.ClientRequest; use abort() to cancel.
          req.abort();
          resolve(result);
        }
      };

      // Timeout using setTimeout instead of req.setTimeout
      const timer = setTimeout(() => done(false), 1000);

      req.on("response", () => done(true));
      req.on("error", () => done(false));

      req.end();
    });
  }

  getState(): GatewayState {
    return {
      status: this.status,
      port: this.port,
      pid: this.process?.pid,
      error: this.error ?? undefined,
    };
  }

  async start(): Promise<void> {
    if (this.status === "running" || this.status === "starting") {
      return;
    }

    // Check if Gateway is already running (started by another process)
    const alreadyRunning = await this.isGatewayRunning();
    if (alreadyRunning) {
      this.status = "running";
      this.externalProcess = true;
      this.error = null;
      this.emit("state-changed", this.getState());
      console.log(`[Gateway] Already running on port ${this.port} (external process)`);
      return;
    }

    this.status = "starting";
    this.error = null;
    this.externalProcess = false;
    this.emit("state-changed", this.getState());

    try {
      // Determine how to run Gateway based on environment
      let command: string;
      let args: string[];
      let cwd: string;

      const isPackaged = app.isPackaged;
      if (isPackaged) {
        // Installed/portable app: shell out to npx to run the published CLI.
        console.log(`[Gateway] Packaged mode - using npx openclaw`);
        command = "npx";
        args = ["-y", "openclaw", "gateway"];
        cwd = process.env.APPDATA || path.resolve(__dirname, "../../../..");
      } else {
        // Dev: run the gateway from the local repo checkout.
        const repoRoot = path.resolve(__dirname, "../../../..");
        const scriptPath = path.join(repoRoot, "scripts", "run-node.mjs");

        console.log(`[Gateway] Dev mode - repoRoot: ${repoRoot}`);
        console.log(`[Gateway] scriptPath: ${scriptPath}`);

        if (!fs.existsSync(scriptPath)) {
          throw new Error(`Gateway runner not found at: ${scriptPath}`);
        }

        command = "node";
        args = [scriptPath, "--dev", "gateway"];
        cwd = repoRoot;
      }

      console.log(`[Gateway] Spawning: ${command} ${args.join(" ")}`);
      console.log(`[Gateway] Working directory: ${cwd}`);

      // Spawn the gateway process
      this.process = spawn(command, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          OPENCLAW_PROFILE: "desktop",
          OPENCLAW_SKIP_CHANNELS: "1",
          NODE_ENV: "production",
        },
        detached: false,
        shell: true, // Use shell to resolve npx properly
      });

      console.log(`[Gateway] Process spawned with PID: ${this.process.pid}`);

      this.process.on("error", (err) => {
        this.status = "error";
        this.error = err.message;
        this.emit("state-changed", this.getState());
        this.emit("error", err);
      });

      // Log stdout for debugging
      this.process.stdout?.on("data", (data) => {
        console.log(`[Gateway stdout] ${data}`);
      });

      // Log stderr for debugging
      this.process.stderr?.on("data", (data) => {
        const msg = data.toString();
        // Check if it's the "already running" error
        if (msg.includes("Gateway already running locally")) {
          // Gateway is already running, switch to external mode
          console.log("[Gateway] Detected already running Gateway");
          this.status = "running";
          this.externalProcess = true;
          this.process = null;
          this.emit("state-changed", this.getState());
          return;
        }
        console.error(`[Gateway stderr] ${msg}`);
      });

      this.process.on("exit", (code, signal) => {
        this.status = "stopped";
        this.process = null;
        this.emit("state-changed", this.getState());
        if (code && code !== 0) {
          this.error = `Gateway exited with code ${code}`;
          this.emit("error", new Error(this.error));
        }
      });

      // Wait a bit for startup
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (this.status === "starting") {
            this.status = "running";
            this.emit("state-changed", this.getState());
          }
          resolve(null);
        }, 3000);

        this.process?.once("exit", () => {
          clearTimeout(timeout);
          reject(new Error("Gateway process exited during startup"));
        });
      });

    } catch (err) {
      this.status = "error";
      this.error = err instanceof Error ? err.message : String(err);
      this.emit("state-changed", this.getState());
      this.emit("error", err);
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (this.status === "stopped" || this.status === "stopping") {
      return;
    }

    // If gateway was started externally, we can't stop it
    if (this.externalProcess) {
      this.status = "stopped";
      this.externalProcess = false;
      this.emit("state-changed", this.getState());
      console.log("[Gateway] Cannot stop external Gateway process");
      return;
    }

    this.status = "stopping";
    this.emit("state-changed", this.getState());

    if (this.process) {
      // Try graceful shutdown first
      this.process.kill("SIGTERM");

      // Force kill after 5 seconds
      setTimeout(() => {
        if (this.process && this.status !== "stopped") {
          this.process.kill("SIGKILL");
        }
      }, 5000);

      // Wait for exit
      await new Promise((resolve) => {
        this.process?.once("exit", () => resolve(null));
      });

      this.process = null;
    }

    this.status = "stopped";
    this.emit("state-changed", this.getState());
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  isRunning(): boolean {
    return this.status === "running";
  }
}
