/**
 * Tmux session management for isolated agent environments.
 */

import { runCommandWithTimeout, resolveCommand } from "../process/exec.js";
import type { TmuxSessionOptions } from "./types.js";

const TMUX_PREFIX = "claw-";
const DEFAULT_TIMEOUT = 10_000;

/**
 * Check if tmux is available on the system.
 */
export async function isTmuxAvailable(): Promise<boolean> {
  try {
    const result = await runCommandWithTimeout([resolveCommand("tmux"), "-V"], DEFAULT_TIMEOUT);
    return result.code === 0;
  } catch {
    return false;
  }
}

/**
 * Check if a tmux session exists.
 */
export async function isSessionAlive(name: string): Promise<boolean> {
  try {
    const result = await runCommandWithTimeout(
      [resolveCommand("tmux"), "list-sessions", "-F", "#{session_name}"],
      DEFAULT_TIMEOUT,
    );
    if (result.code !== 0) {
      return false;
    }
    const sessions = result.stdout.trim().split("\n");
    return sessions.includes(name);
  } catch {
    return false;
  }
}

/**
 * Create a new tmux session and send an initial command.
 */
export async function createSession(opts: TmuxSessionOptions): Promise<{ success: boolean; error?: string }> {
  const { name, command, cwd, env } = opts;

  if (!name.match(/^[a-zA-Z0-9_-]+$/)) {
    return { success: false, error: "Invalid session name" };
  }

  // Check if session already exists
  if (await isSessionAlive(name)) {
    return { success: false, error: "Session already exists" };
  }

  try {
    // Create the session with an initial command
    const createArgs = [
      resolveCommand("tmux"),
      "new-session",
      "-d",
      "-s",
      name,
      "-n",
      "agent",
    ];

    const createResult = await runCommandWithTimeout(
      createArgs,
      { timeoutMs: DEFAULT_TIMEOUT, cwd, env },
    );

    if (createResult.code !== 0) {
      return { success: false, error: createResult.stderr };
    }

    // Send the initial command
    if (command) {
      await sendKeys(name, command);
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Send keys (input) to a tmux session.
 */
export async function sendKeys(session: string, keys: string): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await runCommandWithTimeout(
      [resolveCommand("tmux"), "send-keys", "-t", session, keys, "C-m"],
      DEFAULT_TIMEOUT,
    );
    return { success: result.code === 0, error: result.code !== 0 ? result.stderr : undefined };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Kill (terminate) a tmux session.
 */
export async function killSession(name: string): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await runCommandWithTimeout(
      [resolveCommand("tmux"), "kill-session", "-t", name],
      DEFAULT_TIMEOUT,
    );
    return { success: result.code === 0, error: result.code !== 0 ? result.stderr : undefined };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Capture output from a tmux session.
 */
export async function captureOutput(name: string, lines: number = 100): Promise<string> {
  try {
    const result = await runCommandWithTimeout(
      [resolveCommand("tmux"), "capture-pane", "-t", name, "-p", "-S", `-${lines}`],
      DEFAULT_TIMEOUT,
    );
    if (result.code === 0) {
      return result.stdout;
    }
    return "";
  } catch {
    return "";
  }
}

/**
 * List all claw-prefixed tmux sessions.
 */
export async function listSessions(): Promise<string[]> {
  try {
    const result = await runCommandWithTimeout(
      [resolveCommand("tmux"), "list-sessions", "-F", "#{session_name}"],
      DEFAULT_TIMEOUT,
    );
    if (result.code !== 0) {
      return [];
    }
    return result.stdout
      .trim()
      .split("\n")
      .filter((name) => name.startsWith(TMUX_PREFIX));
  } catch {
    return [];
  }
}

/**
 * Attach to a tmux session (for interactive use).
 * This returns the command string to run, doesn't execute it.
 */
export function getAttachCommand(name: string): string {
  return `tmux attach-session -t ${name}`;
}

/**
 * Detach all clients from a session.
 */
export async function detachSession(name: string): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await runCommandWithTimeout(
      [resolveCommand("tmux"), "detach-client", "-s", name],
      DEFAULT_TIMEOUT,
    );
    return { success: result.code === 0, error: result.code !== 0 ? result.stderr : undefined };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
