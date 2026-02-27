/**
 * TUI Local CLI
 *
 * Standalone terminal mode - no Gateway required.
 * This is the MVP proof-of-concept for the decoupled architecture.
 *
 * Usage: openclaw tui-local
 */

import type { Command } from "commander";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { LocalAdapter } from "../terminal/local-adapter.js";
import type { TerminalAdapter } from "../terminal/adapter-types.js";
import { loadConfig } from "../config/config.js";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import {
  buildAgentMainSessionKey,
  normalizeAgentId,
  normalizeMainKey,
} from "../routing/session-key.js";

/**
 * Simple TUI implementation for local mode
 * (Minimal implementation for MVP validation)
 */
async function runLocalTui() {
  const config = loadConfig();
  const agentDefaultId = resolveDefaultAgentId(config);
  const sessionMainKey = normalizeMainKey(config.session?.mainKey);
  const currentSessionKey = buildAgentMainSessionKey({
    agentId: agentDefaultId,
    mainKey: sessionMainKey,
  });

  // Create local adapter
  const adapter: TerminalAdapter = new LocalAdapter();

  // Set up event listeners
  adapter.onEvent((event) => {
    if (event.type === "chat") {
      const payload = event.payload as { reply?: string; runId?: string };
      if (payload.reply) {
        defaultRuntime.log(`\n🤖 ${payload.reply}`);
      }
    } else if (event.type === "error") {
      const payload = event.payload as { error?: string };
      if (payload.error) {
        defaultRuntime.error(`\n❌ Error: ${payload.error}`);
      }
    }
  });

  // Start adapter
  defaultRuntime.log(`🦞 Super AI Terminal - Local Mode`);
  defaultRuntime.log(`Session: ${currentSessionKey}`);
  defaultRuntime.log(`Agent: ${agentDefaultId}`);
  defaultRuntime.log(`\nType your message and press Enter. Use Ctrl+C to exit.\n`);

  await adapter.start();

  // Simple REPL loop
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = (query: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(query, (answer) => {
        resolve(answer);
      });
    });
  };

  try {
    while (true) {
      const input = await askQuestion("❯ ");

      if (!input.trim()) {
        continue;
      }

      if (input === "/quit" || input === "/exit") {
        break;
      }

      if (input === "/status") {
        const status = adapter.getStatus();
        defaultRuntime.log(`Mode: ${status.mode} | Connected: ${status.connected}`);
        continue;
      }

      if (input === "/agents") {
        const agents = await adapter.listAgents();
        defaultRuntime.log(`Agents: ${agents.agents.map((a) => a.id).join(", ")}`);
        continue;
      }

      if (input.startsWith("/load ")) {
        const sessionKey = input.slice(6);
        const history = await adapter.loadHistory({ sessionKey, limit: 5 });
        defaultRuntime.log(`History for "${sessionKey}": ${history.entries.length} entries`);
        for (const entry of history.entries.slice(-5)) {
          const preview = entry.content.slice(0, 60);
          defaultRuntime.log(`  [${entry.role}] ${preview}...`);
        }
        continue;
      }

      // Send as chat message
      defaultRuntime.log("\n🔄 Thinking...");
      const result = await adapter.sendChat({
        sessionKey: currentSessionKey,
        message: input,
        timeoutMs: 30000,
      });

      if (result.status === "error" && result.error) {
        defaultRuntime.error(`Error: ${result.error}`);
      }
    }
  } finally {
    adapter.stop();
    rl.close();
    defaultRuntime.log("\n👋 Goodbye!");
  }
}

export function registerTuiLocalCli(program: Command) {
  program
    .command("tui-local")
    .description("Run Super AI Terminal in standalone local mode (no Gateway)")
    .option("--message <text>", "Send an initial message after starting")
    .addHelpText(
      "after",
      () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/tui", "docs.openclaw.ai/cli/tui")}\n`,
    )
    .action(async (opts) => {
      try {
        await runLocalTui();
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });
}
