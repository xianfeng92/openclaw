import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyHookMappings, resolveHookMappings } from "./hooks-mapping.js";

const baseUrl = new URL("http://127.0.0.1:18789/hooks/gmail");

describe("hooks mapping", () => {
  function createGmailAgentMapping(params: {
    id: string;
    messageTemplate: string;
    model?: string;
  }) {
    return {
      id: params.id,
      match: { path: "gmail" },
      action: "agent" as const,
      messageTemplate: params.messageTemplate,
      ...(params.model ? { model: params.model } : {}),
    };
  }

  function expectSkippedTransformResult(result: Awaited<ReturnType<typeof applyHookMappings>>) {
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.action).toBeNull();
      expect("skipped" in result).toBe(true);
    }
  }

  it("resolves gmail preset", () => {
    const mappings = resolveHookMappings({ presets: ["gmail"] });
    expect(mappings.length).toBeGreaterThan(0);
    expect(mappings[0]?.matchPath).toBe("gmail");
  });

  it("renders template from payload", async () => {
    const mappings = resolveHookMappings({
      mappings: [
        {
          id: "demo",
          match: { path: "gmail" },
          action: "agent",
          messageTemplate: "Subject: {{messages[0].subject}}",
        },
      ],
    });
    const result = await applyHookMappings(mappings, {
      payload: { messages: [{ subject: "Hello" }] },
      headers: {},
      url: baseUrl,
      path: "gmail",
    });
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.action.kind).toBe("agent");
      expect(result.action.message).toBe("Subject: Hello");
    }
  });

  it("passes model override from mapping", async () => {
    const mappings = resolveHookMappings({
      mappings: [
        {
          id: "demo",
          match: { path: "gmail" },
          action: "agent",
          messageTemplate: "Subject: {{messages[0].subject}}",
          model: "openai/gpt-4.1-mini",
        },
      ],
    });
    const result = await applyHookMappings(mappings, {
      payload: { messages: [{ subject: "Hello" }] },
      headers: {},
      url: baseUrl,
      path: "gmail",
    });
    expect(result?.ok).toBe(true);
    if (result?.ok && result.action.kind === "agent") {
      expect(result.action.model).toBe("openai/gpt-4.1-mini");
    }
  });

  it("runs transform module", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-hooks-"));
    const modPath = path.join(dir, "transform.mjs");
    const placeholder = "${payload.name}";
    fs.writeFileSync(
      modPath,
      `export default ({ payload }) => ({ kind: "wake", text: \`Ping ${placeholder}\` });`,
    );

    const mappings = resolveHookMappings({
      transformsDir: dir,
      mappings: [
        {
          match: { path: "custom" },
          action: "agent",
          transform: { module: "transform.mjs" },
        },
      ],
    });

    const result = await applyHookMappings(mappings, {
      payload: { name: "Ada" },
      headers: {},
      url: new URL("http://127.0.0.1:18789/hooks/custom"),
      path: "custom",
    });

    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.action.kind).toBe("wake");
      if (result.action.kind === "wake") {
        expect(result.action.text).toBe("Ping Ada");
      }
    }
  });

  it("rejects transform module traversal outside transformsDir", () => {
    const transformsDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-hooks-traversal-"));
    expect(() =>
      resolveHookMappings(
        {
          transformsDir,
          mappings: [
            {
              match: { path: "custom" },
              action: "agent",
              transform: { module: "../evil.mjs" },
            },
          ],
        },
      ),
    ).toThrow(/must be within/);
  });

  it("rejects absolute transform module path outside transformsDir", () => {
    const transformsDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-hooks-abs-"));
    const outside = path.join(os.tmpdir(), "evil.mjs");
    expect(() =>
      resolveHookMappings(
        {
          transformsDir,
          mappings: [
            {
              match: { path: "custom" },
              action: "agent",
              transform: { module: outside },
            },
          ],
        },
      ),
    ).toThrow(/must be within/);
  });

  it.runIf(process.platform !== "win32")(
    "rejects transform module symlink escape outside transformsDir",
    () => {
      const transformsDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-hooks-symlink-file-"));
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-outside-module-"));
      const outsideModule = path.join(outsideDir, "evil.mjs");
      fs.writeFileSync(outsideModule, 'export default () => ({ kind: "wake", text: "owned" });');
      fs.symlinkSync(outsideModule, path.join(transformsDir, "linked.mjs"));
      expect(() =>
        resolveHookMappings(
          {
            transformsDir,
            mappings: [
              {
                match: { path: "custom" },
                action: "agent",
                transform: { module: "linked.mjs" },
              },
            ],
          },
        ),
      ).toThrow(/must be within/);
    },
  );

  it.runIf(process.platform !== "win32")(
    "rejects transform module symlink directory escape outside transformsDir",
    () => {
      const transformsDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-hooks-symlink-dir-"));
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-outside-dir-"));
      fs.writeFileSync(path.join(outsideDir, "transform.mjs"), "export default () => null;");
      fs.symlinkSync(outsideDir, path.join(transformsDir, "escape"), "dir");
      expect(() =>
        resolveHookMappings(
          {
            transformsDir,
            mappings: [
              {
                match: { path: "custom" },
                action: "agent",
                transform: { module: "escape/transform.mjs" },
              },
            ],
          },
        ),
      ).toThrow(/must be within/);
    },
  );

  it.runIf(process.platform !== "win32")("accepts in-root transform module symlink", async () => {
    const transformsDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-hooks-symlink-ok-"));
    const nestedDir = path.join(transformsDir, "nested");
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(path.join(nestedDir, "transform.mjs"), "export default () => null;");
    fs.symlinkSync(path.join(nestedDir, "transform.mjs"), path.join(transformsDir, "linked.mjs"));

    const mappings = resolveHookMappings({
      transformsDir,
      mappings: [
        {
          match: { path: "skip" },
          action: "agent",
          transform: { module: "linked.mjs" },
        },
      ],
    });

    const result = await applyHookMappings(mappings, {
      payload: {},
      headers: {},
      url: new URL("http://127.0.0.1:18789/hooks/skip"),
      path: "skip",
    });

    expectSkippedTransformResult(result);
  });
  it("treats null transform as a handled skip", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-hooks-skip-"));
    const modPath = path.join(dir, "transform.mjs");
    fs.writeFileSync(modPath, "export default () => null;");

    const mappings = resolveHookMappings({
      transformsDir: dir,
      mappings: [
        {
          match: { path: "skip" },
          action: "agent",
          transform: { module: "transform.mjs" },
        },
      ],
    });

    const result = await applyHookMappings(mappings, {
      payload: {},
      headers: {},
      url: new URL("http://127.0.0.1:18789/hooks/skip"),
      path: "skip",
    });

    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.action).toBeNull();
      expect("skipped" in result).toBe(true);
    }
  });

  it("prefers explicit mappings over presets", async () => {
    const mappings = resolveHookMappings({
      presets: ["gmail"],
      mappings: [
        {
          id: "override",
          match: { path: "gmail" },
          action: "agent",
          messageTemplate: "Override subject: {{messages[0].subject}}",
        },
      ],
    });
    const result = await applyHookMappings(mappings, {
      payload: { messages: [{ subject: "Hello" }] },
      headers: {},
      url: baseUrl,
      path: "gmail",
    });
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.action.kind).toBe("agent");
      expect(result.action.message).toBe("Override subject: Hello");
    }
  });

  it("rejects missing message", async () => {
    const mappings = resolveHookMappings({
      mappings: [{ match: { path: "noop" }, action: "agent" }],
    });
    const result = await applyHookMappings(mappings, {
      payload: {},
      headers: {},
      url: new URL("http://127.0.0.1:18789/hooks/noop"),
      path: "noop",
    });
    expect(result?.ok).toBe(false);
  });

  describe("prototype pollution protection", () => {
    it("blocks __proto__ traversal in webhook payload", async () => {
      const mappings = resolveHookMappings({
        mappings: [
          createGmailAgentMapping({
            id: "proto-test",
            messageTemplate: "value: {{__proto__}}",
          }),
        ],
      });
      const result = await applyHookMappings(mappings, {
        payload: { __proto__: { polluted: true } } as Record<string, unknown>,
        headers: {},
        url: baseUrl,
        path: "gmail",
      });
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        const action = result.action;
        if (action?.kind === "agent") {
          expect(action.message).toBe("value: ");
        }
      }
    });

    it("blocks constructor traversal in webhook payload", async () => {
      const mappings = resolveHookMappings({
        mappings: [
          createGmailAgentMapping({
            id: "constructor-test",
            messageTemplate: "type: {{constructor.name}}",
          }),
        ],
      });
      const result = await applyHookMappings(mappings, {
        payload: { constructor: { name: "INJECTED" } } as Record<string, unknown>,
        headers: {},
        url: baseUrl,
        path: "gmail",
      });
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        const action = result.action;
        if (action?.kind === "agent") {
          expect(action.message).toBe("type: ");
        }
      }
    });

    it("blocks prototype traversal in webhook payload", async () => {
      const mappings = resolveHookMappings({
        mappings: [
          createGmailAgentMapping({
            id: "prototype-test",
            messageTemplate: "val: {{prototype}}",
          }),
        ],
      });
      const result = await applyHookMappings(mappings, {
        payload: { prototype: "leaked" } as Record<string, unknown>,
        headers: {},
        url: baseUrl,
        path: "gmail",
      });
      expect(result?.ok).toBe(true);
      if (result?.ok) {
        const action = result.action;
        if (action?.kind === "agent") {
          expect(action.message).toBe("val: ");
        }
      }
    });
  });
});
