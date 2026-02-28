/**
 * Workflows system tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTempWorkspace } from "../test-helpers/workspace.js";
import { join } from "node:path";
import { writeFile, readFile, rm, mkdir } from "node:fs/promises";
import {
  executeWorkflow,
  loadWorkflows,
  listWorkflowNames,
  completeWorkflowName,
} from "./workflows.js";

async function writeWorkflowFile(dir: string, name: string, content: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), content, "utf-8");
}

describe("Workflows system", () => {
  let tempDir: string;
  const workflowsDir = ".openclaw/workflows";

  beforeEach(async () => {
    tempDir = await makeTempWorkspace("workflows-test-");
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("loadWorkflows", () => {
    it("should load workflow from YAML file", async () => {
      const workflowsDirPath = join(tempDir, workflowsDir);
      await writeWorkflowFile(
        workflowsDirPath,
        "deploy.yaml",
        `
name: deploy
description: Deploy to environment
template: pnpm deploy --env {{env}} --tag {{tag}}
parameters:
  - name: env
    type: choice
    options: [dev, staging, production]
    default: staging
  - name: tag
    type: input
    default: latest
`,
      );

      const workflows = await loadWorkflows(tempDir);

      expect(workflows.size).toBe(1);
      const deploy = workflows.get("deploy");
      expect(deploy).toBeDefined();
      expect(deploy?.name).toBe("deploy");
      expect(deploy?.template).toContain("pnpm deploy");
    });

    it("should return empty map when no workflows exist", async () => {
      const workflows = await loadWorkflows(tempDir);
      expect(workflows.size).toBe(0);
    });

    it("should load multiple workflows from different files", async () => {
      const workflowsDirPath = join(tempDir, workflowsDir);
      await writeWorkflowFile(
        workflowsDirPath,
        "test.yaml",
        `
name: test
description: Run tests
template: pnpm test {{pattern}}
parameters:
  - name: pattern
    type: input
    default: "**/*.test.ts"
`,
      );

      await writeWorkflowFile(
        workflowsDirPath,
        "build.yaml",
        `
name: build
description: Build the project
template: pnpm build
`,
      );

      const workflows = await loadWorkflows(tempDir);

      expect(workflows.size).toBe(2);
      expect(workflows.get("test")?.name).toBe("test");
      expect(workflows.get("build")?.name).toBe("build");
    });
  });

  describe("executeWorkflow", () => {
    it("should replace parameters in template", async () => {
      const workflowsDirPath = join(tempDir, workflowsDir);
      await writeWorkflowFile(
        workflowsDirPath,
        "greet.yaml",
        `
name: greet
description: Greet someone
template: Hello {{name}}!
parameters:
  - name: name
    type: input
    default: World
`,
      );

      const result = await executeWorkflow("greet", { name: "Claude" }, tempDir);

      expect(result.success).toBe(true);
      expect(result.command).toBe("Hello Claude!");
    });

    it("should use default parameter values", async () => {
      const workflowsDirPath = join(tempDir, workflowsDir);
      await writeWorkflowFile(
        workflowsDirPath,
        "greet.yaml",
        `
name: greet
description: Greet someone
template: Hello {{name}}!
parameters:
  - name: name
    type: input
    default: World
`,
      );

      const result = await executeWorkflow("greet", {}, tempDir);

      expect(result.success).toBe(true);
      expect(result.command).toBe("Hello World!");
    });

    it("should handle choice parameters", async () => {
      const workflowsDirPath = join(tempDir, workflowsDir);
      await writeWorkflowFile(
        workflowsDirPath,
        "deploy.yaml",
        `
name: deploy
description: Deploy to environment
template: kubectl deploy --env {{env}}
parameters:
  - name: env
    type: choice
    options: [dev, staging, production]
    default: staging
`,
      );

      const result1 = await executeWorkflow("deploy", {}, tempDir);
      expect(result1.success).toBe(true);
      expect(result1.command).toBe("kubectl deploy --env staging");

      const result2 = await executeWorkflow("deploy", { env: "production" }, tempDir);
      expect(result2.success).toBe(true);
      expect(result2.command).toBe("kubectl deploy --env production");
    });

    it("should return error for non-existent workflow", async () => {
      const result = await executeWorkflow("nonexistent", {}, tempDir);

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should clean up unreplaced placeholders", async () => {
      const workflowsDirPath = join(tempDir, workflowsDir);
      await writeWorkflowFile(
        workflowsDirPath,
        "test.yaml",
        `
name: test
description: Test command
template: command {{foo}} bar
`,
      );

      const result = await executeWorkflow("test", {}, tempDir);

      expect(result.success).toBe(true);
      expect(result.command).toBe("command  bar");
    });
  });

  describe("listWorkflowNames", () => {
    it("should return empty array when no workflows exist", async () => {
      const names = await listWorkflowNames(tempDir);
      expect(names).toEqual([]);
    });

    it("should list all workflow names", async () => {
      const workflowsDirPath = join(tempDir, workflowsDir);
      await writeWorkflowFile(
        workflowsDirPath,
        "test1.yaml",
        `
name: test1
description: Test 1
template: echo "test1"
`,
      );
      await writeWorkflowFile(
        workflowsDirPath,
        "test2.yaml",
        `
name: test2
description: Test 2
template: echo "test2"
`,
      );

      const names = await listWorkflowNames(tempDir);
      expect(names).toHaveLength(2);
      expect(names).toContain("test1");
      expect(names).toContain("test2");
    });
  });

  describe("completeWorkflowName", () => {
    it("should return all names for empty partial", async () => {
      const workflowsDirPath = join(tempDir, workflowsDir);
      await writeWorkflowFile(
        workflowsDirPath,
        "deploy.yaml",
        `
name: deploy
description: Deploy
template: pnpm deploy
`,
      );
      await writeWorkflowFile(
        workflowsDirPath,
        "build.yaml",
        `
name: build
description: Build
template: pnpm build
`,
      );

      const names = await completeWorkflowName("", tempDir);
      expect(names).toHaveLength(2);
    });

    it("should filter by partial match", async () => {
      const workflowsDirPath = join(tempDir, workflowsDir);
      await writeWorkflowFile(
        workflowsDirPath,
        "deploy.yaml",
        `
name: deploy:production
description: Deploy to production
template: pnpm deploy --env production
`,
      );
      await writeWorkflowFile(
        workflowsDirPath,
        "deploy-staging.yaml",
        `
name: deploy:staging
description: Deploy to staging
template: pnpm deploy --env staging
`,
      );

      const names = await completeWorkflowName("dep", tempDir);
      expect(names).toHaveLength(2);
      expect(names).toContain("deploy:production");
      expect(names).toContain("deploy:staging");
    });

    it("should match partial workflow names", async () => {
      const workflowsDirPath = join(tempDir, workflowsDir);
      await writeWorkflowFile(
        workflowsDirPath,
        "greet.yaml",
        `
name: greet:friendly
description: Friendly greeting
template: Hi {{name}}!
`,
      );

      const names = await completeWorkflowName("greet", tempDir);
      expect(names).toHaveLength(1);
      expect(names[0]).toBe("greet:friendly");
    });
  });
});
