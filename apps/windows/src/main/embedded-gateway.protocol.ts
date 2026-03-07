import { timingSafeEqual } from "node:crypto";
import type { RawData, WebSocket } from "ws";

export const GATEWAY_PROTOCOL_VERSION = 3;
const WS_READY_STATE_OPEN = 1;

export type GatewayRequest = {
  type: "req";
  id: string;
  method: string;
  params?: Record<string, unknown>;
  auth?: { token?: string };
};

type GatewayResponse = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { message: string; code?: number };
};

type GatewayEventFrame = {
  type: "event";
  event: string;
  payload: Record<string, unknown>;
};

export type ConnectValidationResult =
  | { ok: true; clientId?: string }
  | { ok: false; message: string; code: number };

function isProtocolCompatible(params: Record<string, unknown>): boolean {
  const minProtocol =
    typeof params.minProtocol === "number" && Number.isFinite(params.minProtocol)
      ? Math.floor(params.minProtocol)
      : undefined;
  const maxProtocol =
    typeof params.maxProtocol === "number" && Number.isFinite(params.maxProtocol)
      ? Math.floor(params.maxProtocol)
      : undefined;

  if (minProtocol !== undefined && minProtocol > GATEWAY_PROTOCOL_VERSION) {
    return false;
  }
  if (maxProtocol !== undefined && maxProtocol < GATEWAY_PROTOCOL_VERSION) {
    return false;
  }
  return true;
}

function isTokenValid(expectedToken: string, candidate: string): boolean {
  const expected = Buffer.from(expectedToken);
  const provided = Buffer.from(candidate);
  if (expected.length !== provided.length) {
    return false;
  }
  return timingSafeEqual(expected, provided);
}

function resolveRequestToken(
  params: Record<string, unknown>,
  auth?: { token?: string },
): string | undefined {
  const paramsAuth = params.auth;
  const paramsToken =
    paramsAuth && typeof paramsAuth === "object"
      ? (paramsAuth as Record<string, unknown>).token
      : undefined;

  return typeof auth?.token === "string"
    ? auth.token
    : typeof paramsToken === "string"
      ? paramsToken
      : undefined;
}

function resolveClientId(params: Record<string, unknown>): string | undefined {
  const client = params.client;
  if (!client || typeof client !== "object") {
    return undefined;
  }

  const clientId = (client as Record<string, unknown>).id;
  return typeof clientId === "string" && clientId.trim() ? clientId.trim() : undefined;
}

export function parseGatewayRequest(raw: RawData): GatewayRequest | null {
  const text =
    typeof raw === "string"
      ? raw
      : raw instanceof ArrayBuffer
        ? Buffer.from(raw).toString("utf-8")
        : Array.isArray(raw)
          ? Buffer.concat(raw).toString("utf-8")
          : Buffer.from(raw).toString("utf-8");

  let frame: GatewayRequest;
  try {
    frame = JSON.parse(text) as GatewayRequest;
  } catch {
    return null;
  }

  if (!frame || frame.type !== "req" || typeof frame.id !== "string") {
    return null;
  }

  if (typeof frame.method !== "string" || !frame.method.trim()) {
    return null;
  }

  return frame;
}

export function validateConnectRequest(input: {
  expectedToken: string;
  params: Record<string, unknown>;
  auth?: { token?: string };
}): ConnectValidationResult {
  const { expectedToken, params, auth } = input;
  if (!isProtocolCompatible(params)) {
    return {
      ok: false,
      message: `Protocol mismatch. Embedded Gateway supports protocol ${GATEWAY_PROTOCOL_VERSION}.`,
      code: 426,
    };
  }

  const tokenFromRequest = resolveRequestToken(params, auth);
  if (!tokenFromRequest || !isTokenValid(expectedToken, tokenFromRequest)) {
    return {
      ok: false,
      message: "Unauthorized",
      code: 401,
    };
  }

  return {
    ok: true,
    clientId: resolveClientId(params),
  };
}

export function createConnectOkPayload(): Record<string, unknown> {
  return {
    type: "hello-ok",
    protocol: GATEWAY_PROTOCOL_VERSION,
    server: {
      name: "CyDeck Embedded Gateway",
      version: "1.0.0",
      mode: "embedded",
    },
  };
}

export function sendGatewayResponse(
  ws: WebSocket,
  id: string,
  payload: unknown,
): boolean {
  const frame: GatewayResponse = {
    type: "res",
    id,
    ok: true,
    payload,
  };
  return sendFrame(ws, frame);
}

export function sendGatewayError(
  ws: WebSocket,
  id: string,
  message: string,
  code = 500,
): boolean {
  const frame: GatewayResponse = {
    type: "res",
    id,
    ok: false,
    error: {
      message,
      code,
    },
  };
  return sendFrame(ws, frame);
}

export function sendGatewayEvent(
  ws: WebSocket,
  event: { event: string; payload: Record<string, unknown> },
): boolean {
  const frame: GatewayEventFrame = {
    type: "event",
    event: event.event,
    payload: event.payload,
  };
  return sendFrame(ws, frame);
}

export function sendGatewayChatEvent(
  ws: WebSocket,
  payload: {
    runId: string;
    sessionKey: string;
    seq?: number;
    state: "delta" | "final" | "aborted" | "error";
    text: string;
    errorMessage?: string;
  },
): boolean {
  return sendGatewayEvent(ws, {
    event: "chat",
    payload,
  });
}

function sendFrame(ws: WebSocket, frame: GatewayResponse | GatewayEventFrame): boolean {
  if (ws.readyState !== WS_READY_STATE_OPEN) {
    return false;
  }

  try {
    ws.send(JSON.stringify(frame));
    return true;
  } catch {
    return false;
  }
}
