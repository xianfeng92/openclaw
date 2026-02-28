/**
 * AGENTS.md command handlers
 * Handles /save-rule and /init-agents-md commands
 */

import type { CommandHandler } from "./commands-types.js";
import { logVerbose } from "../../globals.js";
import { saveRuleCommand, initAgentsMdCommand, readAgentsMd } from "../../commands/agents-md.js";

const SAVE_RULE_COMMAND = "/save-rule";
const INIT_AGENTS_MD_COMMAND = "/init-agents-md";

/**
 * Parse /save-rule command arguments
 * Format: /save-rule <content>
 */
function parseSaveRuleArgs(commandBody: string): { content?: string } {
  const trimmed = commandBody.trim();
  if (!trimmed.startsWith(SAVE_RULE_COMMAND)) {
    return {};
  }
  const content = trimmed.slice(SAVE_RULE_COMMAND.length).trim();
  return { content: content || undefined };
}

/**
 * Parse /init-agents-md command arguments
 * Format: /init-agents-md [--force] [-f]
 */
function parseInitAgentsMdArgs(commandBody: string): { force?: boolean } {
  const trimmed = commandBody.trim();
  if (!trimmed.startsWith(INIT_AGENTS_MD_COMMAND)) {
    return {};
  }
  const args = trimmed.slice(INIT_AGENTS_MD_COMMAND.length).trim();
  if (!args) {
    return {};
  }

  // Split by whitespace and check for exact flag matches
  const tokens = args.toLowerCase().split(/\s+/);
  const hasForceFlag = tokens.includes("--force") || tokens.includes("-f");

  return { force: hasForceFlag };
}

/**
 * Handle /save-rule command
 * Saves a rule to AGENTS.md in the current or specified workspace
 */
export const handleSaveRuleCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }

  const { content } = parseSaveRuleArgs(params.command.commandBodyNormalized);
  if (content === undefined) {
    return null; // Not a /save-rule command
  }

  if (!params.command.isAuthorizedSender) {
    logVerbose(`Ignoring /save-rule from unauthorized sender: ${params.command.senderId || "<unknown>"}`);
    return { shouldContinue: false };
  }

  // Reject empty content
  if (!content.trim()) {
    return {
      shouldContinue: false,
      reply: {
        text: "✗ /save-rule requires content. Usage: /save-rule <rule content>",
      },
    };
  }

  const result = await saveRuleCommand({ content, workspace: params.workspaceDir });

  if (result.success) {
    return {
      shouldContinue: false,
      reply: {
        text: `✓ Rule saved to ${result.filePath}`,
      },
    };
  }

  return {
    shouldContinue: false,
    reply: {
      text: `✗ Failed to save rule: ${result.error}`,
    },
  };
};

/**
 * Handle /init-agents-md command
 * Initializes AGENTS.md with project information
 */
export const handleInitAgentsMdCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }

  const { force } = parseInitAgentsMdArgs(params.command.commandBodyNormalized);
  if (!params.command.commandBodyNormalized.startsWith(INIT_AGENTS_MD_COMMAND)) {
    return null; // Not a /init-agents-md command
  }

  if (!params.command.isAuthorizedSender) {
    logVerbose(`Ignoring /init-agents-md from unauthorized sender: ${params.command.senderId || "<unknown>"}`);
    return { shouldContinue: false };
  }

  const result = await initAgentsMdCommand({ force, workspace: params.workspaceDir });

  if (result.success) {
    const statusMsg = result.created ? "created" : "updated";
    return {
      shouldContinue: false,
      reply: {
        text: `✓ AGENTS.md ${statusMsg} at ${result.filePath}`,
      },
    };
  }

  return {
    shouldContinue: false,
    reply: {
      text: `✗ Failed to initialize AGENTS.md: ${result.error}`,
    },
  };
};

/**
 * Get AGENTS.md content for context injection
 * This is used to inject project-specific rules into the agent's context
 */
export async function getAgentsMdContext(workspace?: string): Promise<string | undefined> {
  const result = await readAgentsMd(workspace);
  return result.content;
}
