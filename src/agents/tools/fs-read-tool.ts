import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";

const fsReadSchema = Type.Object({
  path: Type.String({
    description: "File or directory path (absolute or relative to workspace)",
  }),
  maxDepth: Type.Optional(
    Type.Number({
      description: "Max directory tree depth (default 3)",
    }),
  ),
  maxEntries: Type.Optional(
    Type.Number({
      description: "Max total tree entries (default 300)",
    }),
  ),
  maxBytes: Type.Optional(
    Type.Number({
      description: "Max bytes to return (default 200000)",
    }),
  ),
});

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const parsed = Math.floor(value);
  if (parsed < min) {
    return min;
  }
  if (parsed > max) {
    return max;
  }
  return parsed;
}

function isSubPath(parent: string, candidate: string) {
  const rel = path.relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function truncateUtf8Bytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (maxBytes <= 0) {
    return { text: "", truncated: text.length > 0 };
  }
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) {
    return { text, truncated: false };
  }
  return { text: buf.subarray(0, maxBytes).toString("utf8"), truncated: true };
}

async function readFileTruncated(params: {
  filePath: string;
  maxBytes: number;
}): Promise<{ text: string; totalBytes: number; returnedBytes: number; truncated: boolean }> {
  const stat = await fs.stat(params.filePath);
  const totalBytes = stat.size;
  const maxBytes = Math.max(1, Math.floor(params.maxBytes));
  const fh = await fs.open(params.filePath, "r");
  try {
    const toRead = Math.min(totalBytes, maxBytes);
    const buf = Buffer.alloc(toRead);
    const { bytesRead } = await fh.read(buf, 0, toRead, 0);
    const slice = bytesRead === buf.length ? buf : buf.subarray(0, bytesRead);
    return {
      text: slice.toString("utf8"),
      totalBytes,
      returnedBytes: bytesRead,
      truncated: totalBytes > bytesRead,
    };
  } finally {
    await fh.close();
  }
}

async function renderTree(params: {
  root: string;
  target: string;
  maxDepth: number;
  maxEntries: number;
  maxBytes: number;
  onUpdate?: (partial: unknown) => void;
}) {
  let emitted = 0;
  let emittedBytes = 0;
  const lines: string[] = [];
  const walk = async (current: string, depth: number) => {
    if (emitted >= params.maxEntries || depth > params.maxDepth || emittedBytes >= params.maxBytes) {
      return;
    }
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) {
        return -1;
      }
      if (!a.isDirectory() && b.isDirectory()) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });
    for (const entry of entries) {
      if (emitted >= params.maxEntries || emittedBytes >= params.maxBytes) {
        break;
      }
      const fullPath = path.join(current, entry.name);
      const rel = path.relative(params.root, fullPath) || ".";
      const kind = entry.isSymbolicLink() ? "link" : entry.isDirectory() ? "dir" : "file";
      const line = `${"  ".repeat(depth)}- [${kind}] ${rel}`;
      emittedBytes += Buffer.byteLength(line + "\n", "utf8");
      if (emittedBytes > params.maxBytes) {
        break;
      }
      lines.push(line);
      emitted += 1;
      if (emitted % 50 === 0) {
        params.onUpdate?.({ scanned: emitted, kind: "tree" });
      }
      // Security: do not follow symlinks (can escape workspace), and re-check realpath before descending.
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        const real = await fs.realpath(fullPath).catch(() => null);
        if (!real || !isSubPath(params.root, real)) {
          continue;
        }
        await walk(real, depth + 1);
      }
    }
  };
  await walk(params.target, 0);
  return {
    lines,
    emitted,
    truncated: emitted >= params.maxEntries || emittedBytes >= params.maxBytes,
    truncatedByEntries: emitted >= params.maxEntries,
    truncatedByBytes: emittedBytes >= params.maxBytes,
    emittedBytes,
  };
}

export function createFsReadTool(workspaceRoot: string): AnyAgentTool {
  return {
    name: "fs_read",
    label: "fs_read",
    description: "Read a file or list a directory tree inside the workspace.",
    parameters: fsReadSchema,
    execute: async (_toolCallId, args, _signal, onUpdate) => {
      const params = args as { path?: unknown; maxDepth?: unknown; maxEntries?: unknown; maxBytes?: unknown };
      const rawPath = typeof params.path === "string" ? params.path.trim() : "";
      if (!rawPath) {
        throw new Error("path required");
      }
      const maxDepth = clampInt(params.maxDepth, 3, 1, 8);
      const maxEntries = clampInt(params.maxEntries, 300, 20, 2000);
      const maxBytes = clampInt(params.maxBytes, 200_000, 10_000, 2_000_000);
      const root = path.resolve(workspaceRoot || process.cwd());
      const realRoot = await fs.realpath(root).catch(() => root);
      const resolved = path.resolve(root, rawPath);
      if (!isSubPath(root, resolved)) {
        throw new Error("path must stay within workspace");
      }
      const realResolved = await fs.realpath(resolved);
      if (!isSubPath(realRoot, realResolved)) {
        throw new Error("path must stay within workspace");
      }
      const stat = await fs.stat(realResolved);
      if (stat.isDirectory()) {
        onUpdate?.({
          content: [{ type: "text", text: `Scanning directory: ${rawPath}` }],
          details: { phase: "scan", path: rawPath },
        });
        const tree = await renderTree({
          root: realRoot,
          target: realResolved,
          maxDepth,
          maxEntries,
          maxBytes,
          onUpdate: (progress) => {
            const payload =
              progress && typeof progress === "object"
                ? (progress as Record<string, unknown>)
                : { value: progress };
            onUpdate?.({
              content: [{ type: "text", text: `Scanning... ${JSON.stringify(progress)}` }],
              details: { phase: "scan", ...payload },
            });
          },
        });
        const body = [
          `# Directory Tree`,
          ``,
          `- Path: \`${rawPath}\``,
          `- Depth: ${maxDepth}`,
          `- Entries: ${tree.emitted}${tree.truncated ? " (truncated)" : ""}`,
          ``,
          ...tree.lines,
        ].join("\n");
        const truncatedBody = truncateUtf8Bytes(body, maxBytes);
        return {
          content: [{ type: "text", text: truncatedBody.text }],
          details: {
            type: "directory",
            path: rawPath,
            maxDepth,
            maxEntries,
            maxBytes,
            emitted: tree.emitted,
            truncated: tree.truncated || truncatedBody.truncated,
            truncatedByEntries: tree.truncatedByEntries,
            truncatedByBytes: tree.truncatedByBytes || truncatedBody.truncated,
            emittedBytes: tree.emittedBytes,
          },
        };
      }
      const file = await readFileTruncated({ filePath: realResolved, maxBytes });
      const content = file.text;
      const truncatedNote = file.truncated ? "\n\n[File truncated]" : "";
      return {
        content: [
          {
            type: "text",
            text: `# File Content\n\n- Path: \`${rawPath}\`\n- Bytes: ${file.returnedBytes}/${file.totalBytes}${file.truncated ? " (truncated)" : ""}\n\n\`\`\`\n${content}\n\`\`\`${truncatedNote}`,
          },
        ],
        details: {
          type: "file",
          path: rawPath,
          totalBytes: file.totalBytes,
          returnedBytes: file.returnedBytes,
          truncated: file.truncated,
        },
      };
    },
  };
}
