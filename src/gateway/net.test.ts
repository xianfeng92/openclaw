import { describe, expect, it } from "vitest";
import { resolveGatewayClientIp, resolveGatewayListenHosts } from "./net.js";

describe("resolveGatewayClientIp", () => {
  it("does not trust left-most X-Forwarded-For entries", () => {
    const ip = resolveGatewayClientIp({
      remoteAddr: "127.0.0.1",
      forwardedFor: "198.51.100.99, 10.0.0.9, 127.0.0.1",
      trustedProxies: ["127.0.0.1"],
    });
    expect(ip).toBe("127.0.0.1");
  });

  it("falls back to trusted proxy remote addr when headers are missing", () => {
    const ip = resolveGatewayClientIp({
      remoteAddr: "127.0.0.1",
      trustedProxies: ["127.0.0.1"],
    });
    expect(ip).toBe("127.0.0.1");
  });
});

describe("resolveGatewayListenHosts", () => {
  it("returns the input host when not loopback", async () => {
    const hosts = await resolveGatewayListenHosts("0.0.0.0", {
      canBindToHost: async () => {
        throw new Error("should not be called");
      },
    });
    expect(hosts).toEqual(["0.0.0.0"]);
  });

  it("adds ::1 when IPv6 loopback is available", async () => {
    const hosts = await resolveGatewayListenHosts("127.0.0.1", {
      canBindToHost: async () => true,
    });
    expect(hosts).toEqual(["127.0.0.1", "::1"]);
  });

  it("keeps only IPv4 loopback when IPv6 is unavailable", async () => {
    const hosts = await resolveGatewayListenHosts("127.0.0.1", {
      canBindToHost: async () => false,
    });
    expect(hosts).toEqual(["127.0.0.1"]);
  });
});
