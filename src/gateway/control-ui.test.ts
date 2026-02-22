import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { handleControlUiAvatarRequest, handleControlUiHttpRequest } from "./control-ui.js";

const makeResponse = (): {
  res: ServerResponse;
  setHeader: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
} => {
  const setHeader = vi.fn();
  const end = vi.fn();
  const res = {
    headersSent: false,
    statusCode: 200,
    setHeader,
    end,
  } as unknown as ServerResponse;
  return { res, setHeader, end };
};

describe("handleControlUiHttpRequest", () => {
  it("sets anti-clickjacking headers for Control UI responses", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-ui-"));
    try {
      await fs.writeFile(path.join(tmp, "index.html"), "<html></html>\n");
      const { res, setHeader } = makeResponse();
      const handled = handleControlUiHttpRequest(
        { url: "/", method: "GET" } as IncomingMessage,
        res,
        {
          root: { kind: "resolved", path: tmp },
        },
      );
      expect(handled).toBe(true);
      expect(setHeader).toHaveBeenCalledWith("X-Frame-Options", "DENY");
      expect(setHeader).toHaveBeenCalledWith("Content-Security-Policy", "frame-ancestors 'none'");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("serves local avatar bytes via avatar handler", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-avatar-http-"));
    try {
      const avatarPath = path.join(tmp, "main.png");
      await fs.writeFile(avatarPath, "avatar-bytes\n");
      const { res, end } = makeResponse();

      const handled = handleControlUiAvatarRequest(
        { url: "/avatar/main", method: "GET" } as IncomingMessage,
        res,
        {
          resolveAvatar: () => ({ kind: "local", filePath: avatarPath }),
        },
      );

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      expect(String(end.mock.calls[0]?.[0] ?? "")).toBe("avatar-bytes\n");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects avatar symlink paths from resolver", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-avatar-http-link-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-avatar-http-outside-"));
    try {
      const outsideFile = path.join(outside, "secret.txt");
      await fs.writeFile(outsideFile, "outside-secret\n");
      const linkPath = path.join(tmp, "avatar-link.png");
      try {
        await fs.symlink(outsideFile, linkPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") {
          return;
        }
        throw error;
      }

      const { res, end } = makeResponse();
      const handled = handleControlUiAvatarRequest(
        { url: "/avatar/main", method: "GET" } as IncomingMessage,
        res,
        {
          resolveAvatar: () => ({ kind: "local", filePath: linkPath }),
        },
      );

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(404);
      expect(end).toHaveBeenCalledWith("Not Found");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
