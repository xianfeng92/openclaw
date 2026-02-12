import { describe, expect, it } from "vitest";
import { SECRET_LEAKAGE_REGRESSION_CORPUS } from "./redaction-regression-corpus.js";
import { applyNeuroRedaction, NEURO_SOURCE_FILTER_LIMITS } from "./redaction.js";

const REDACTION_LEVEL_WEIGHT = {
  none: 0,
  mask: 1,
  hash: 2,
  block: 3,
} as const;

describe("applyNeuroRedaction", () => {
  it("hashes class A secret values", () => {
    const token = "sk-1234567890abcdef1234567890";
    const result = applyNeuroRedaction({
      source: "clipboard",
      payload: { text: `OPENAI_API_KEY=${token}` },
    });
    const serialized = JSON.stringify(result.payload);
    expect(serialized).not.toContain(token);
    expect(serialized).toContain("sha256:");
    expect(result.redaction.level).toBe("hash");
    expect(result.redaction.reasons).toContain("pattern.secret.assignment");
  });

  it("blocks private key blocks", () => {
    const raw = [
      "-----BEGIN PRIVATE KEY-----",
      "AAAAABBBBBCCCCCDDDDD",
      "123451234512345",
      "-----END PRIVATE KEY-----",
    ].join("\n");
    const result = applyNeuroRedaction({
      source: "editor",
      payload: { selection: raw },
    });
    const serialized = JSON.stringify(result.payload);
    expect(serialized).not.toContain("AAAAABBBBBCCCCCDDDDD");
    expect(serialized).toContain("[REDACTED:PRIVATE_KEY_BLOCK]");
    expect(result.redaction.level).toBe("block");
  });

  it("removes URL query and hash for active window source", () => {
    const result = applyNeuroRedaction({
      source: "active_window",
      payload: { url: "https://openclaw.ai/settings?token=abc123#profile" },
    });
    expect(result.payload.url).toBe("https://openclaw.ai/settings");
    expect(result.redaction.reasons).toContain("source.filter.active_window_url_query_removed");
    expect(result.bounds.dropped).toBe(true);
  });

  it("drops fs raw content fields before persistence", () => {
    const result = applyNeuroRedaction({
      source: "fs",
      payload: {
        path: "/workspace/.env",
        action: "modified",
        content: "TOKEN=my-secret-value",
        nested: { rawText: "password=1234" },
      },
    });
    const payload = result.payload as {
      content?: unknown;
      nested?: { rawText?: unknown };
    };
    expect(payload.content).toBeUndefined();
    expect(payload.nested?.rawText).toBeUndefined();
    expect(result.redaction.level).toBe("block");
    expect(result.redaction.reasons).toContain("source.filter.fs_payload_content_removed");
  });

  it("caps terminal payload to the last 100 lines", () => {
    const lines = Array.from({ length: 120 }, (_value, idx) => `line-${idx + 1}`).join("\n");
    const result = applyNeuroRedaction({
      source: "terminal",
      payload: { output: lines },
    });
    const outputValue = (result.payload as { output?: unknown }).output;
    expect(typeof outputValue).toBe("string");
    const output = typeof outputValue === "string" ? outputValue : "";
    const rendered = output.split("\n");
    expect(rendered).toHaveLength(NEURO_SOURCE_FILTER_LIMITS.terminalLineCap);
    expect(rendered[0]).toBe("line-21");
    expect(rendered.at(-1)).toBe("line-120");
    expect(result.redaction.reasons).toContain("source.filter.terminal_line_cap");
    expect(result.bounds.dropped).toBe(true);
  });

  it("caps clipboard payload bytes", () => {
    const oversized = "A".repeat(NEURO_SOURCE_FILTER_LIMITS.clipboardTextBytes + 1024);
    const result = applyNeuroRedaction({
      source: "clipboard",
      payload: { text: oversized },
    });
    const textValue = (result.payload as { text?: unknown }).text;
    expect(typeof textValue).toBe("string");
    const text = typeof textValue === "string" ? textValue : "";
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(
      NEURO_SOURCE_FILTER_LIMITS.clipboardTextBytes,
    );
    expect(result.redaction.reasons).toContain("source.filter.clipboard_byte_cap");
    expect(result.bounds.dropped).toBe(true);
  });

  it("passes secret leakage regression corpus", () => {
    for (const fixture of SECRET_LEAKAGE_REGRESSION_CORPUS) {
      const result = applyNeuroRedaction({
        source: fixture.source,
        payload: fixture.payload,
      });
      const serialized = JSON.stringify(result.payload);
      for (const literal of fixture.forbiddenLiterals) {
        expect(serialized).not.toContain(literal);
      }
      expect(REDACTION_LEVEL_WEIGHT[result.redaction.level]).toBeGreaterThanOrEqual(
        REDACTION_LEVEL_WEIGHT[fixture.minLevel],
      );
      for (const reason of fixture.requiredReasons ?? []) {
        expect(result.redaction.reasons).toContain(reason);
      }
    }
  });
});
