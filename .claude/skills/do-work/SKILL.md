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

This runs build, lint, and test together. If you need to iterate faster on a single concern, the individual scripts are `pnpm run build`, `pnpm run lint`, and `pnpm run test` — but the final green light must be `pnpm run check`.

### 5. Refactor

With tests green, review the changes for quality, modularity, and DRYness before committing. The goal is to leave the code better than you found it, without expanding scope.

Look for:
- **Duplication**: repeated logic, near-identical blocks, or copy-pasted patterns that should be extracted into a shared helper or module.
- **Shallow modules**: thin wrappers, leaky abstractions, or modules whose interface is as complex as their implementation — deepen them or inline them.
- **Misplaced responsibility**: code that lives in the wrong layer, functions doing two unrelated things, or types that belong in a different file.
- **Naming**: identifiers that no longer reflect what the code does after the change.
- **Dead code**: branches, parameters, exports, or comments left behind by the implementation.

Constraints:
- Do not expand scope. Only refactor code touched by or directly adjacent to this change. Defer broader cleanup to a separate task.
- Keep behavior identical. Refactors must not change semantics — tests stay green throughout.
- Re-run `pnpm run check` after refactoring. The final green light before committing is a clean check **after** the refactor pass.

If nothing meaningful improves, skip this step — do not invent changes.

### 6. Commit

Once `pnpm run check` passes cleanly after the refactor pass, commit the work.

**If the task is associated with a GitHub issue**, reference it in the commit message using a closing keyword so the issue auto-closes when the commit lands on the default branch (or when the PR merges):

```
<type>(<scope>): <subject>

<body>

Closes #<issue-number>
```

Accepted closing keywords: `Closes`, `Fixes`, `Resolves` (case-insensitive). Use one trailer per issue if multiple issues are addressed (e.g. `Closes #12`, `Closes #15`). If no issue is associated with the task, omit the trailer.
