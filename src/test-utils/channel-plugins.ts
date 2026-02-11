import type {
  ChannelCapabilities,
  ChannelId,
  ChannelOutboundAdapter,
  ChannelPlugin,
} from "../channels/plugins/types.js";
import type { PluginRegistry } from "../plugins/registry.js";
import { getChannelDock } from "../channels/dock.js";
import { getChatChannelMeta } from "../channels/registry.js";
import { deleteAccountFromConfigSection, setAccountEnabledInConfigSection } from "../channels/plugins/config-helpers.js";
import { applyAccountNameToChannelSection, migrateBaseNameToDefaultAccount } from "../channels/plugins/setup-helpers.js";
import { discordOnboardingAdapter } from "../channels/plugins/onboarding/discord.js";
import { imessageOnboardingAdapter } from "../channels/plugins/onboarding/imessage.js";
import { signalOnboardingAdapter } from "../channels/plugins/onboarding/signal.js";
import { slackOnboardingAdapter } from "../channels/plugins/onboarding/slack.js";
import { telegramOnboardingAdapter } from "../channels/plugins/onboarding/telegram.js";
import { whatsappOnboardingAdapter } from "../channels/plugins/onboarding/whatsapp.js";
import { discordOutbound } from "../channels/plugins/outbound/discord.js";
import { imessageOutbound } from "../channels/plugins/outbound/imessage.js";
import { signalOutbound } from "../channels/plugins/outbound/signal.js";
import { slackOutbound } from "../channels/plugins/outbound/slack.js";
import { telegramOutbound } from "../channels/plugins/outbound/telegram.js";
import { whatsappOutbound } from "../channels/plugins/outbound/whatsapp.js";
import { collectDiscordStatusIssues } from "../channels/plugins/status-issues/discord.js";
import { collectTelegramStatusIssues } from "../channels/plugins/status-issues/telegram.js";
import { collectWhatsAppStatusIssues } from "../channels/plugins/status-issues/whatsapp.js";
import { resolveDiscordAccount, listDiscordAccountIds } from "../discord/accounts.js";
import { normalizeIMessageHandle } from "../imessage/targets.js";
import { listSignalAccountIds, resolveSignalAccount } from "../signal/accounts.js";
import { listSlackAccountIds, resolveSlackAccount } from "../slack/accounts.js";
import { listTelegramAccountIds, resolveTelegramAccount } from "../telegram/accounts.js";
import { probeTelegram } from "../telegram/probe.js";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../routing/session-key.js";
import { listWhatsAppAccountIds, resolveWhatsAppAccount } from "../web/accounts.js";

export const createTestRegistry = (channels: PluginRegistry["channels"] = []): PluginRegistry => ({
  plugins: [],
  tools: [],
  hooks: [],
  typedHooks: [],
  channels,
  providers: [],
  gatewayHandlers: {},
  httpHandlers: [],
  httpRoutes: [],
  cliRegistrars: [],
  services: [],
  commands: [],
  diagnostics: [],
});

function capOrFallback(id: ChannelId): ChannelCapabilities {
  return getChannelDock(id)?.capabilities ?? { chatTypes: ["direct"] };
}

export const createIMessageTestPlugin = (params?: {
  outbound?: ChannelOutboundAdapter;
}): ChannelPlugin => ({
  id: "imessage",
  meta: {
    id: "imessage",
    label: "iMessage",
    selectionLabel: "iMessage (imsg)",
    docsPath: "/channels/imessage",
    blurb: "iMessage test stub.",
    aliases: ["imsg"],
  },
  capabilities: { chatTypes: ["direct", "group"], media: true },
  onboarding: imessageOnboardingAdapter,
  config: {
    listAccountIds: () => [],
    resolveAccount: () => ({}),
  },
  security: {},
  status: {
    collectStatusIssues: (accounts) =>
      accounts.flatMap((account) => {
        const lastError = typeof account.lastError === "string" ? account.lastError.trim() : "";
        if (!lastError) {
          return [];
        }
        return [
          {
            channel: "imessage",
            accountId: account.accountId,
            kind: "runtime",
            message: `Channel error: ${lastError}`,
          },
        ];
      }),
  },
  outbound: params?.outbound ?? imessageOutbound,
  messaging: {
    targetResolver: {
      looksLikeId: (raw) => {
        const trimmed = raw.trim();
        if (!trimmed) {
          return false;
        }
        if (/^(imessage:|sms:|auto:|chat_id:|chat_guid:|chat_identifier:)/i.test(trimmed)) {
          return true;
        }
        if (trimmed.includes("@")) {
          return true;
        }
        return /^\+?\d{3,}$/.test(trimmed);
      },
      hint: "<handle|chat_id:ID>",
    },
    normalizeTarget: (raw) => normalizeIMessageHandle(raw),
  },
});

export const createDiscordTestPlugin = (params?: { outbound?: ChannelOutboundAdapter }): ChannelPlugin => ({
  id: "discord",
  meta: getChatChannelMeta("discord"),
  capabilities: capOrFallback("discord"),
  onboarding: discordOnboardingAdapter,
  security: {},
  config: {
    listAccountIds: (cfg) => listDiscordAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveDiscordAccount({ cfg, accountId }),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: "discord",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: "discord",
        accountId,
        clearBaseFields: ["token", "name"],
      }),
    isEnabled: (account) => account.enabled,
    isConfigured: (account) => Boolean(account.token),
  },
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({ cfg, channelKey: "discord", accountId, name }),
    applyAccountConfig: ({ cfg, accountId, input }) => {
      const token = input.token?.trim() || "";
      let next = cfg;

      if (accountId !== DEFAULT_ACCOUNT_ID) {
        // If we are switching to multi-account, keep the base name by moving it to accounts.default.
        next = migrateBaseNameToDefaultAccount({ cfg: next, channelKey: "discord" });
        const baseToken = next.channels?.discord?.token?.trim();
        if (baseToken) {
          const existingDefault = next.channels?.discord?.accounts?.[DEFAULT_ACCOUNT_ID];
          const defaultToken = existingDefault?.token?.trim();
          if (!defaultToken) {
            next = {
              ...next,
              channels: {
                ...next.channels,
                discord: {
                  ...next.channels?.discord,
                  accounts: {
                    ...next.channels?.discord?.accounts,
                    [DEFAULT_ACCOUNT_ID]: {
                      ...existingDefault,
                      enabled: existingDefault?.enabled ?? true,
                      token: baseToken,
                    },
                  },
                  token: undefined,
                },
              },
            };
          }
        }
      }

      if (accountId === DEFAULT_ACCOUNT_ID && !next.channels?.discord?.accounts) {
        next = {
          ...next,
          channels: {
            ...next.channels,
            discord: {
              ...next.channels?.discord,
              enabled: true,
              ...(token ? { token } : {}),
            },
          },
        };
      } else {
        const existing = next.channels?.discord?.accounts?.[accountId];
        next = {
          ...next,
          channels: {
            ...next.channels,
            discord: {
              ...next.channels?.discord,
              enabled: true,
              accounts: {
                ...next.channels?.discord?.accounts,
                [accountId]: {
                  ...existing,
                  enabled: existing?.enabled ?? true,
                  ...(token ? { token } : {}),
                },
              },
            },
          },
        };
      }

      next = applyAccountNameToChannelSection({
        cfg: next,
        channelKey: "discord",
        accountId,
        name: input.name,
      });
      return next;
    },
  },
  outbound: params?.outbound ?? discordOutbound,
  status: {
    collectStatusIssues: collectDiscordStatusIssues,
  },
});

export const createSlackTestPlugin = (params?: { outbound?: ChannelOutboundAdapter }): ChannelPlugin => ({
  id: "slack",
  meta: getChatChannelMeta("slack"),
  capabilities: capOrFallback("slack"),
  onboarding: slackOnboardingAdapter,
  security: {},
  config: {
    listAccountIds: (cfg) => listSlackAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveSlackAccount({ cfg, accountId }),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: "slack",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: "slack",
        accountId,
        clearBaseFields: ["botToken", "appToken", "name"],
      }),
    isEnabled: (account) => account.enabled,
    isConfigured: (account) => Boolean(account.botToken && account.appToken),
  },
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({ cfg, channelKey: "slack", accountId, name }),
    applyAccountConfig: ({ cfg, accountId, input }) => {
      const botToken = input.botToken?.trim() || "";
      const appToken = input.appToken?.trim() || "";
      let next = cfg;
      if (accountId === DEFAULT_ACCOUNT_ID) {
        next = {
          ...next,
          channels: {
            ...next.channels,
            slack: {
              ...next.channels?.slack,
              enabled: true,
              ...(botToken ? { botToken } : {}),
              ...(appToken ? { appToken } : {}),
            },
          },
        };
      } else {
        const existing = next.channels?.slack?.accounts?.[accountId];
        next = {
          ...next,
          channels: {
            ...next.channels,
            slack: {
              ...next.channels?.slack,
              enabled: true,
              accounts: {
                ...next.channels?.slack?.accounts,
                [accountId]: {
                  ...existing,
                  enabled: existing?.enabled ?? true,
                  ...(botToken ? { botToken } : {}),
                  ...(appToken ? { appToken } : {}),
                },
              },
            },
          },
        };
      }
      next = applyAccountNameToChannelSection({
        cfg: next,
        channelKey: "slack",
        accountId,
        name: input.name,
      });
      return next;
    },
  },
  outbound: params?.outbound ?? slackOutbound,
});

export const createTelegramTestPlugin = (params?: { outbound?: ChannelOutboundAdapter }): ChannelPlugin => ({
  id: "telegram",
  meta: getChatChannelMeta("telegram"),
  capabilities: capOrFallback("telegram"),
  onboarding: telegramOnboardingAdapter,
  security: {},
  config: {
    listAccountIds: (cfg) => listTelegramAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveTelegramAccount({ cfg, accountId }),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: "telegram",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: "telegram",
        accountId,
        clearBaseFields: ["botToken", "tokenFile", "name"],
      }),
    isEnabled: (account) => account.enabled,
    isConfigured: (account) => Boolean(account.token),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveTelegramAccount({ cfg, accountId }).config.allowFrom ?? []).map((entry) =>
        String(entry),
      ),
  },
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({ cfg, channelKey: "telegram", accountId, name }),
    applyAccountConfig: ({ cfg, accountId, input }) => {
      const token = input.token?.trim() || "";
      const tokenFile = input.tokenFile?.trim() || "";
      let next = cfg;

      if (accountId !== DEFAULT_ACCOUNT_ID || Object.keys(next.channels?.telegram?.accounts ?? {}).length > 0) {
        next = migrateBaseNameToDefaultAccount({ cfg: next, channelKey: "telegram" });
      }

      if (accountId === DEFAULT_ACCOUNT_ID) {
        next = {
          ...next,
          channels: {
            ...next.channels,
            telegram: {
              ...next.channels?.telegram,
              enabled: true,
              ...(token ? { botToken: token } : {}),
              ...(tokenFile ? { tokenFile } : {}),
            },
          },
        };
      } else {
        const existing = next.channels?.telegram?.accounts?.[accountId];
        next = {
          ...next,
          channels: {
            ...next.channels,
            telegram: {
              ...next.channels?.telegram,
              enabled: true,
              accounts: {
                ...next.channels?.telegram?.accounts,
                [accountId]: {
                  ...existing,
                  enabled: existing?.enabled ?? true,
                  ...(token ? { botToken: token } : {}),
                  ...(tokenFile ? { tokenFile } : {}),
                },
              },
            },
          },
        };
      }

      next = applyAccountNameToChannelSection({
        cfg: next,
        channelKey: "telegram",
        accountId,
        name: input.name,
      });
      return next;
    },
  },
  outbound: params?.outbound ?? telegramOutbound,
  status: {
    probeAccount: async ({ account, timeoutMs }) => {
      const token = (account as ReturnType<typeof resolveTelegramAccount>).token;
      return await probeTelegram(token, timeoutMs, (account as ReturnType<typeof resolveTelegramAccount>).config.proxy);
    },
    collectStatusIssues: collectTelegramStatusIssues,
  },
  messaging: {
    targetResolver: {
      looksLikeId: (raw) => Boolean(raw?.trim()),
      hint: "<chat_id>",
    },
    normalizeTarget: (raw) => raw.trim(),
  },
});

export const createWhatsAppTestPlugin = (params?: { outbound?: ChannelOutboundAdapter }): ChannelPlugin => ({
  id: "whatsapp",
  meta: getChatChannelMeta("whatsapp"),
  capabilities: capOrFallback("whatsapp"),
  onboarding: whatsappOnboardingAdapter,
  security: {},
  config: {
    listAccountIds: (cfg) => listWhatsAppAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveWhatsAppAccount({ cfg, accountId }),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: "whatsapp",
        accountId,
        enabled,
        allowTopLevel: false,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: "whatsapp",
        accountId,
      }),
    isEnabled: (account) => (account as ReturnType<typeof resolveWhatsAppAccount>).enabled,
    isConfigured: async () => true,
    resolveAllowFrom: ({ cfg, accountId }) =>
      resolveWhatsAppAccount({ cfg, accountId }).allowFrom?.map((entry) => String(entry)),
  },
  setup: {
    resolveAccountId: ({ accountId }) => accountId?.trim() || DEFAULT_ACCOUNT_ID,
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({
        cfg,
        channelKey: "whatsapp",
        accountId,
        name,
        alwaysUseAccounts: true,
      }),
    applyAccountConfig: ({ cfg, accountId, input }) => {
      let next = cfg;
      const normalizedId = accountId?.trim() || DEFAULT_ACCOUNT_ID;
      const accounts = next.channels?.whatsapp?.accounts ?? {};
      const existing = accounts[normalizedId];
      next = {
        ...next,
        channels: {
          ...next.channels,
          whatsapp: {
            ...next.channels?.whatsapp,
            accounts: {
              ...accounts,
              [normalizedId]: {
                ...existing,
                enabled: existing?.enabled ?? true,
              },
            },
          },
        },
      };
      return applyAccountNameToChannelSection({
        cfg: next,
        channelKey: "whatsapp",
        accountId: normalizedId,
        name: input.name,
        alwaysUseAccounts: true,
      });
    },
  },
  outbound: params?.outbound ?? whatsappOutbound,
  status: {
    collectStatusIssues: collectWhatsAppStatusIssues,
  },
});

export const createSignalTestPlugin = (params?: { outbound?: ChannelOutboundAdapter }): ChannelPlugin => ({
  id: "signal",
  meta: getChatChannelMeta("signal"),
  capabilities: capOrFallback("signal"),
  onboarding: signalOnboardingAdapter,
  security: {},
  config: {
    listAccountIds: (cfg) => listSignalAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveSignalAccount({ cfg, accountId }),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: "signal",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: "signal",
        accountId,
        clearBaseFields: ["account", "name"],
      }),
    isEnabled: (account) => (account as ReturnType<typeof resolveSignalAccount>).enabled,
    isConfigured: (account) => (account as ReturnType<typeof resolveSignalAccount>).configured,
  },
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({ cfg, channelKey: "signal", accountId, name }),
    applyAccountConfig: ({ cfg, accountId, input }) => {
      const number = input.signalNumber?.trim() || "";
      let next = cfg;
      const section = next.channels?.signal;
      const hasAccounts = Boolean(section?.accounts && Object.keys(section.accounts).length > 0);
      if (accountId === DEFAULT_ACCOUNT_ID && !hasAccounts) {
        next = {
          ...next,
          channels: {
            ...next.channels,
            signal: {
              ...section,
              enabled: true,
              ...(number ? { account: number } : {}),
            },
          },
        };
      } else {
        const existing = section?.accounts?.[accountId];
        next = {
          ...next,
          channels: {
            ...next.channels,
            signal: {
              ...section,
              enabled: true,
              accounts: {
                ...section?.accounts,
                [accountId]: {
                  ...existing,
                  enabled: existing?.enabled ?? true,
                  ...(number ? { account: number } : {}),
                },
              },
            },
          },
        };
      }
      next = applyAccountNameToChannelSection({
        cfg: next,
        channelKey: "signal",
        accountId,
        name: input.name,
      });
      return next;
    },
  },
  outbound: params?.outbound ?? signalOutbound,
  status: {
    collectStatusIssues: (accounts) =>
      accounts.flatMap((account) => {
        const lastError = typeof account.lastError === "string" ? account.lastError.trim() : "";
        if (!lastError) {
          return [];
        }
        return [
          {
            channel: "signal",
            accountId: account.accountId,
            kind: "runtime",
            message: `Channel error: ${lastError}`,
          },
        ];
      }),
  },
});

export const createOutboundTestPlugin = (params: {
  id: ChannelId;
  outbound: ChannelOutboundAdapter;
  label?: string;
  docsPath?: string;
  capabilities?: ChannelCapabilities;
}): ChannelPlugin => ({
  id: params.id,
  meta: {
    id: params.id,
    label: params.label ?? String(params.id),
    selectionLabel: params.label ?? String(params.id),
    docsPath: params.docsPath ?? `/channels/${params.id}`,
    blurb: "test stub.",
  },
  capabilities: params.capabilities ?? { chatTypes: ["direct"] },
  config: {
    listAccountIds: () => [],
    resolveAccount: () => ({}),
  },
  outbound: params.outbound,
});
