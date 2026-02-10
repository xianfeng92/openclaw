import process from "node:process";

let installed = false;

/**
 * Ensure undici's global dispatcher honors standard proxy env vars (HTTP_PROXY/HTTPS_PROXY/NO_PROXY).
 *
 * Why this exists:
 * - Node's native fetch does not automatically honor proxy env vars by default.
 * - @mariozechner/pi-ai installs EnvHttpProxyAgent, but does so asynchronously; the very first request
 *   can race and go direct, which is especially painful for googleapis-hosted providers.
 *
 * We install (and await) the dispatcher early during CLI startup to avoid that race.
 */
export async function installUndiciEnvHttpProxyAgent(): Promise<void> {
  if (installed) {
    return;
  }
  // Bun already handles proxy env vars for fetch() natively.
  if (!process.versions?.node) {
    installed = true;
    return;
  }
  try {
    const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("undici");
    setGlobalDispatcher(new EnvHttpProxyAgent());
  } catch {
    // Best-effort: if undici isn't available for some reason, keep going without proxy support.
  } finally {
    installed = true;
  }
}
