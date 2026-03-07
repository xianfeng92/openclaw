export type CyDeckChatRuntime = "gateway" | "legacy";

export function resolveCyDeckChatRuntime(
  env: NodeJS.ProcessEnv = process.env,
): CyDeckChatRuntime {
  const raw = env.CYDECK_CHAT_RUNTIME?.trim().toLowerCase();
  return raw === "legacy" ? "legacy" : "gateway";
}
