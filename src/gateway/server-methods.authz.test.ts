import { describe, expect, it, vi } from "vitest";
import { handleGatewayRequest, resolveGatewayMethodAccess } from "./server-methods.js";
import type { GatewayRequestContext } from "./server-methods/types.js";

function createOperatorClient(scopes: string[]) {
  return {
    connect: {
      role: "operator",
      scopes,
      client: {
        id: "test-client",
        displayName: "Test Client",
        version: "1.0.0",
        platform: "test",
        mode: "backend",
      },
    },
  } as const;
}

async function invokeGatewayMethod(method: string, scopes: string[]) {
  const respond = vi.fn();

  await handleGatewayRequest({
    req: {
      type: "req",
      id: "req-1",
      method,
      params: {},
    } as any,
    client: createOperatorClient(scopes) as any,
    isWebchatConnect: () => false,
    respond,
    context: {} as GatewayRequestContext,
    extraHandlers: {
      [method]: ({ respond: reply }) => {
        reply(true, { ok: true });
      },
    },
  });

  const [ok, payload, error] = respond.mock.calls[0] ?? [];
  return { ok, payload, error };
}

describe("resolveGatewayMethodAccess", () => {
  it("maps CyDeck read/write methods explicitly", () => {
    expect(resolveGatewayMethodAccess("chat.history")).toBe("read");
    expect(resolveGatewayMethodAccess("tools.memory.search")).toBe("read");
    expect(resolveGatewayMethodAccess("tools.memory.get")).toBe("read");
    expect(resolveGatewayMethodAccess("chat.send")).toBe("write");
    expect(resolveGatewayMethodAccess("chat.abort")).toBe("write");
    expect(resolveGatewayMethodAccess("session.rotate")).toBe("write");
  });

  it("keeps config and update namespaces behind admin access", () => {
    expect(resolveGatewayMethodAccess("config.get")).toBe("admin");
    expect(resolveGatewayMethodAccess("update.check")).toBe("admin");
  });
});

describe("handleGatewayRequest authorization", () => {
  it("allows read methods with operator.read", async () => {
    const result = await invokeGatewayMethod("tools.memory.search", ["operator.read"]);
    expect(result.ok).toBe(true);
    expect(result.payload).toEqual({ ok: true });
  });

  it("rejects write methods when only operator.read is present", async () => {
    const result = await invokeGatewayMethod("chat.send", ["operator.read"]);
    expect(result.ok).toBe(false);
    expect(result.error?.message).toBe("missing scope: operator.write");
  });

  it("allows write methods with operator.write", async () => {
    const result = await invokeGatewayMethod("session.rotate", ["operator.write"]);
    expect(result.ok).toBe(true);
    expect(result.payload).toEqual({ ok: true });
  });

  it("rejects admin methods without operator.admin", async () => {
    const result = await invokeGatewayMethod("config.reset", [
      "operator.read",
      "operator.write",
    ]);
    expect(result.ok).toBe(false);
    expect(result.error?.message).toBe("missing scope: operator.admin");
  });
});
