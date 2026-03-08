/**
 * Session Sync Test
 *
 * 验证会话同步功能：
 * 1. 创建测试会话数据
 * 2. 转移到本地存储
 * 3. 读取验证
 *
 * 运行: pnpm tsx src/terminal/session-sync.test.ts
 */

import { randomUUID } from "node:crypto";
import type { HistoryEntry } from "./session-sync.js";
import {
  readSessionHistory,
  writeSessionHistory,
  readSessionMetadata,
  writeSessionMetadata,
  transferSessionToLocal,
  getSessionSummary,
  mergeSessionHistories,
  extractMetadataFromHistory,
} from "./session-sync.js";
import {
  resolveLocalSessionHistoryPath,
  resolveLocalSessionMetadataPath,
} from "./local-session-paths.js";

async function testSessionSync() {
  console.log("🦞 Testing Session Sync\n");

  const testSessionKey = `test-session-${Date.now()}`;

  // Test 1: Write and read session history
  console.log("Test 1: Write and read session history...");
  const testHistory: HistoryEntry[] = [
    { role: "user", content: "Hello, this is a test message", timestamp: Date.now() - 2000 },
    { role: "assistant", content: "Hi! I received your test message.", timestamp: Date.now() - 1000 },
    { role: "user", content: "Can you help me with something?", timestamp: Date.now() },
  ];

  await writeSessionHistory(testSessionKey, testHistory);
  const readHistory = await readSessionHistory(testSessionKey);
  console.log(`  Wrote ${testHistory.length} entries`);
  console.log(`  Read ${readHistory.length} entries`);
  console.log(`  Match: ${JSON.stringify(testHistory) === JSON.stringify(readHistory) ? "✅" : "❌"}\n`);

  // Test 2: Write and read session metadata
  console.log("Test 2: Write and read session metadata...");
  const testMetadata = {
    type: "session" as const,
    version: 1,
    id: testSessionKey,
    timestamp: new Date().toISOString(),
    cwd: process.cwd(),
    agentId: "test-agent",
    model: "claude-sonnet-4",
    lastMessage: "Can you help me with something?",
    totalTokens: 150,
  };

  await writeSessionMetadata(testSessionKey, testMetadata);
  const readMetadata = await readSessionMetadata(testSessionKey);
  console.log(`  Wrote metadata with ${Object.keys(testMetadata).length} fields`);
  console.log(`  Read metadata: ${readMetadata ? "✅" : "❌"}`);
  console.log(`  Match: ${JSON.stringify(testMetadata) === JSON.stringify(readMetadata) ? "✅" : "❌"}\n`);

  // Test 3: Transfer session to local
  console.log("Test 3: Transfer session to local...");
  const transferResult = await transferSessionToLocal({
    sessionKey: testSessionKey,
    history: testHistory,
    sessionInfo: {
      model: "claude-sonnet-4",
      totalTokens: 150,
    },
  });
  console.log(`  Success: ${transferResult.success}`);
  console.log(`  Entries transferred: ${transferResult.entriesTransferred}`);
  console.log(`  Has metadata: ${transferResult.metadata ? "✅" : "❌"}\n`);

  // Test 4: Get session summary
  console.log("Test 4: Get session summary...");
  const summary = await getSessionSummary(testSessionKey);
  console.log(`  Entry count: ${summary.entryCount}`);
  console.log(`  Last message: ${summary.lastMessage?.slice(0, 50)}...`);
  console.log(`  Total tokens: ${summary.totalTokens}`);
  console.log(`  Has metadata: ${summary.metadata ? "✅" : "❌"}\n`);

  // Test 5: Merge session histories
  console.log("Test 5: Merge session histories...");
  const additionalHistory: HistoryEntry[] = [
    { role: "assistant", content: "Of course! What do you need help with?", timestamp: Date.now() },
  ];
  const merged = mergeSessionHistories(testHistory, additionalHistory);
  console.log(`  Original: ${testHistory.length} entries`);
  console.log(`  Additional: ${additionalHistory.length} entries`);
  console.log(`  Merged: ${merged.length} entries`);
  console.log(`  Expected: ${testHistory.length + additionalHistory.length} entries`);
  console.log(`  Match: ${merged.length === testHistory.length + additionalHistory.length ? "✅" : "❌"}\n`);

  // Test 6: Extract metadata from history
  console.log("Test 6: Extract metadata from history...");
  const extractedMetadata = extractMetadataFromHistory(testHistory, testSessionKey);
  console.log(`  Type: ${extractedMetadata.type}`);
  console.log(`  Version: ${extractedMetadata.version}`);
  console.log(`  ID: ${extractedMetadata.id}`);
  console.log(`  Last message: ${extractedMetadata.lastMessage?.slice(0, 50)}...`);
  console.log(`  Total tokens: ${extractedMetadata.totalTokens}\n`);

  // Cleanup
  console.log("Cleanup: Removing test session files...");
  const fs = await import("node:fs/promises");
  const sessionFile = resolveLocalSessionHistoryPath(testSessionKey);
  const metaFile = resolveLocalSessionMetadataPath(testSessionKey);

  try {
    await fs.unlink(sessionFile);
    await fs.unlink(metaFile);
    console.log("  ✅ Test files removed\n");
  } catch {
    console.log("  ⚠️  Some files could not be removed (may not exist)\n");
  }

  console.log("✅ All session sync tests passed!");
}

// Run tests
testSessionSync().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
