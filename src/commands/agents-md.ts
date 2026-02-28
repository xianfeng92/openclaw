/**
 * AGENTS.md management commands
 * Provides /save-rule and /init-agents-md commands for managing project-level agent configuration
 */

import fs from "node:fs/promises";
import path from "node:path";
import { runCommandWithTimeout } from "../process/exec.js";
import { resolveUserPath } from "../utils.js";
import { resolveDefaultAgentWorkspaceDir, DEFAULT_AGENTS_FILENAME } from "../agents/workspace.js";

export type SaveRuleOptions = {
  content: string;
  workspace?: string;
};

export type InitAgentsMdOptions = {
  workspace?: string;
  force?: boolean;
};

/**
 * Save a rule to AGENTS.md in the specified workspace
 */
export async function saveRuleCommand(opts: SaveRuleOptions): Promise<{
  success: boolean;
  filePath?: string;
  error?: string;
}> {
  try {
    const workspaceDir = opts.workspace
      ? path.resolve(opts.workspace)
      : path.resolve(process.cwd());

    const agentsPath = path.join(workspaceDir, DEFAULT_AGENTS_FILENAME);

    // Ensure directory exists
    await fs.mkdir(workspaceDir, { recursive: true });

    // Read existing content or start with header
    let existingContent = "";
    try {
      existingContent = await fs.readFile(agentsPath, "utf-8");
    } catch {
      // File doesn't exist, create with header
      existingContent = `# AGENTS.md\n\nThis file contains project-specific rules and context for the AI agent.\n\n`;
    }

    // Prepare new rule entry
    const timestamp = new Date().toISOString().split("T")[0];
    const newRule = `\n## Rule saved ${timestamp}\n${opts.content.trim()}\n`;

    // Append the new rule
    await fs.writeFile(agentsPath, existingContent + newRule, "utf-8");

    return {
      success: true,
      filePath: agentsPath,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Analyze the project to gather information for AGENTS.md generation
 */
async function analyzeProject(projectRoot: string): Promise<{
  projectName: string;
  packageJson?: {
    name?: string;
    description?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  gitRemote?: string;
  readme?: string;
}> {
  const result: {
    projectName: string;
    packageJson?: any;
    gitRemote?: string;
    readme?: string;
  } = {
    projectName: path.basename(projectRoot),
  };

  // Try to read package.json
  try {
    const packagePath = path.join(projectRoot, "package.json");
    const packageContent = await fs.readFile(packagePath, "utf-8");
    result.packageJson = JSON.parse(packageContent);
    if (result.packageJson?.name) {
      result.projectName = result.packageJson.name;
    }
  } catch {
    // No package.json, continue
  }

  // Try to get git remote
  try {
    const gitResult = await runCommandWithTimeout(
      ["git", "remote", "get-url", "origin"],
      { cwd: projectRoot, timeoutMs: 5000 },
    );
    if (gitResult.code === 0 && gitResult.stdout.trim()) {
      result.gitRemote = gitResult.stdout.trim();
    }
  } catch {
    // Not a git repo or no remote
  }

  // Try to read README
  const readmeCandidates = ["README.md", "readme.md", "README.txt", "README"];
  for (const filename of readmeCandidates) {
    try {
      const readmePath = path.join(projectRoot, filename);
      const readmeContent = await fs.readFile(readmePath, "utf-8");
      result.readme = readmeContent.slice(0, 500); // First 500 chars
      break;
    } catch {
      // Try next candidate
    }
  }

  return result;
}

/**
 * Generate AGENTS.md content based on project analysis
 */
function generateAgentsMdContent(analysis: Awaited<ReturnType<typeof analyzeProject>>): string {
  const lines: string[] = [];

  // Header
  lines.push(`# ${analysis.projectName}`);
  lines.push("");
  lines.push(`> AGENTS.md - Project-specific AI agent configuration`);
  lines.push(`> Generated: ${new Date().toISOString()}`);
  lines.push("");

  // Project Description
  if (analysis.packageJson?.description) {
    lines.push("## Project Description");
    lines.push(analysis.packageJson.description);
    lines.push("");
  }

  // Tech Stack
  const deps = {
    ...analysis.packageJson?.dependencies,
    ...analysis.packageJson?.devDependencies,
  };

  // Detect languages and frameworks
  const techStack: string[] = [];
  if (deps?.typescript || deps?.["@types/*"]) {
    techStack.push("- **TypeScript**");
  }
  if (deps?.react || deps?.["react-dom"] || deps?.["@types/react"]) {
    techStack.push("- **React**");
  }
  if (deps?.vue || deps?.["@types/vue"]) {
    techStack.push("- **Vue**");
  }
  if (deps?.next) {
    techStack.push("- **Next.js**");
  }
  if (deps?.vite) {
    techStack.push("- **Vite**");
  }
  if (deps?.["electron"] || deps?.["@types/electron"]) {
    techStack.push("- **Electron**");
  }
  if (deps?.express) {
    techStack.push("- **Express**");
  }
  if (deps?.fastify) {
    techStack.push("- **Fastify**");
  }
  if (deps?.vitest || deps?.jest || deps?.["@types/jest"]) {
    techStack.push("- **Testing**: " + (deps.vitest ? "Vitest" : deps.jest ? "Jest" : "Unknown"));
  }

  if (techStack.length > 0) {
    lines.push("## Tech Stack");
    lines.push(...techStack);
    lines.push("");
  }

  // Common Commands
  if (analysis.packageJson?.scripts) {
    lines.push("## Common Commands");
    for (const [name, script] of Object.entries(analysis.packageJson.scripts)) {
      lines.push(`- \`pnpm ${name}\`: ${script}`);
    }
    lines.push("");
  }

  // Git Repository
  if (analysis.gitRemote) {
    lines.push("## Git Repository");
    lines.push(`Remote: ${analysis.gitRemote}`);
    lines.push("");
  }

  // Coding Standards (template for user to fill)
  lines.push("## Coding Standards");
  lines.push("<!-- Add your coding standards here -->");
  lines.push("");
  lines.push("### Guidelines");
  lines.push("- Use meaningful variable and function names");
  lines.push("- Add JSDoc comments for exported functions");
  lines.push("- Keep functions small and focused");
  lines.push("");
  lines.push("### Conventions");
  lines.push("<!-- Add your project-specific conventions -->");
  lines.push("");

  // Important Files/Patterns (template)
  lines.push("## Important Files");
  lines.push("<!-- List important files and their purposes -->");
  lines.push("");

  // Environment Variables (template)
  lines.push("## Environment Variables");
  lines.push("<!-- Document important environment variables -->");
  lines.push("");

  // Notes section
  lines.push("## Notes");
  lines.push("<!-- Add any additional notes for the agent -->");
  lines.push("");

  return lines.join("\n");
}

/**
 * Initialize AGENTS.md in the specified workspace
 */
export async function initAgentsMdCommand(opts: InitAgentsMdOptions): Promise<{
  success: boolean;
  filePath?: string;
  created?: boolean;
  error?: string;
}> {
  try {
    const workspaceDir = opts.workspace
      ? path.resolve(opts.workspace)
      : path.resolve(process.cwd());

    const agentsPath = path.join(workspaceDir, DEFAULT_AGENTS_FILENAME);

    // Check if file already exists
    const fileExists = await fs
      .access(agentsPath)
      .then(() => true)
      .catch(() => false);

    if (fileExists && !opts.force) {
      return {
        success: false,
        error: `${DEFAULT_AGENTS_FILENAME} already exists. Use --force to overwrite.`,
        filePath: agentsPath,
        created: false,
      };
    }

    // Analyze project
    const analysis = await analyzeProject(workspaceDir);

    // Generate content
    const content = generateAgentsMdContent(analysis);

    // Ensure directory exists
    await fs.mkdir(workspaceDir, { recursive: true });

    // Write file (always overwrite)
    await fs.writeFile(agentsPath, content, "utf-8");

    return {
      success: true,
      filePath: agentsPath,
      created: !fileExists,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Read AGENTS.md content from workspace
 */
export async function readAgentsMd(workspace?: string): Promise<{
  content?: string;
  filePath?: string;
  exists: boolean;
}> {
  try {
    const workspaceDir = workspace
      ? path.resolve(workspace)
      : path.resolve(process.cwd());

    const agentsPath = path.join(workspaceDir, DEFAULT_AGENTS_FILENAME);

    const content = await fs.readFile(agentsPath, "utf-8");
    return {
      content,
      filePath: agentsPath,
      exists: true,
    };
  } catch {
    return {
      exists: false,
    };
  }
}
