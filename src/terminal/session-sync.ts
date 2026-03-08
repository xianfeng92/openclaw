/**
 * Session Sync - 会话连续性支持
 *
 * 实现模式切换时的会话上下文转移：
 * - Gateway → Local: 复制会话历史到本地存储
 * - Local → Gateway: 会话由 Gateway 管理（自动同步）
 *
 * 设计原则：
 * - 本地模式使用与 Gateway 相同的存储格式
 * - 切换时无缝转移，用户无感知
 * - 优先保证当前会话不丢失
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type { TerminalAdapter, HistoryEntry } from "./adapter-types.js";
import type { SessionInfo } from "../tui/tui-types.js";
import {
  resolveLocalSessionHistoryPath,
  resolveLocalSessionMetadataPath,
} from "./local-session-paths.js";

/**
 * 会话元数据（与 Gateway 格式兼容）
 */
export type SessionMetadata = {
  type: "session";
  version: number;
  id: string;
  timestamp: string;
  cwd?: string;
  // 扩展字段
  agentId?: string;
  model?: string;
  thinkingLevel?: string;
  lastMessage?: string;
  totalTokens?: number;
};

/**
 * 会话转移结果
 */
export type SessionTransferResult = {
  success: boolean;
  entriesTransferred: number;
  metadata?: SessionMetadata;
  error?: string;
};

/**
 * 解析会话文件路径
 */
function resolveSessionFilePath(sessionKey: string): string {
  return resolveLocalSessionHistoryPath(sessionKey);
}

/**
 * 解析会话元数据路径
 */
function resolveSessionMetaPath(sessionKey: string): string {
  return resolveLocalSessionMetadataPath(sessionKey);
}

/**
 * 读取会话历史（JSONL 格式）
 */
export async function readSessionHistory(sessionKey: string): Promise<HistoryEntry[]> {
  const path = resolveSessionFilePath(sessionKey);

  if (!existsSync(path)) {
    return [];
  }

  const content = await readFile(path, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  const entries: HistoryEntry[] = [];
  for (const line of lines) {
    // 跳过会话头（以 {"type": "session" 开头的 JSON）
    if (line.includes('"type": "session"')) {
      continue;
    }

    try {
      const entry = JSON.parse(line) as HistoryEntry;
      entries.push(entry);
    } catch {
      // 忽略无效行
    }
  }

  return entries;
}

/**
 * 写入会话历史（JSONL 格式）
 */
export async function writeSessionHistory(
  sessionKey: string,
  entries: HistoryEntry[],
  options?: { append?: boolean }
): Promise<void> {
  const path = resolveSessionFilePath(sessionKey);
  await mkdir(dirname(path), { recursive: true });

  const lines = entries.map((e) => JSON.stringify(e));
  const content = lines.join("\n") + "\n";

  if (options?.append && existsSync(path)) {
    const existing = await readFile(path, "utf-8");
    await writeFile(path, existing + content, "utf-8");
  } else {
    await writeFile(path, content, "utf-8");
  }
}

/**
 * 读取会话元数据
 */
export async function readSessionMetadata(sessionKey: string): Promise<SessionMetadata | null> {
  const path = resolveSessionMetaPath(sessionKey);

  if (!existsSync(path)) {
    return null;
  }

  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as SessionMetadata;
  } catch {
    return null;
  }
}

/**
 * 写入会话元数据
 */
export async function writeSessionMetadata(
  sessionKey: string,
  metadata: SessionMetadata
): Promise<void> {
  const path = resolveSessionMetaPath(sessionKey);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(metadata, null, 2), "utf-8");
}

/**
 * 从历史记录中提取元数据
 */
export function extractMetadataFromHistory(
  entries: HistoryEntry[],
  sessionKey: string
): SessionMetadata {
  const assistantMessages = entries.filter((e) => e.role === "assistant");
  const lastMessage = assistantMessages[assistantMessages.length - 1];

  // 计算总 token 数（粗略估计）
  const totalTokens = entries.reduce((sum, e) => {
    const contentLength = e.content.length;
    return sum + Math.ceil(contentLength / 4);
  }, 0);

  return {
    type: "session",
    version: 1,
    id: sessionKey,
    timestamp: new Date().toISOString(),
    cwd: process.cwd(),
    lastMessage: lastMessage?.content?.slice(0, 100) ?? "",
    totalTokens,
  };
}

/**
 * 转移会话到本地存储
 *
 * 当从 Gateway 模式切换到本地模式时调用
 */
export async function transferSessionToLocal(params: {
  sessionKey: string;
  history: HistoryEntry[];
  sessionInfo: SessionInfo;
}): Promise<SessionTransferResult> {
  const { sessionKey, history, sessionInfo } = params;

  try {
    // 1. 写入会话历史
    await writeSessionHistory(sessionKey, history);

    // 2. 生成并写入元数据
    const metadata: SessionMetadata = {
      type: "session",
      version: 1,
      id: sessionKey,
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
      agentId: sessionInfo.model, // 使用 model 作为代理
      model: sessionInfo.model,
      thinkingLevel: sessionInfo.thinkingLevel,
      lastMessage: history[history.length - 1]?.content?.slice(0, 100) ?? "",
      totalTokens: sessionInfo.totalTokens ?? undefined,
    };

    await writeSessionMetadata(sessionKey, metadata);

    return {
      success: true,
      entriesTransferred: history.length,
      metadata,
    };
  } catch (err) {
    return {
      success: false,
      entriesTransferred: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 同步会话到新适配器
 *
 * 在模式切换时调用，确保会话连续性
 */
export async function syncSessionToAdapter(params: {
  from: TerminalAdapter;
  to: TerminalAdapter;
  sessionKey: string;
  currentHistory: HistoryEntry[];
  sessionInfo: SessionInfo;
}): Promise<SessionTransferResult> {
  const { from, to, sessionKey, currentHistory, sessionInfo } = params;

  // 如果目标适配器是 Gateway，无需操作（Gateway 会自动管理）
  if (to.mode === "gateway") {
    return {
      success: true,
      entriesTransferred: 0,
    };
  }

  // 如果源适配器是 Local，目标也是 Local，无需操作
  if (from.mode === "local" && to.mode === "local") {
    return {
      success: true,
      entriesTransferred: 0,
    };
  }

  // Gateway → Local: 转移会话
  return await transferSessionToLocal({
    sessionKey,
    history: currentHistory,
    sessionInfo,
  });
}

/**
 * 获取会话摘要信息
 */
export async function getSessionSummary(sessionKey: string): Promise<{
  entryCount: number;
  lastMessage?: string;
  totalTokens?: number;
  metadata?: SessionMetadata;
}> {
  const history = await readSessionHistory(sessionKey);
  const metadata = await readSessionMetadata(sessionKey);

  return {
    entryCount: history.length,
    lastMessage: history[history.length - 1]?.content,
    totalTokens: metadata?.totalTokens,
    metadata: metadata ?? undefined,
  };
}

/**
 * 合并两个会话历史
 */
export function mergeSessionHistories(
  base: HistoryEntry[],
  additional: HistoryEntry[]
): HistoryEntry[] {
  const merged = [...base];
  const existingKeys = new Set<string>();

  // 为现有条目创建键（用于去重）
  for (const entry of base) {
    const key = `${entry.role}:${entry.timestamp}:${entry.content.slice(0, 50)}`;
    existingKeys.add(key);
  }

  // 添加新条目（去重）
  for (const entry of additional) {
    const key = `${entry.role}:${entry.timestamp}:${entry.content.slice(0, 50)}`;
    if (!existingKeys.has(key)) {
      merged.push(entry);
      existingKeys.add(key);
    }
  }

  return merged.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
}
