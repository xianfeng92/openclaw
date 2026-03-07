import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEmbeddedGatewayProvider,
  formatProviderError,
} from "./embedded-gateway.providers.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENV = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  GEMINI_BASE_URL: process.env.GEMINI_BASE_URL,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
};

afterEach(() => {
  Object.assign(globalThis, { fetch: ORIGINAL_FETCH });

  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
});

describe("embedded-gateway provider selection", () => {
  it("uses OPENAI env fallback when runtime provider is unset", async () => {
    process.env.OPENAI_API_KEY = "openai-test-key";
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;

    const fetchMock = vi.fn(async (input: string | URL | Request): Promise<Response> => {
      expect(String(input)).toBe("https://api.openai.com/v1/chat/completions");
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "hello from openai",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });
    Object.assign(globalThis, { fetch: fetchMock });

    const configured = createEmbeddedGatewayProvider();
    expect(configured.unavailableReason).toBe("");
    expect(configured.provider).not.toBeNull();

    const text = await configured.provider!.chat([{ role: "user", content: "hello" }]);
    expect(text).toBe("hello from openai");
  });

  it("uses ANTHROPIC env fallback when OpenAI env is absent", async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.ANTHROPIC_API_KEY = "anthropic-test-key";
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;

    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("anthropic-test-key");
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "hello from anthropic" }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });
    Object.assign(globalThis, { fetch: fetchMock });

    const configured = createEmbeddedGatewayProvider();
    expect(configured.unavailableReason).toBe("");
    expect(configured.provider).not.toBeNull();

    const text = await configured.provider!.chat([{ role: "user", content: "hello" }]);
    expect(text).toBe("hello from anthropic");
  });

  it("reports unsupported runtime provider", () => {
    const configured = createEmbeddedGatewayProvider({
      provider: "local" as "openai",
      apiKey: "test-key",
      baseUrl: "",
      model: "",
      maxTokens: 1024,
    });

    expect(configured.provider).toBeNull();
    expect(configured.unavailableReason).toContain('Provider "local" is not supported');
  });

  it("formats provider errors with nested cause messages", () => {
    const err = new Error("outer");
    Object.assign(err, {
      cause: {
        message: "inner",
      },
    });

    expect(formatProviderError(err)).toBe("outer (inner)");
  });
});
