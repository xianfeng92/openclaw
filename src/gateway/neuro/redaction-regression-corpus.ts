import type { NeuroContextSource, NeuroRedactionLevel } from "./redaction.js";

export type SecretLeakageRegressionCase = {
  id: string;
  source: NeuroContextSource;
  payload: Record<string, unknown>;
  minLevel: NeuroRedactionLevel;
  forbiddenLiterals: string[];
  requiredReasons?: string[];
};

export const SECRET_LEAKAGE_REGRESSION_CORPUS: SecretLeakageRegressionCase[] = [
  {
    id: "clipboard-env-assignment",
    source: "clipboard",
    payload: {
      text: "OPENAI_API_KEY=sk-LiveSecretValue1234567890",
    },
    minLevel: "hash",
    forbiddenLiterals: ["sk-LiveSecretValue1234567890"],
    requiredReasons: ["pattern.secret.assignment"],
  },
  {
    id: "clipboard-json-token",
    source: "clipboard",
    payload: {
      text: '{"token":"ghp_abcdefghijklmnopqrstuvwxyz123456"}',
    },
    minLevel: "hash",
    forbiddenLiterals: ["ghp_abcdefghijklmnopqrstuvwxyz123456"],
    requiredReasons: ["pattern.secret.json_field"],
  },
  {
    id: "active-window-url-query",
    source: "active_window",
    payload: {
      app: "Browser",
      title: "Dashboard",
      url: "https://openclaw.ai/dashboard?token=abc123secret#section",
    },
    minLevel: "mask",
    forbiddenLiterals: ["abc123secret", "?token=", "#section"],
    requiredReasons: ["source.filter.active_window_url_query_removed"],
  },
  {
    id: "terminal-bearer-header",
    source: "terminal",
    payload: {
      output: "Authorization: Bearer 1234567890abcdefghijklmnopqrstuvwxyz",
    },
    minLevel: "hash",
    forbiddenLiterals: ["1234567890abcdefghijklmnopqrstuvwxyz"],
    requiredReasons: ["pattern.secret.bearer"],
  },
  {
    id: "fs-content-blocked",
    source: "fs",
    payload: {
      path: "/workspace/.env",
      action: "modified",
      content: "TOKEN=secret-value-123",
    },
    minLevel: "block",
    forbiddenLiterals: ["secret-value-123", "TOKEN=secret-value-123"],
    requiredReasons: ["source.filter.fs_payload_content_removed"],
  },
  {
    id: "editor-private-key",
    source: "editor",
    payload: {
      file: "/workspace/id_rsa",
      selection:
        "-----BEGIN PRIVATE KEY-----\nAAAABBBBCCCCDDDD\nEEEFFFFGGGHHH\n-----END PRIVATE KEY-----",
    },
    minLevel: "block",
    forbiddenLiterals: ["AAAABBBBCCCCDDDD", "EEEFFFFGGGHHH"],
    requiredReasons: ["pattern.secret.private_key_block"],
  },
  {
    id: "clipboard-pii",
    source: "clipboard",
    payload: {
      text: "Reach me at jane.doe@example.com or +1 415 555 1234",
    },
    minLevel: "mask",
    forbiddenLiterals: ["jane.doe@example.com", "+1 415 555 1234"],
    requiredReasons: ["pattern.sensitive.email", "pattern.sensitive.phone"],
  },
];
