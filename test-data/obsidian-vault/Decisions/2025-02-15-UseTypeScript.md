---
date: 2025-02-15
status: Accepted
tags: [language, typescript]
---

# Use TypeScript for All Code

## Context
OpenClaw needs to be maintainable and reliable for long-term personal use.

## Decision
Use TypeScript for all new code in the project.

## Alternatives Considered
1. **JavaScript**: Too error-prone, no type safety
2. **JSDoc with JS**: Verbose, not as powerful as TS

## Consequences
**Positive**:
- Catch errors at compile time
- Better IDE support
- Self-documenting code

**Negative**:
- Slightly more verbose
- Requires build step
