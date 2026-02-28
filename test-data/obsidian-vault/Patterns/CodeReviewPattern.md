---
name: CodeReviewPattern
category: architecture
effectiveness: 0.78
usageCount: 5
tags: [review, code-quality]
---

# Code Review Pattern

## When to Use
Use this pattern when reviewing code changes.

## Prompt Template
```
Review the following code changes with focus on:

1. **Correctness**: Does it work as intended?
2. **Security**: Any vulnerabilities?
3. **Performance**: Any performance concerns?
4. **Maintainability**: Is it readable and maintainable?
5. **Consistency**: Does it match project style?

Diff: {{CODE_DIFF}}
Context: {{PROJECT_CONTEXT}}
```

## Effectiveness
78% success rate across 5 uses.

## Notes
- Be constructive in feedback
- Suggest improvements, don't just criticize
- Consider the bigger picture
