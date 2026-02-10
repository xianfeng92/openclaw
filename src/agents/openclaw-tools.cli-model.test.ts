import { describe, expect, it } from "vitest";
import "./test-helpers/fast-core-tools.js";
import { createOpenClawTools } from "./openclaw-tools.js";

describe("cli_model tool gating", () => {
  it("is disabled by default", () => {
    const tools = createOpenClawTools();
    expect(tools.some((tool) => tool.name === "cli_model")).toBe(false);
  });

  it("can be explicitly enabled via tools.cliModel.enabled", () => {
    const tools = createOpenClawTools({
      config: {
        tools: {
          cliModel: {
            enabled: true,
          },
        },
      },
    });
    const tool = tools.find((candidate) => candidate.name === "cli_model");
    if (!tool) {
      throw new Error("missing cli_model tool");
    }

    const schema = tool.parameters as unknown as {
      properties?: {
        action?: {
          enum?: string[];
        };
      };
    };
    expect(schema.properties?.action?.enum).toEqual(["claude", "gpt"]);
  });
});
