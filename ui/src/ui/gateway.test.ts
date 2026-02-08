import { describe, expect, it, vi } from "vitest";
import { GATEWAY_CLIENT_CAPS } from "../../../src/gateway/protocol/client-info.js";
import { GatewayBrowserClient } from "./gateway.ts";

vi.mock("./device-identity.ts", () => ({
  loadOrCreateDeviceIdentity: vi.fn(async () => ({
    deviceId: "device-test",
    publicKey: "pub-test",
    privateKey: {} as CryptoKey,
  })),
  signDevicePayload: vi.fn(async () => "sig-test"),
}));

vi.mock("./device-auth.ts", () => ({
  clearDeviceAuthToken: vi.fn(),
  loadDeviceAuthToken: vi.fn(() => null),
  storeDeviceAuthToken: vi.fn(),
}));

describe("GatewayBrowserClient connect caps", () => {
  it("sends TOOL_EVENTS capability in connect request", async () => {
    const client = new GatewayBrowserClient({
      url: "ws://example.test",
      token: "token-test",
    });

    const request = vi.fn(async () => ({ type: "hello-ok", protocol: 3 }));
    (client as unknown as { request: typeof request }).request = request;

    await (
      client as unknown as {
        sendConnect: () => Promise<void>;
      }
    ).sendConnect();

    expect(request).toHaveBeenCalledWith(
      "connect",
      expect.objectContaining({
        caps: expect.arrayContaining([GATEWAY_CLIENT_CAPS.TOOL_EVENTS]),
      }),
    );
  });
});
