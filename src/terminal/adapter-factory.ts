/**
 * Adapter Factory - 智能适配器选择与优雅降级
 *
 * 实现在线优先策略：
 * 1. 显式本地模式 → LocalAdapter
 * 2. 尝试连接 Gateway
 *    - 成功 → GatewayAdapter
 *    - 失败 → 询问用户 (重试/本地模式/退出)
 */

import type { TerminalAdapter } from "./adapter-types.js";
import type { HistoryEntry, SessionInfo } from "./adapter-types.js";
import { GatewayAdapter } from "./gateway-adapter.js";
import { LocalAdapter } from "./local-adapter.js";
import { syncSessionToAdapter } from "./session-sync.js";

export type AdapterFallbackChoice = "gateway" | "local" | "exit";

export type AdapterFactoryOptions = {
  // 显式本地模式标志
  localMode?: boolean;
  // Gateway 连接参数
  url?: string;
  token?: string;
  password?: string;
  // 连接超时 (ms)
  connectionTimeoutMs?: number;
  // 最大重试次数
  maxRetries?: number;
  // 用户回调（连接失败时调用）
  onFallback?: (reason: string) => Promise<AdapterFallbackChoice>;
  // 连接状态回调
  onConnecting?: () => void;
  onConnected?: (mode: "gateway" | "local") => void;
};

/**
 * 连接超时错误
 */
class AdapterConnectionTimeout extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdapterConnectionTimeout";
  }
}

/**
 * 带超时的 Promise
 */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage = "Connection timeout"
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new AdapterConnectionTimeout(errorMessage)), timeoutMs)
    ),
  ]);
}

/**
 * 尝试连接 Gateway
 */
async function tryConnectGateway(
  options: Omit<AdapterFactoryOptions, "onFallback" | "onConnecting" | "onConnected">
): Promise<{ adapter: GatewayAdapter; error?: Error }> {
  const adapter = new GatewayAdapter({
    url: options.url,
    token: options.token,
    password: options.password,
  });

  try {
    await withTimeout(
      adapter.start(),
      options.connectionTimeoutMs ?? 5000,
      "Gateway connection timeout"
    );

    if (!adapter.isReady()) {
      throw new Error("Gateway not ready after connection");
    }

    return { adapter };
  } catch (err) {
    adapter.stop();
    return { adapter, error: err as Error };
  }
}

/**
 * 创建适配器（带降级逻辑）
 */
export async function createAdapter(
  options: AdapterFactoryOptions = {}
): Promise<TerminalAdapter> {
  const {
    localMode = false,
    connectionTimeoutMs = 5000,
    maxRetries = 1,
    onFallback,
    onConnecting,
    onConnected,
    ...gatewayOptions
  } = options;

  // 1. 显式本地模式
  if (localMode) {
    const adapter = new LocalAdapter();
    await adapter.start();
    onConnected?.("local");
    return adapter;
  }

  // 2. 尝试连接 Gateway（带重试）
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= (maxRetries ?? 1); attempt++) {
    if (attempt > 0) {
      // 重试前等待
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }

    onConnecting?.();
    const result = await tryConnectGateway({
      ...gatewayOptions,
      connectionTimeoutMs,
    });

    if (!result.error) {
      onConnected?.("gateway");
      return result.adapter;
    }

    lastError = result.error;
  }

  // 3. 所有尝试失败，调用用户回调
  if (onFallback) {
    const reason = lastError?.message ?? "Unknown connection error";
    const choice = await onFallback(reason);

    switch (choice) {
      case "local":
        const localAdapter = new LocalAdapter();
        await localAdapter.start();
        onConnected?.("local");
        return localAdapter;

      case "gateway":
        // 用户选择重试
        return createAdapter({
          ...options,
          maxRetries: (options.maxRetries ?? 1) + 1,
        });

      case "exit":
        throw new Error(`Gateway unavailable and user chose to exit: ${reason}`);

      default:
        throw new Error(`Invalid fallback choice: ${choice}`);
    }
  }

  // 4. 没有回调时默认抛出错误
  throw lastError ?? new Error("Failed to connect to Gateway");
}

/**
 * 简单的连接测试（用于非 TUI 场景）
 */
export async function testGatewayConnection(
  options: Omit<AdapterFactoryOptions, "onFallback" | "onConnecting" | "onConnected"> = {}
): Promise<{ connected: boolean; mode: "gateway" | "local"; error?: string }> {
  try {
    const adapter = await createAdapter({
      ...options,
      onFallback: async () => "exit", // 不询问，直接退出
    });

    return {
      connected: true,
      mode: adapter.mode,
    };
  } catch (err) {
    return {
      connected: false,
      mode: "local",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 适配器切换参数
 */
export type AdapterSwitchOptions = {
  from: TerminalAdapter;
  toMode: "gateway" | "local";
  sessionKey: string;
  currentHistory: HistoryEntry[];
  sessionInfo: SessionInfo;
  gatewayOptions?: {
    url?: string;
    token?: string;
    password?: string;
  };
  onSyncComplete?: (result: SessionSyncResult) => void;
};

/**
 * 会话同步结果
 */
export type SessionSyncResult = {
  success: boolean;
  entriesTransferred: number;
  error?: string;
};

/**
 * 切换适配器（带会话同步）
 *
 * 在运行时从一种模式切换到另一种模式时调用
 */
export async function switchAdapter(
  options: AdapterSwitchOptions
): Promise<{ adapter: TerminalAdapter; syncResult: SessionSyncResult }> {
  const {
    from,
    toMode,
    sessionKey,
    currentHistory,
    sessionInfo,
    gatewayOptions = {},
    onSyncComplete,
  } = options;

  // 1. 创建新适配器
  let newAdapter: TerminalAdapter;

  if (toMode === "gateway") {
    // 切换到 Gateway 模式
    newAdapter = new GatewayAdapter(gatewayOptions);
    await newAdapter.start();
  } else {
    // 切换到本地模式
    newAdapter = new LocalAdapter();
    await newAdapter.start();
  }

  // 2. 同步会话到新适配器
  const syncResult: SessionSyncResult = await syncSessionToAdapter({
    from,
    to: newAdapter,
    sessionKey,
    currentHistory,
    sessionInfo,
  });

  // 3. 通知同步完成
  if (onSyncComplete) {
    onSyncComplete(syncResult);
  }

  return { adapter: newAdapter, syncResult };
}

/**
 * 切换到本地模式（便捷函数）
 */
export async function switchToLocalMode(params: {
  from: TerminalAdapter;
  sessionKey: string;
  currentHistory: HistoryEntry[];
  sessionInfo: SessionInfo;
  onSyncComplete?: (result: SessionSyncResult) => void;
}): Promise<{ adapter: TerminalAdapter; syncResult: SessionSyncResult }> {
  return switchAdapter({
    ...params,
    toMode: "local",
  });
}

/**
 * 切换到 Gateway 模式（便捷函数）
 */
export async function switchToGatewayMode(params: {
  from: TerminalAdapter;
  gatewayOptions?: {
    url?: string;
    token?: string;
    password?: string;
  };
  sessionKey: string;
  currentHistory: HistoryEntry[];
  sessionInfo: SessionInfo;
  onSyncComplete?: (result: SessionSyncResult) => void;
}): Promise<{ adapter: TerminalAdapter; syncResult: SessionSyncResult }> {
  return switchAdapter({
    ...params,
    toMode: "gateway",
  });
}
