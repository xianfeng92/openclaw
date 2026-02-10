import process from "node:process";

function isBrokenPipeError(err: unknown): err is NodeJS.ErrnoException {
  const code = (err as NodeJS.ErrnoException | null | undefined)?.code;
  return code === "EPIPE" || code === "EIO";
}

/**
 * Prevents the process from crashing when stdout/stderr is a broken pipe.
 *
 * This is common when OpenClaw is spawned as a child process whose parent closes the pipe
 * (e.g. desktop shells, detached launchers, or log collectors).
 */
export function installBrokenPipeHandlers(): void {
  const attach = (stream: NodeJS.WriteStream) => {
    // Avoid double-attaching when modules are loaded multiple times.
    const s = stream as unknown as { __openclawBrokenPipeHandler?: boolean };
    if (s.__openclawBrokenPipeHandler) {
      return;
    }
    s.__openclawBrokenPipeHandler = true;

    stream.on("error", (err) => {
      if (isBrokenPipeError(err)) {
        return;
      }
      // Preserve default behavior for unexpected stream errors.
      process.nextTick(() => {
        throw err;
      });
    });
  };

  attach(process.stdout);
  attach(process.stderr);
}
