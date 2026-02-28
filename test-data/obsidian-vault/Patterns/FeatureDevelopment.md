---
name: FeatureDevelopment
category: coding
effectiveness: 0.92
usageCount: 8
tags: [feature, development]
---

# Feature Development Pattern

## When to Use
Use this pattern when developing new features.

## Prompt Template
```
You are implementing a new feature. Follow this process:

1. **Requirements**: Understand what needs to be built
2. **Design**: Plan the implementation approach
3. **Dependencies**: Check what needs to be modified
4. **Implementation**: Write clean, tested code
5. **Integration**: Ensure it works with existing code
6. **Documentation**: Update relevant docs

Feature: {{FEATURE_DESCRIPTION}}
Context: {{BUSINESS_CONTEXT}}
Related Projects: {{RELATED_PROJECTS}}
```

## Effectiveness
92% success rate across 8 uses.

## Notes
- Always consider existing patterns
- Check for similar features that can be reused
- Think about maintainability
