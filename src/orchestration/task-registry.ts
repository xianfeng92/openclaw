/**
 * Task registry for tracking active and completed tasks.
 * Uses atomic file writes for persistence.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import JSON5 from "json5";
import { emitAgentEvent } from "../infra/agent-events.js";
import { resolveStateDir } from "../config/paths.js";
import type { ActiveTask, TaskRegistryData, TaskStatus } from "./types.js";

const REGISTRY_VERSION = 1;
const REGISTRY_FILENAME = "active-tasks.json";

let cachedRegistry: TaskRegistryData | null = null;
let cacheFilePath: string | null = null;

function getRegistryPath(): string {
  if (cacheFilePath) {
    return cacheFilePath;
  }
  const stateDir = resolveStateDir();
  cacheFilePath = path.join(stateDir, REGISTRY_FILENAME);
  return cacheFilePath;
}

function getDefaultRegistry(): TaskRegistryData {
  return {
    version: REGISTRY_VERSION,
    lastUpdated: Date.now(),
    tasks: [],
  };
}

function parseRegistry(raw: string): TaskRegistryData | null {
  const parsed = JSON5.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  if (Array.isArray(parsed.tasks) && typeof parsed.version === "number") {
    return parsed as TaskRegistryData;
  }
  return null;
}

async function atomicWrite(filePath: string, data: TaskRegistryData): Promise<void> {
  const dir = path.dirname(filePath);

  // Ensure directory exists
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });

  const json = JSON.stringify(data, null, 2).trimEnd().concat("\n");
  const tmp = path.join(
    dir,
    `${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );

  await fs.promises.writeFile(tmp, json, {
    encoding: "utf-8",
    mode: 0o600,
  });

  // Windows fallback for atomic operations
  try {
    await fs.promises.rename(tmp, filePath);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "EPERM" || code === "EEXIST") {
      await fs.promises.copyFile(tmp, filePath);
      await fs.promises.chmod(filePath, 0o600).catch(() => {});
      await fs.promises.unlink(tmp).catch(() => {});
      return;
    }
    await fs.promises.unlink(tmp).catch(() => {});
    throw err;
  }
}

function clearCache(): void {
  cachedRegistry = null;
}

export async function load(): Promise<TaskRegistryData> {
  const filePath = getRegistryPath();

  if (cachedRegistry) {
    return cachedRegistry;
  }

  if (!fs.existsSync(filePath)) {
    cachedRegistry = getDefaultRegistry();
    return cachedRegistry;
  }

  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    const parsed = parseRegistry(raw);
    if (parsed) {
      cachedRegistry = parsed;
      return parsed;
    }
  } catch (err) {
    // Log error but return default
    console.error(`Failed to load task registry: ${err}`);
  }

  cachedRegistry = getDefaultRegistry();
  return cachedRegistry;
}

export async function save(data: TaskRegistryData): Promise<void> {
  const filePath = getRegistryPath();
  data.lastUpdated = Date.now();
  await atomicWrite(filePath, data);
  cachedRegistry = data;
}

export async function createTask(task: Omit<ActiveTask, "id">): Promise<ActiveTask> {
  const registry = await load();

  // Generate a unique ID
  let taskId: string;
  let counter = 0;
  do {
    taskId = `task-${Date.now()}-${String(counter++).padStart(3, "0")}`;
  } while (registry.tasks.some((t) => t.id === taskId));

  const newTask: ActiveTask = {
    ...task,
    id: taskId,
  };

  registry.tasks.push(newTask);
  await save(registry);

  // Emit event
  emitAgentEvent({
    runId: taskId,
    stream: "lifecycle",
    data: {
      event: "task_created",
      task: newTask,
    },
  });

  return newTask;
}

export async function getTask(taskId: string): Promise<ActiveTask | null> {
  const registry = await load();
  return registry.tasks.find((t) => t.id === taskId) ?? null;
}

export async function listTasks(): Promise<ActiveTask[]> {
  const registry = await load();
  return registry.tasks;
}

export async function updateTask(
  taskId: string,
  updates: Partial<ActiveTask>,
): Promise<ActiveTask | null> {
  const registry = await load();
  const index = registry.tasks.findIndex((t) => t.id === taskId);

  if (index === -1) {
    return null;
  }

  const updatedTask = {
    ...registry.tasks[index],
    ...updates,
  };

  registry.tasks[index] = updatedTask;
  await save(registry);

  // Emit event
  emitAgentEvent({
    runId: taskId,
    stream: "lifecycle",
    data: {
      event: "task_updated",
      task: updatedTask,
    },
  });

  return updatedTask;
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  error?: string,
): Promise<ActiveTask | null> {
  const updates: Partial<ActiveTask> = { status };

  if (status === "completed" || status === "failed") {
    updates.completedAt = Date.now();
  }

  if (error) {
    updates.error = error;
  }

  return updateTask(taskId, updates);
}

export async function deleteTask(taskId: string): Promise<boolean> {
  const registry = await load();
  const index = registry.tasks.findIndex((t) => t.id === taskId);

  if (index === -1) {
    return false;
  }

  registry.tasks.splice(index, 1);
  await save(registry);

  // Emit event
  emitAgentEvent({
    runId: taskId,
    stream: "lifecycle",
    data: {
      event: "task_deleted",
      taskId,
    },
  });

  return true;
}

export function clearCacheForTest(): void {
  clearCache();
  cacheFilePath = null;
}
