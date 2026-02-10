# Windows Troubleshooting

Common issues and solutions specific to the Windows desktop application.

---

## Symptoms

1. `openclaw config set models.providers.google.apiKey` reports validation error about missing baseUrl
2. Windows Electron tray app shows `tray.getToolTip is not a function` on startup
3. Settings save fails with "Script not found" error

---

## Diagnosis Approach

### Check the facts first

- **No chat response**: Check `.openclaw-dev/agents/main/sessions/<sessionId>.jsonl` for the assistant record, confirm `stopReason/errorMessage`
- **Config write failures**: Schema/validation issue
- **Electron tray/preload**: Electron API compatibility or loading mechanism issue
- **Settings script not found**: Path resolution/execution method issue
- **For preload/bridge issues**: Add preload-error listener + page probe (`typeof window.electron`)

---

## Solutions

### A) Config set apiKey validation error

**Root cause**

- Schema required both `baseUrl` and `apiKey` to be set simultaneously

**Fix**

- Allow `models.providers.<id>` to set only apiKey (don't force baseUrl/models)
- But if `models.providers.<id>.models` is explicitly set, baseUrl is still required

**Files changed**

- `src/config/zod-schema.core.ts`
- `src/agents/models-config.providers.ts`

---

### B) Webchat sends message but gets no reply

**Root cause**

- Session logs show assistant with `stopReason:"error"` and `TypeError: fetch failed sending request`
- Node fetch directly connecting to Google times out, needs proxy
- Environment variables `HTTP_PROXY/HTTPS_PROXY/ALL_PROXY` exist but gateway process may not inherit them

**Solution**

- Ensure key is written to correct profile (--dev uses .openclaw-dev)
- Set proxy environment variables before starting gateway

---

### C) Windows Electron: Tray / Settings bridge / preload

#### 1) tray.getToolTip is not a function

**Root cause**

- Electron Tray doesn't have getToolTip() (or version incompatible), possibly running old dist

**Fix**

- Ensure build before running (avoid old dist)
- Clean up `require(...)` in tray code under ESM
- Fix TS issues found by typecheck (menuTemplate types, NativeImage misuse, net.request destroy/abort)

#### 2) Settings reports "Desktop bridge not available" (preload not loaded)

**Root cause** (confirmed via logs)

- `preload-error: ... SyntaxError: Cannot use import statement outside a module`
- Preload output is ESM (index.mjs), but Electron preload environment executes as CJS, causing failure and window.electron not being injected

**Fix**

- Build preload separately as CJS: generate `dist/preload/index.cjs`
- Set `BrowserWindow webPreferences.sandbox = false` (avoid sandbox preload environment differences)
- Point preload path to index.cjs
- Expose bridge to both `window.electron` and `window.__openclawDesktop`, with fallback in settings.html

**Files changed**

- `apps/windows/package.json`: Split build into build:main(esm) + build:preload(cjs)
- `apps/windows/src/preload/index.ts`
- `apps/windows/src/main/index.ts`
- `apps/windows/src/main/window.ts`
- `apps/windows/src/main/settings.ts`
- `apps/windows/resources/settings.html`

---

### D) Settings save script not found

**Root cause**

- Settings used relative path to guess repo root, calculated incorrectly

**Fix**

- Add `resolveRepoRoot()`: Search upward from `app.getAppPath()` / `process.cwd()` / `__dirname` for `scripts/run-node.mjs`
- Change command execution to structured args (not split(" "))
- Use `--profile desktop` when writing config to align with Windows app gateway startup

**Files changed**

- `apps/windows/src/main/settings.ts`

---

## Verification (success criteria)

- Settings window logs show: `hasElectron: 'object', hasDesktop: 'object'`
- After saving settings, see: `Config command success: node ...scripts/run-node.mjs --profile desktop config set ...`
- Gateway status changes normally (if it shows "external process", an external gateway is already running on the port - this is expected)

---

## Additional Notes

- API keys should be masked in logs (show only first/last few characters) to avoid accidental exposure
