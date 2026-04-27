---
name: do-work
description: "Execute a unit of work end-to-end: plan, implement, validate with typecheck and tests, then commit. Use when user wants to do work, build a feature, fix a bug, or implement a phase from a plan."
---

# Do Work

Execute a complete unit of work: plan it, build it, validate it, commit it.

## Workflow

### 1. Understand the task

Read any referenced plan or PRD. Explore the codebase to understand the relevant files, patterns, and conventions. If the task is ambiguous, ask the user to clarify scope before proceeding.

### 2. Plan the implementation (optional)

If the task has not already been planned, create a plan for it.

### 3. Implement

**For backend code**: use red/green/refactor, one test at a time in a tracer-bullet style.

1. Write a single failing test for the smallest vertical slice of behavior
2. Run the test — confirm it fails (red)
3. Write the minimum code to make it pass (green)
4. Repeat from step 1 for the next slice of behavior
5. Refactor if needed while keeping tests green

Each test should target one thin vertical slice through the system. Do not write all tests upfront — write one, make it pass, then move to the next.

**For frontend code**: implement directly without TDD.

### 4. Validate

Run the full validation suite and fix any issues. Repeat until everything passes cleanly.

```
pnpm run check
```

This runs build, lint, and test together. If you need to iterate faster on a single concern, the individual scripts are `pnpm run build`, `pnpm run lint`, and `pnpm run test` — but the final green light before committing must be `pnpm run check`.

### 5. Commit

Once `pnpm run check` passes cleanly, commit the work.

**If the task is associated with a GitHub issue**, reference it in the commit message using a closing keyword so the issue auto-closes when the commit lands on the default branch (or when the PR merges):

```
<type>(<scope>): <subject>

<body>

Closes #<issue-number>
```

Accepted closing keywords: `Closes`, `Fixes`, `Resolves` (case-insensitive). Use one trailer per issue if multiple issues are addressed (e.g. `Closes #12`, `Closes #15`). If no issue is associated with the task, omit the trailer.
