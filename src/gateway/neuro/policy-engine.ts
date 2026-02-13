import type { SuggestionCard } from "../protocol/schema/types.js";

export type NeuroPolicyDecision = {
  allowed: boolean;
  code: string;
  reason: string;
};

type NeuroPolicyInput = {
  action: "apply" | "dismiss" | "undo" | "explain";
  card: SuggestionCard;
  effectiveFlags: {
    flowMode: boolean;
    killSwitch: boolean;
  };
  operation?: string;
};

type NeuroPolicyOptions = {
  hardDenyOperations?: string[];
};

const DEFAULT_HARD_DENY_OPERATIONS = [
  "rm_rf",
  "delete_root",
  "format_disk",
  "drop_database",
  "credential_exfiltration",
  "shutdown_host",
  "reboot_host",
];

function normalizeToken(input: string): string {
  return input.trim().toLowerCase();
}

export function createNeuroPolicyEngine(options: NeuroPolicyOptions = {}) {
  const hardDenyList = new Set(
    (options.hardDenyOperations ?? DEFAULT_HARD_DENY_OPERATIONS)
      .map((item) => normalizeToken(item))
      .filter(Boolean),
  );

  return {
    evaluate(input: NeuroPolicyInput): NeuroPolicyDecision {
      if (input.action !== "apply") {
        return {
          allowed: true,
          code: "ALLOW_NON_APPLY",
          reason: "Non-apply action bypasses apply policy gate.",
        };
      }

      if (input.effectiveFlags.killSwitch) {
        return {
          allowed: false,
          code: "DENY_KILL_SWITCH",
          reason: "Neuro kill switch is enabled.",
        };
      }

      if (input.card.mode === "flow" && !input.effectiveFlags.flowMode) {
        return {
          allowed: false,
          code: "DENY_FLOW_DISABLED",
          reason: "Flow mode is disabled by runtime policy.",
        };
      }

      const op = typeof input.operation === "string" ? normalizeToken(input.operation) : "";
      if (op && hardDenyList.has(op)) {
        return {
          allowed: false,
          code: "DENY_HARD_LIST",
          reason: `Operation '${op}' is hard-denied by policy.`,
        };
      }

      return {
        allowed: true,
        code: "ALLOW",
        reason: "Action passes safe/flow policy checks.",
      };
    },
  };
}

export type NeuroPolicyEngineService = ReturnType<typeof createNeuroPolicyEngine>;
