import { describe, expect, it } from "vitest";

import { validateConfigObject } from "./config.js";

describe("models.providers partial config", () => {
  it("allows setting apiKey without baseUrl/models", () => {
    const res = validateConfigObject({
      models: {
        providers: {
          google: {
            apiKey: "GEMINI_API_KEY",
          },
        },
      },
    });
    expect(res.ok).toBe(true);
  });

  it("requires baseUrl when models are set", () => {
    const res = validateConfigObject({
      models: {
        providers: {
          google: {
            models: [
              {
                id: "gemini-3-flash-preview",
                name: "Gemini 3 Flash",
              },
            ],
          },
        },
      },
    });
    expect(res.ok).toBe(false);
    expect(res.issues.some((issue) => issue.path === "models.providers.google.baseUrl")).toBe(true);
  });
});

