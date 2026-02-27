/**
 * TUI Fallback Handler - 连接失败时的用户交互
 *
 * 当 Gateway 不可用时，提供用户友好的降级选项
 */

import type { AdapterFallbackChoice } from "./adapter-factory.js";

export type FallbackPromptOptions = {
  reason: string;
  timeoutMs?: number;
  defaultChoice?: AdapterFallbackChoice;
};

/**
 * 非交互式降级处理（用于脚本或 CI）
 */
export async function handleFallbackNonInteractive(
  options: FallbackPromptOptions
): Promise<AdapterFallbackChoice> {
  // 默认选择本地模式
  return options.defaultChoice ?? "local";
}

/**
 * TUI 降级提示选项
 */
export type FallbackChoice = {
  key: AdapterFallbackChoice;
  label: string;
  description: string;
};

const FALLBACK_CHOICES: FallbackChoice[] = [
  {
    key: "local",
    label: "Continue in local mode",
    description: "Run offline with embedded agent (limited features)",
  },
  {
    key: "gateway",
    label: "Wait and retry",
    description: "Try connecting to Gateway again",
  },
  {
    key: "exit",
    label: "Exit",
    description: "Close the terminal",
  },
];

/**
 * 格式化降级提示消息
 */
export function formatFallbackMessage(reason: string): string {
  return `
╔═══════════════════════════════════════════════════════════════╗
║                     ⚠️  Gateway Unavailable                    ║
╠═══════════════════════════════════════════════════════════════╣
║                                                                 ║
║  ${reason.padEnd(62)}║
║                                                                 ║
║  The Gateway could not be reached. Please choose an option:   ║
║                                                                 ║
`;
}

/**
 * 格式化选项列表
 */
export function formatFallbackChoices(): string {
  let output = "";
  FALLBACK_CHOICES.forEach((choice, index) => {
    const prefix = `  [${index + 1}] `;
    const label = choice.label.padEnd(32);
    output += `║${prefix}${label}│ ${choice.description.padEnd(30)}║\n`;
  });
  return output;
}

/**
 * 格式化提示尾部
 */
export function formatFallbackPrompt(): string {
  return `
║  Your choice (1-3):                                            ║
╚═══════════════════════════════════════════════════════════════╝
`;
}

/**
 * 完整的降级提示
 */
export function formatFallbackScreen(reason: string): string {
  return (
    formatFallbackMessage(reason) +
    formatFallbackChoices() +
    formatFallbackPrompt()
  );
}

/**
 * TUI 交互式降级处理
 *
 * 注意：这个函数需要在 TUI 启动之前调用，使用标准输入/输出
 */
export async function handleFallbackInteractive(
  options: FallbackPromptOptions
): Promise<AdapterFallbackChoice> {
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // 显示提示
    console.log(formatFallbackScreen(options.reason));

    // 读取用户选择
    const answer = await new Promise<string>((resolve) => {
      rl.question("", (ans) => resolve(ans));
    });

    const choice = parseInt(answer.trim(), 10);

    if (isNaN(choice) || choice < 1 || choice > FALLBACK_CHOICES.length) {
      console.log(`Invalid choice. Defaulting to local mode.`);
      return "local";
    }

    const selected = FALLBACK_CHOICES[choice - 1];
    console.log(`Selected: ${selected.label}\n`);

    return selected.key;
  } finally {
    rl.close();
  }
}

/**
 * 根据环境自动选择处理方式
 */
export async function handleFallback(
  options: FallbackPromptOptions
): Promise<AdapterFallbackChoice> {
  // 检测是否在交互式终端中
  const isInteractive = process.stdin.isTTY && process.stdout.isTTY;

  if (isInteractive) {
    return handleFallbackInteractive(options);
  } else {
    return handleFallbackNonInteractive(options);
  }
}

/**
 * 创建 TUI 内联降级处理器
 *
 * 用于在 TUI 运行时处理连接丢失（降级到本地模式）
 */
export function createTuiFallbackHandler() {
  return {
    /**
     * 在 TUI 内显示降级提示
     */
    async promptInTui(
      reason: string
    ): Promise<AdapterFallbackChoice> {
      // TODO: 实现 TUI 内的交互式选择
      // 目前返回默认值
      console.warn(`Gateway unavailable: ${reason}`);
      return "local";
    },

    /**
     * 格式化状态栏消息
     */
    formatStatusMessage(reason: string, mode: "disconnected" | "degraded"): string {
      if (mode === "disconnected") {
        return `⚠️  Disconnected: ${reason}`;
      }
      return `⚠️  Degraded: ${reason}`;
    },
  };
}
