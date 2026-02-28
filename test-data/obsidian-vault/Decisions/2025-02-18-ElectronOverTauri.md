---
date: 2025-02-18
status: Accepted
tags: [framework, desktop]
---

# Use Electron Instead of Tauri

## Context
Need a desktop framework for the terminal app.

## Decision
Use Electron for the desktop application.

## Alternatives Considered
1. **Tauri**: Smaller bundle size, but less mature
2. **Neutralino**: Too limited for our needs

## Consequences
**Positive**:
- Mature ecosystem
- Excellent documentation
- Easy debugging with DevTools

**Negative**:
- Larger bundle size (~100MB)
- Higher memory usage
