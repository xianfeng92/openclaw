---
name: BugFixTemplate
category: debugging
effectiveness: 0.85
usageCount: 12
tags: [bug, fix, debugging]
---

# Bug Fix Template

## When to Use
Use this pattern when fixing bugs or errors in the codebase.

## Prompt Template
```
You are fixing a bug in the codebase. Follow this process:

1. **Understand Expected Behavior**: What should happen?
2. **Identify Actual Behavior**: What's happening instead?
3. **Reproduce**: Create steps to reproduce the issue
4. **Root Cause**: Use debugging tools to find the cause
5. **Fix**: Implement the minimal fix
6. **Test**: Add tests to prevent regression
7. **Verify**: Confirm the fix works

Context:
- Bug Description: {{BUG_DESCRIPTION}}
- Relevant Files: {{RELEVANT_FILES}}
- Related Decisions: {{RELATED_DECISIONS}}
```

## Example
```
Use BugFixTemplate to fix login crash.
```

## Effectiveness
85% success rate across 12 uses.

## Notes
- Always add tests before fixing
- Consider edge cases
- Check for similar issues elsewhere
