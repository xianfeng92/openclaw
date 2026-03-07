# Apple Platform Rules

## Scope

Apply these rules for `apps/ios/**`, `apps/macos/**`, and Apple-specific release/runtime work.

## Runtime Rules

- Prefer the Observation framework for new SwiftUI state work unless compatibility requires otherwise.
- Restarting apps means rebuild plus relaunch, not just killing the process.
- Prefer connected real devices before simulators or emulators when testing mobile behavior.

## macOS Gateway Rules

- Start and stop the gateway via the app or project scripts, not ad-hoc sessions.
- Do not rebuild the macOS app over SSH.

## Release Rules

- Follow the repository release docs before touching signing, versioning, packaging, or notarization.
