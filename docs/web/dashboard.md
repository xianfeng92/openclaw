---
summary: "Gateway dashboard (Control UI) access and auth"
read_when:
  - Changing dashboard authentication or exposure modes
title: "Dashboard"
---

# Dashboard (Control UI)

The Gateway dashboard is the browser Control UI served at `/` by default
(override with `gateway.controlUi.basePath`).

Quick open (local Gateway):

- [http://127.0.0.1:18789/](http://127.0.0.1:18789/) (or [http://localhost:18789/](http://localhost:18789/))

Key references:

- [Control UI](/web/control-ui) for usage and UI capabilities.
- [Tailscale](/gateway/tailscale) for Serve/Funnel automation.
- [Web surfaces](/web) for bind modes and security notes.

Authentication is enforced at the WebSocket handshake via `connect.params.auth`
(token or password). See `gateway.auth` in [Gateway configuration](/gateway/configuration).

Security note: the Control UI is an **admin surface** (chat, config, exec approvals).
Do not expose it publicly. The UI stores the token in `localStorage` after first load.
Prefer localhost, Tailscale Serve, or an SSH tunnel.

## Fast path (recommended)

- After onboarding, the CLI auto-opens the dashboard and prints a clean (non-tokenized) link.
- Re-open anytime: `openclaw dashboard` (copies link, opens browser if possible, shows SSH hint if headless).
- If the UI prompts for auth, paste the token from `gateway.auth.token` (or `OPENCLAW_GATEWAY_TOKEN`) into Control UI settings.

## Token basics (local vs remote)

- **Localhost**: open `http://127.0.0.1:18789/`.
- **Token source**: `gateway.auth.token` (or `OPENCLAW_GATEWAY_TOKEN`); the UI stores a copy in localStorage after you connect.
- **Not localhost**: use Tailscale Serve (tokenless if `gateway.auth.allowTailscale: true`), tailnet bind with a token, or an SSH tunnel. See [Web surfaces](/web).

## Desktop companion apps

Some OpenClaw desktop apps embed the dashboard (Control UI) in an app window and manage authentication for you.

Security goals:

- Keep gateway auth enabled (token or password).
- Avoid placing secrets in the URL.
- Avoid printing secrets to logs.
- Keep secrets out of process args when possible.

How it typically works:

- The desktop app runs the gateway on a loopback-only address and a known local port.
- The desktop app generates and stores a random gateway auth token locally.
- The desktop app injects the token into the gateway process via `OPENCLAW_GATEWAY_TOKEN`.
- The embedded dashboard stores the token in `localStorage` (key: `openclaw.control.settings.v1`) so reconnects are automatic.

### Recovery and reset

If the embedded dashboard shows `unauthorized` (WS close code 1008) or keeps disconnecting:

1. Restart the gateway from the desktop app (or restart the desktop app).
2. Rotate the desktop token if your app provides a menu item for it (this forces all embedded dashboard tabs to reconnect).
3. Clear the dashboard localStorage settings and reload:
   - Open DevTools for the dashboard page.
   - Run: `localStorage.removeItem("openclaw.control.settings.v1")`
   - Reload the page.

If you also open the dashboard in a standalone browser, be aware that the browser may have an old token stored in localStorage. Clearing `openclaw.control.settings.v1` (or using an Incognito window) is the fastest reset.

## If you see “unauthorized” / 1008

- Ensure the gateway is reachable (local: `openclaw status`; remote: SSH tunnel `ssh -N -L 18789:127.0.0.1:18789 user@host` then open `http://127.0.0.1:18789/`).
- Retrieve the token from the gateway host: `openclaw config get gateway.auth.token` (or generate one: `openclaw doctor --generate-gateway-token`).
- In the dashboard settings, paste the token into the auth field, then connect.
