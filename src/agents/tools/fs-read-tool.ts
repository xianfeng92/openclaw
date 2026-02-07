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

async function renderTree(params: {
  root: string;
  target: string;
  maxDepth: number;
  maxEntries: number;
  onUpdate?: (partial: unknown) => void;
}) {
  let emitted = 0;
  const lines: string[] = [];
  const walk = async (current: string, depth: number) => {
    if (emitted >= params.maxEntries || depth > params.maxDepth) {
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
      if (emitted >= params.maxEntries) {
        break;
      }
      const fullPath = path.join(current, entry.name);
      if (!isSubPath(params.root, fullPath)) {
        continue;
      }
      const rel = path.relative(params.root, fullPath) || ".";
      lines.push(`${"  ".repeat(depth)}- ${entry.isDirectory() ? "📁" : "📄"} ${rel}`);
      emitted += 1;
      if (emitted % 50 === 0) {
        params.onUpdate?.({ scanned: emitted, kind: "tree" });
      }
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
      }
    }
  };
  await walk(params.target, 0);
  return { lines, emitted, truncated: emitted >= params.maxEntries };
}

export function createFsReadTool(workspaceRoot: string): AnyAgentTool {
  return {
    name: "fs.read",
    label: "fs.read",
    description: "Read a file or list a directory tree inside the workspace.",
    parameters: fsReadSchema,
    execute: async (_toolCallId, args, _signal, onUpdate) => {
      const params = args as { path?: unknown; maxDepth?: unknown; maxEntries?: unknown };
      const rawPath = typeof params.path === "string" ? params.path.trim() : "";
      if (!rawPath) {
        throw new Error("path required");
      }
      const maxDepth = clampInt(params.maxDepth, 3, 1, 8);
      const maxEntries = clampInt(params.maxEntries, 300, 20, 2000);
      const root = path.resolve(workspaceRoot || process.cwd());
      const resolved = path.resolve(root, rawPath);
      if (!isSubPath(root, resolved)) {
        throw new Error("path must stay within workspace");
      }
      const stat = await fs.stat(resolved);
      if (stat.isDirectory()) {
        onUpdate?.({
          content: [{ type: "text", text: `Scanning directory: ${rawPath}` }],
          details: { phase: "scan", path: rawPath },
        });
        const tree = await renderTree({
          root,
          target: resolved,
          maxDepth,
          maxEntries,
          onUpdate: (progress) => {
            const payload =
              progress && typeof progress === "object"
                ? (progress as Record<string, unknown>)
                : { value: progress };
            return (
            onUpdate?.({
              content: [{ type: "text", text: `Scanning… ${JSON.stringify(progress)}` }],
              details: { phase: "scan", ...payload },
            })
            );
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
        return {
          content: [{ type: "text", text: body }],
          details: {
            type: "directory",
            path: rawPath,
            maxDepth,
            maxEntries,
            emitted: tree.emitted,
            truncated: tree.truncated,
          },
        };
      }
      const content = await fs.readFile(resolved, "utf8");
      return {
        content: [
          {
            type: "text",
            text: `# File Content\n\n- Path: \`${rawPath}\`\n\n\`\`\`\n${content}\n\`\`\``,
          },
        ],
        details: {
          type: "file",
          path: rawPath,
          size: Buffer.byteLength(content, "utf8"),
        },
      };
    },
  };
}
