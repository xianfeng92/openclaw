import type { GatewayRequestHandlers, GatewayRequestOptions } from "./server-methods/types.js";
import { ErrorCodes, errorShape } from "./protocol/index.js";
import { agentHandlers } from "./server-methods/agent.js";
import { agentsHandlers } from "./server-methods/agents.js";
import { browserHandlers } from "./server-methods/browser.js";
import { channelsHandlers } from "./server-methods/channels.js";
import { chatHandlers } from "./server-methods/chat.js";
import { configHandlers } from "./server-methods/config.js";
import { connectHandlers } from "./server-methods/connect.js";
import { cronHandlers } from "./server-methods/cron.js";
import { cydeckHandlers } from "./server-methods/cydeck.js";
import { deviceHandlers } from "./server-methods/devices.js";
import { execApprovalsHandlers } from "./server-methods/exec-approvals.js";
import { healthHandlers } from "./server-methods/health.js";
import { logsHandlers } from "./server-methods/logs.js";
import { modelsHandlers } from "./server-methods/models.js";
import { neuroHandlers } from "./server-methods/neuro.js";
import { nodeHandlers } from "./server-methods/nodes.js";
import { sendHandlers } from "./server-methods/send.js";
import { sessionsHandlers } from "./server-methods/sessions.js";
import { skillsHandlers } from "./server-methods/skills.js";
import { systemHandlers } from "./server-methods/system.js";
import { talkHandlers } from "./server-methods/talk.js";
import { ttsHandlers } from "./server-methods/tts.js";
import { updateHandlers } from "./server-methods/update.js";
import { usageHandlers } from "./server-methods/usage.js";
import { voicewakeHandlers } from "./server-methods/voicewake.js";
import { webHandlers } from "./server-methods/web.js";
import { wizardHandlers } from "./server-methods/wizard.js";

const ADMIN_SCOPE = "operator.admin";
const READ_SCOPE = "operator.read";
const WRITE_SCOPE = "operator.write";
const APPROVALS_SCOPE = "operator.approvals";
const PAIRING_SCOPE = "operator.pairing";

export type GatewayMethodAccess =
  | "node-role"
  | "approvals"
  | "pairing"
  | "read"
  | "write"
  | "admin";

const EXACT_METHOD_ACCESS = {
  "exec.approval.request": "approvals",
  "exec.approval.resolve": "approvals",
  "node.invoke.result": "node-role",
  "node.event": "node-role",
  "skills.bins": "node-role",
  "node.pair.request": "pairing",
  "node.pair.list": "pairing",
  "node.pair.approve": "pairing",
  "node.pair.reject": "pairing",
  "node.pair.verify": "pairing",
  "device.pair.list": "pairing",
  "device.pair.approve": "pairing",
  "device.pair.reject": "pairing",
  "device.token.rotate": "pairing",
  "device.token.revoke": "pairing",
  "node.rename": "pairing",
  health: "read",
  "logs.tail": "read",
  "channels.status": "read",
  status: "read",
  "usage.status": "read",
  "usage.cost": "read",
  "tts.status": "read",
  "tts.providers": "read",
  "models.list": "read",
  "agents.list": "read",
  "agent.identity.get": "read",
  "skills.status": "read",
  "voicewake.get": "read",
  "sessions.list": "read",
  "sessions.preview": "read",
  "cron.list": "read",
  "cron.status": "read",
  "cron.runs": "read",
  "system-presence": "read",
  "last-heartbeat": "read",
  "node.list": "read",
  "node.describe": "read",
  "chat.history": "read",
  "tools.memory.search": "read",
  "tools.memory.get": "read",
  "neuro.context.snapshot": "read",
  "neuro.suggestion.list": "read",
  "neuro.behavior.export": "read",
  "neuro.predict.preview": "read",
  "neuro.flags.get": "read",
  "neuro.metrics.get": "read",
  send: "write",
  agent: "write",
  "agent.wait": "write",
  wake: "write",
  "talk.mode": "write",
  "tts.enable": "write",
  "tts.disable": "write",
  "tts.convert": "write",
  "tts.setProvider": "write",
  "voicewake.set": "write",
  "node.invoke": "write",
  "chat.send": "write",
  "chat.abort": "write",
  "session.rotate": "write",
  "browser.request": "write",
  "neuro.context.ingest": "write",
  "neuro.suggestion.upsert": "write",
  "neuro.suggestion.action": "write",
  "neuro.behavior.delete": "write",
  "neuro.behavior.retention.run": "write",
  "neuro.flags.set": "write",
  "neuro.metrics.observe": "write",
  "channels.logout": "admin",
  "skills.install": "admin",
  "skills.update": "admin",
  "cron.add": "admin",
  "cron.update": "admin",
  "cron.remove": "admin",
  "cron.run": "admin",
  "sessions.patch": "admin",
  "sessions.reset": "admin",
  "sessions.delete": "admin",
  "sessions.compact": "admin",
} as const satisfies Record<string, GatewayMethodAccess>;

const PREFIX_METHOD_ACCESS: ReadonlyArray<{
  prefix: string;
  access: GatewayMethodAccess;
}> = [
  { prefix: "exec.approvals.", access: "admin" },
  { prefix: "config.", access: "admin" },
  { prefix: "wizard.", access: "admin" },
  { prefix: "update.", access: "admin" },
];

export function resolveGatewayMethodAccess(method: string): GatewayMethodAccess {
  const exact = EXACT_METHOD_ACCESS[method as keyof typeof EXACT_METHOD_ACCESS];
  if (exact) {
    return exact;
  }

  const prefixMatch = PREFIX_METHOD_ACCESS.find((entry) => method.startsWith(entry.prefix));
  if (prefixMatch) {
    return prefixMatch.access;
  }

  return "admin";
}

function authorizeGatewayMethod(method: string, client: GatewayRequestOptions["client"]) {
  if (!client?.connect) {
    return null;
  }
  const role = client.connect.role ?? "operator";
  const scopes = client.connect.scopes ?? [];
  const access = resolveGatewayMethodAccess(method);
  if (access === "node-role") {
    if (role === "node") {
      return null;
    }
    return errorShape(ErrorCodes.INVALID_REQUEST, `unauthorized role: ${role}`);
  }
  if (role === "node") {
    return errorShape(ErrorCodes.INVALID_REQUEST, `unauthorized role: ${role}`);
  }
  if (role !== "operator") {
    return errorShape(ErrorCodes.INVALID_REQUEST, `unauthorized role: ${role}`);
  }
  if (scopes.includes(ADMIN_SCOPE)) {
    return null;
  }
  if (access === "approvals") {
    if (!scopes.includes(APPROVALS_SCOPE)) {
      return errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.approvals");
    }
    return null;
  }
  if (access === "pairing") {
    if (!scopes.includes(PAIRING_SCOPE)) {
      return errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.pairing");
    }
    return null;
  }
  if (access === "read") {
    if (!(scopes.includes(READ_SCOPE) || scopes.includes(WRITE_SCOPE))) {
      return errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.read");
    }
    return null;
  }
  if (access === "write") {
    if (!scopes.includes(WRITE_SCOPE)) {
      return errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.write");
    }
    return null;
  }
  return errorShape(ErrorCodes.INVALID_REQUEST, "missing scope: operator.admin");
}

export const coreGatewayHandlers: GatewayRequestHandlers = {
  ...connectHandlers,
  ...logsHandlers,
  ...voicewakeHandlers,
  ...healthHandlers,
  ...channelsHandlers,
  ...chatHandlers,
  ...cydeckHandlers,
  ...cronHandlers,
  ...deviceHandlers,
  ...execApprovalsHandlers,
  ...webHandlers,
  ...modelsHandlers,
  ...neuroHandlers,
  ...configHandlers,
  ...wizardHandlers,
  ...talkHandlers,
  ...ttsHandlers,
  ...skillsHandlers,
  ...sessionsHandlers,
  ...systemHandlers,
  ...updateHandlers,
  ...nodeHandlers,
  ...sendHandlers,
  ...usageHandlers,
  ...agentHandlers,
  ...agentsHandlers,
  ...browserHandlers,
};

export async function handleGatewayRequest(
  opts: GatewayRequestOptions & { extraHandlers?: GatewayRequestHandlers },
): Promise<void> {
  const { req, respond, client, isWebchatConnect, context } = opts;
  const authError = authorizeGatewayMethod(req.method, client);
  if (authError) {
    respond(false, undefined, authError);
    return;
  }
  const handler = opts.extraHandlers?.[req.method] ?? coreGatewayHandlers[req.method];
  if (!handler) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, `unknown method: ${req.method}`),
    );
    return;
  }
  await handler({
    req,
    params: (req.params ?? {}) as Record<string, unknown>,
    client,
    isWebchatConnect,
    respond,
    context,
  });
}
