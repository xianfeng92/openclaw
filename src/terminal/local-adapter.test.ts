/**
 * Local Adapter Test
 *
 * Simple test script to verify the standalone terminal adapter works.
 * Run with: pnpm tsx src/terminal/local-adapter.test.ts
 */

import { LocalAdapter } from "./local-adapter.js";
import { resolveStateDir } from "../config/paths.js";

async function testLocalAdapter() {
  console.log("🦞 Testing Local Adapter for Super AI Terminal\n");

  const adapter = new LocalAdapter();

  // Test 1: Start adapter
  console.log("Test 1: Starting adapter...");
  await adapter.start();
  const status = adapter.getStatus();
  console.log(`  Mode: ${status.mode}`);
  console.log(`  Connected: ${status.connected}`);
  console.log(`  Message: ${status.message}\n`);

  // Test 2: List agents
  console.log("Test 2: Listing agents...");
  const agents = await adapter.listAgents();
  console.log(`  Default agent: ${agents.defaultId}`);
  console.log(`  Available agents: ${agents.agents.map((a) => a.id).join(", ")}\n`);

  // Test 3: List models
  console.log("Test 3: Listing models...");
  const models = await adapter.listModels();
  console.log(`  Available models: ${models.models.length}`);
  console.log(`  Sample models:`);
  for (const model of models.models.slice(0, 5)) {
    console.log(`    - ${model.name} (${model.provider})${model.reasoning ? " [reasoning]" : ""}`);
  }
  console.log();

  // Test 4: Send a chat message
  console.log("Test 4: Sending chat message...");
  const chatResult = await adapter.sendChat({
    sessionKey: "test-session",
    message: "Hello! Please respond with 'Local adapter works!'",
    timeoutMs: 30000,
  });
  console.log(`  Run ID: ${chatResult.runId}`);
  console.log(`  Status: ${chatResult.status}`);
  if (chatResult.error) {
    console.log(`  Error: ${chatResult.error}`);
  }
  console.log();

  // Test 5: Load history
  console.log("Test 5: Loading history...");
  await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait a bit
  const history = await adapter.loadHistory({
    sessionKey: "test-session",
    limit: 10,
  });
  console.log(`  History entries: ${history.entries.length}`);
  for (const entry of history.entries) {
    const preview = entry.content.slice(0, 60);
    console.log(`    [${entry.role}] ${preview}${entry.content.length > 60 ? "..." : ""}`);
  }
  console.log();

  // Test 6: List sessions
  console.log("Test 6: Listing sessions...");
  const sessions = await adapter.listSessions({ limit: 5 });
  console.log(`  Sessions: ${sessions.sessions.length}`);
  for (const session of sessions.sessions) {
    console.log(`    - ${session.key}${session.lastMessagePreview ? `: "${session.lastMessagePreview.slice(0, 40)}"` : ""}`);
  }
  console.log();

  // Cleanup
  adapter.stop();
  console.log("✅ All tests completed!");
}

// Run tests
testLocalAdapter().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
