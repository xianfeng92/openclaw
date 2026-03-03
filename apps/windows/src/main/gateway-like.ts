import type { CyDeckRuntimeProviderConfig } from "./cydeck-config.js";

export type GatewayStatus = "stopped" | "starting" | "running" | "stopping" | "error";

export type GatewayState = {
  status: GatewayStatus;
  port: number;
  pid?: number;
  error?: string;
};

export type GatewayStateChangeListener = (state: GatewayState) => void;

export interface GatewayLike {
  getState(): GatewayState;
  getAuthToken(): string;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  isRunning(): boolean;
  reloadRuntimeProvider?(runtimeProvider?: CyDeckRuntimeProviderConfig): void;
  rotateAuthToken(newToken?: string): { token: string; path: string } | void;
  on(event: "state-changed", listener: GatewayStateChangeListener): this;
  off(event: "state-changed", listener: GatewayStateChangeListener): this;
}
