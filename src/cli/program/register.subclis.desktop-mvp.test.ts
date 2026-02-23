import { afterEach, describe, expect, it, vi } from "vitest";

async function loadModule() {
  vi.resetModules();
  return await import("./register.subclis.js");
}

afterEach(() => {
  delete process.env.OPENCLAW_DESKTOP_MVP_SLIM;
  delete process.env.CLAWDBOT_DESKTOP_MVP_SLIM;
  vi.resetModules();
});

describe("register subclis in desktop MVP slim mode", () => {
  it("hides plugin-facing subcommands", async () => {
    process.env.OPENCLAW_DESKTOP_MVP_SLIM = "1";
    const { getSubCliEntries } = await loadModule();
    const names = getSubCliEntries().map((entry) => entry.name);

    expect(names).not.toContain("channels");
    expect(names).not.toContain("plugins");
    expect(names).not.toContain("pairing");
    expect(names).not.toContain("directory");
    expect(names).not.toContain("skills");
  });

  it("keeps plugin-facing subcommands by default", async () => {
    const { getSubCliEntries } = await loadModule();
    const names = getSubCliEntries().map((entry) => entry.name);

    expect(names).toContain("channels");
    expect(names).toContain("plugins");
    expect(names).toContain("pairing");
    expect(names).toContain("directory");
    expect(names).toContain("skills");
  });
});
