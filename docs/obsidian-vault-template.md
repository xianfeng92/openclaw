# OpenClaw Obsidian Vault Template

This is a template Obsidian vault for storing business context that OpenClaw can use to provide context to AI agents.

## Folder Structure

```
Obsidian/Vault/
├── Customers/          # Customer information
├── Projects/           # Project tracking
├── Meetings/           # Meeting notes
├── Decisions/          # Technical decisions
└── Patterns/           # Effective prompts/patterns
```

## File Templates

### Customers/CustomerName.md

```yaml
---
title: Acme Corp
email: tech@acme.com
contact: John Doe
tags:
  - enterprise
  - typescript
config:
  preferredLanguage: TypeScript
  codeStyle: strict
---

# Acme Corp

Enterprise client specializing in e-commerce solutions.

## Notes
- Prefers TypeScript over JavaScript
- Requires thorough testing
- EST timezone
```

### Projects/ProjectName.md

```yaml
---
title: E-commerce Platform
customer: Acme Corp
status: active
startDate: 2025-01-15
tags:
  - ecommerce
  - marketplace
---

# E-commerce Platform

Multi-vendor marketplace implementation for Acme Corp.

## Requirements
- Support for multiple sellers
- Real-time inventory management
- Payment gateway integration
```

### Decisions/YYYY-MM-DD-DecisionTitle.md

```yaml
---
title: Use PostgreSQL for primary database
status: accepted
---

# Use PostgreSQL for primary database

## Context
The application needs to handle high transaction volumes and complex queries.

## Decision
Use PostgreSQL as the primary database with read replicas for scaling.

## Consequences
- Better query performance for complex joins
- Requires database migration strategy
- Increased operational complexity
```

### Meetings/YYYY-MM-DD-Topic.md

```yaml
---
title: Feature Planning Discussion
date: 2025-02-25
attendees:
  - Alice
  - Bob
  - Charlie
projects:
  - E-commerce Platform
---

# Feature Planning Discussion

Discussed priorities for Q1 features.

## Action Items
- [ ] Define API endpoints
- [ ] Create wireframes
- [ ] Set up staging environment
```

### Patterns/EffectivePromptPattern.md

```yaml
---
title: Bug Fix Template
category: coding
effectiveness: 0.8
usageCount: 5
---

# Bug Fix Template

Effective pattern for debugging and fixing bugs.

## Prompt
```
When fixing a bug:
1. First, understand the expected behavior
2. Identify where the actual behavior differs
3. Add logging/debugging to narrow down the issue
4. Fix the root cause, not just symptoms
5. Add tests to prevent regression
```

## When to Use
Use this pattern whenever a bug is reported. It ensures systematic debugging and prevents quick fixes that introduce new issues.
```

## Testing

1. Copy this folder structure to your Obsidian vault
2. Run `/context load <vault-path>` in the OpenClaw terminal
3. Use `/context summary` to verify context is loaded
4. Create a task with `/spawn "Add feature for Acme Corp"` - context should be displayed
