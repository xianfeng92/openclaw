#!/usr/bin/env node
/**
 * Workflow Service Self-Test
 *
 * Tests the workflow management functionality.
 */

import {
  createWorkflow,
  deleteWorkflow,
  dryRunWorkflow,
  getWorkflow,
  getWorkflowByName,
  incrementWorkflowRunCount,
  listWorkflows,
  searchWorkflows,
  getPopularWorkflows,
  updateWorkflow,
  clearWorkflowsCache,
  type Workflow,
  type WorkflowStep,
} from "../src/orchestration/workflow-service.js";

function formatTest(name: string): string {
  return `\n\x1b[36m[Test]\x1b[0m ${name}`;
}

function formatPass(message: string): string {
  return `\x1b[32m✓ PASS\x1b[0m ${message}`;
}

function formatFail(message: string): string {
  return `\x1b[31m✗ FAIL\x1b[0m ${message}`;
}

function formatInfo(message: string): string {
  return `\x1b[90m  ${message}\x1b[0m`;
}

async function testCreateWorkflow(): Promise<boolean> {
  console.log(formatTest("Create Workflow"));

  try {
    const workflow = await createWorkflow({
      name: `Test Workflow ${Date.now()}`,
      description: "A test workflow for automated testing",
      steps: [
        {
          id: "step-1",
          type: "command",
          command: "npm test",
          description: "Run tests",
        },
        {
          id: "step-2",
          type: "spawn",
          command: "Fix failing tests",
          description: "Spawn agent to fix tests",
        },
        {
          id: "step-3",
          type: "delay",
          command: "5000",
          description: "Wait 5 seconds",
          timeout: 5000,
        },
      ],
      tags: ["test", "automation"],
    });

    console.log(formatInfo(`Created workflow: ${workflow.id}`));
    console.log(formatInfo(`Name: ${workflow.name}`));
    console.log(formatInfo(`Steps: ${workflow.steps.length}`));

    if (workflow.id && workflow.name && workflow.steps.length === 3) {
      console.log(formatPass("Workflow created successfully"));
      return true;
    } else {
      console.log(formatFail("Workflow structure invalid"));
      return false;
    }
  } catch (err) {
    console.log(formatFail(`Error: ${err}`));
    return false;
  }
}

async function testListWorkflows(): Promise<boolean> {
  console.log(formatTest("List Workflows"));

  try {
    const workflows = await listWorkflows();

    console.log(formatInfo(`Found ${workflows.length} workflow(s)`));

    for (const wf of workflows.slice(0, 3)) {
      console.log(formatInfo(`  - ${wf.name} (${wf.steps.length} steps)`));
    }

    console.log(formatPass("Workflows listed successfully"));
    return true;
  } catch (err) {
    console.log(formatFail(`Error: ${err}`));
    return false;
  }
}

async function testGetWorkflow(): Promise<boolean> {
  console.log(formatTest("Get Workflow"));

  try {
    const workflows = await listWorkflows();
    if (workflows.length === 0) {
      console.log(formatInfo("No workflows to test with"));
      return true;
    }

    const workflow = await getWorkflow(workflows[0].id);

    if (workflow && workflow.id === workflows[0].id) {
      console.log(formatInfo(`Retrieved: ${workflow.name}`));
      console.log(formatInfo(`Description: ${workflow.description || "None"}`));
      console.log(formatPass("Workflow retrieved successfully"));
      return true;
    } else {
      console.log(formatFail("Workflow retrieval failed"));
      return false;
    }
  } catch (err) {
    console.log(formatFail(`Error: ${err}`));
    return false;
  }
}

async function testGetWorkflowByName(): Promise<boolean> {
  console.log(formatTest("Get Workflow By Name"));

  try {
    const workflows = await listWorkflows();
    if (workflows.length === 0) {
      console.log(formatInfo("No workflows to test with"));
      return true;
    }

    const workflow = await getWorkflowByName(workflows[0].name);

    if (workflow && workflow.name === workflows[0].name) {
      console.log(formatInfo(`Found by name: ${workflow.name}`));
      console.log(formatPass("Workflow found by name successfully"));
      return true;
    } else {
      console.log(formatFail("Workflow not found by name"));
      return false;
    }
  } catch (err) {
    console.log(formatFail(`Error: ${err}`));
    return false;
  }
}

async function testUpdateWorkflow(): Promise<boolean> {
  console.log(formatTest("Update Workflow"));

  try {
    const workflows = await listWorkflows();
    if (workflows.length === 0) {
      console.log(formatInfo("No workflows to test with"));
      return true;
    }

    const original = workflows[0];
    const newDescription = `Updated at ${new Date().toISOString()}`;

    const updated = await updateWorkflow(original.id, {
      description: newDescription,
    });

    if (updated && updated.description === newDescription) {
      console.log(formatInfo(`Updated description: ${newDescription.slice(0, 30)}...`));
      console.log(formatPass("Workflow updated successfully"));

      // Restore original
      await updateWorkflow(original.id, { description: original.description });
      return true;
    } else {
      console.log(formatFail("Workflow update failed"));
      return false;
    }
  } catch (err) {
    console.log(formatFail(`Error: ${err}`));
    return false;
  }
}

async function testDryRunWorkflow(): Promise<boolean> {
  console.log(formatTest("Dry Run Workflow"));

  try {
    const workflows = await listWorkflows();

    // Find a workflow with steps, or create one
    let targetWorkflow = workflows.find((w) => w.steps.length > 0);

    if (!targetWorkflow) {
      // Create a test workflow with steps
      targetWorkflow = await createWorkflow({
        name: `Dry Run Test ${Date.now()}`,
        description: "Test workflow for dry run",
        steps: [
          {
            id: "step-1",
            type: "command",
            command: "echo 'test'",
            description: "Echo test",
          },
        ],
        tags: ["test"],
      });
    }

    const result = await dryRunWorkflow(targetWorkflow.id);

    if (result.success && result.steps && result.steps.length > 0) {
      console.log(formatInfo(`Steps to execute: ${result.steps.length}`));
      for (const step of result.steps.slice(0, 3)) {
        console.log(formatInfo(`  - ${step.description}`));
      }
      console.log(formatPass("Dry run completed successfully"));
      return true;
    } else {
      console.log(formatFail(`Dry run failed: ${result.error}`));
      return false;
    }
  } catch (err) {
    console.log(formatFail(`Error: ${err}`));
    return false;
  }
}

async function testIncrementRunCount(): Promise<boolean> {
  console.log(formatTest("Increment Run Count"));

  try {
    const workflows = await listWorkflows();
    if (workflows.length === 0) {
      console.log(formatInfo("No workflows to test with"));
      return true;
    }

    const originalCount = workflows[0].runCount;
    await incrementWorkflowRunCount(workflows[0].id);

    // Clear cache to force reload
    clearWorkflowsCache();

    const updated = await getWorkflow(workflows[0].id);

    if (updated && updated.runCount === originalCount + 1) {
      console.log(formatInfo(`Run count: ${originalCount} -> ${updated.runCount}`));
      console.log(formatPass("Run count incremented successfully"));
      return true;
    } else {
      console.log(formatFail("Run count increment failed"));
      return false;
    }
  } catch (err) {
    console.log(formatFail(`Error: ${err}`));
    return false;
  }
}

async function testSearchWorkflows(): Promise<boolean> {
  console.log(formatTest("Search Workflows"));

  try {
    const workflows = await listWorkflows();
    if (workflows.length === 0) {
      console.log(formatInfo("No workflows to test search"));
      return true;
    }

    const searchTerm = workflows[0].name.slice(0, 3).toLowerCase();
    const results = await searchWorkflows(searchTerm);

    console.log(formatInfo(`Search term: "${searchTerm}"`));
    console.log(formatInfo(`Results: ${results.length}`));

    if (results.length > 0 && results[0].name.toLowerCase().includes(searchTerm)) {
      console.log(formatPass("Search found matching workflows"));
      return true;
    } else {
      console.log(formatFail("Search failed to find matches"));
      return false;
    }
  } catch (err) {
    console.log(formatFail(`Error: ${err}`));
    return false;
  }
}

async function testDeleteWorkflow(): Promise<boolean> {
  console.log(formatTest("Delete Workflow"));

  try {
    // Create a test workflow to delete
    const workflow = await createWorkflow({
      name: `Delete Test ${Date.now()}`,
      description: "This will be deleted",
      steps: [],
      tags: ["test-delete"],
    });

    const deleted = await deleteWorkflow(workflow.id);

    if (deleted) {
      // Verify it's gone
      const notFound = await getWorkflow(workflow.id);
      if (!notFound) {
        console.log(formatPass("Workflow deleted and verified"));
        return true;
      } else {
        console.log(formatFail("Workflow still exists after deletion"));
        return false;
      }
    } else {
      console.log(formatFail("Delete operation failed"));
      return false;
    }
  } catch (err) {
    console.log(formatFail(`Error: ${err}`));
    return false;
  }
}

async function runWorkflowTests(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("  Workflow Service - Functional Tests");
  console.log("=".repeat(60));

  const results = await Promise.all([
    testCreateWorkflow(),
    testListWorkflows(),
    testGetWorkflow(),
    testGetWorkflowByName(),
    testUpdateWorkflow(),
    testDryRunWorkflow(),
    testIncrementRunCount(),
    testSearchWorkflows(),
    testDeleteWorkflow(),
  ]);

  const passCount = results.filter((r) => r).length;
  const totalCount = results.length;

  console.log("\n" + "=".repeat(60));
  console.log(`  Results: ${passCount}/${totalCount} test groups passed`);
  console.log("=".repeat(60) + "\n");

  if (passCount === totalCount) {
    console.log("\x1b[32m✓ All tests passed!\x1b[0m\n");
    process.exit(0);
  } else {
    console.log(`\x1b[31m✗ ${totalCount - passCount} test group(s) failed\x1b[0m\n`);
    process.exit(1);
  }
}

// Run tests
runWorkflowTests();
