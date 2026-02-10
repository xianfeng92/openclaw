import { Type } from "@sinclair/typebox";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { OpenClawConfig } from "../../config/config.js";
import { stringEnum } from "../schema/typebox.js";
import type { AnyAgentTool } from "./common.js";

const execAsync = promisify(exec);

const CLI_MODEL_ACTIONS = [
  "claude",
  "gpt",
] as const;

const CliModelToolSchema = Type.Object({
  action: stringEnum(CLI_MODEL_ACTIONS),
  prompt: Type.String(),
});

/**
 * CLI Model Tool - 允许 Agent 调用本地命令行 AI 工具
 *
 * 使用场景：
 * - 你有 claude 命令行工具但没有 API Key
 * - 你有 gpt 命令行工具但没有 API Key
 * - 想用本地工具替代昂贵的 API 调用
 *
 * 前置条件：
 * - 确保 claude 或 gpt 命令在 PATH 中可用
 * - 在 PowerShell 中测试：claude "hello"
 */
export function createCliModelTool(opts?: {
  agentSessionKey?: string;
  config?: OpenClawConfig;
}): AnyAgentTool {
  return {
    label: "CLI Model",
    name: "cli_model",
    description:
      "Call local CLI AI tools (claude, gpt) when API keys are not available. " +
      "Actions: 'claude' for Claude CLI, 'gpt' for GPT CLI. " +
      "Use this when you need Claude/GPT capabilities but only have Gemini API key configured.",
    parameters: CliModelToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = params.action as string;
      const prompt = params.prompt as string;

      if (!action || !prompt) {
        return {
          content: [
            {
              type: "text",
              text: "Error: action and prompt are required",
            },
          ],
          details: { error: "Missing parameters" },
        };
      }

      // 根据不同的 action 选择命令
      let command: string;
      let shell: string;

      if (action === "claude") {
        // Windows PowerShell 7
        command = `claude "${prompt.replace(/"/g, '\\"')}"`;
        shell = "pwsh"; // PowerShell 7
      } else if (action === "gpt") {
        command = `gpt "${prompt.replace(/"/g, '\\"')}"`;
        shell = "pwsh";
      } else {
        return {
          content: [
            {
              type: "text",
              text: `Error: unknown action "${action}". Supported actions: claude, gpt`,
            },
          ],
          details: { error: `Unknown action: ${action}` },
        };
      }

      try {
        // 执行命令，超时 120 秒
        const { stdout, stderr } = await execAsync(command, {
          shell,
          timeout: 120_000,
          windowsHide: true,
        });

        const output = stdout || stderr;
        const result = output.trim() || "No output from command";

        return {
          content: [
            {
              type: "text",
              text: result,
            },
          ],
          details: {
            action,
            prompt,
            output: result,
          },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: `Error calling CLI tool: ${errorMessage}`,
            },
          ],
          details: {
            action,
            prompt,
            error: errorMessage,
          },
        };
      }
    },
  };
}
