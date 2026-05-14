---
name: tdd
description: Test-driven development with red-green-refactor loop. Use when user wants to build features or fix bugs using TDD, mentions "red-green-refactor", wants integration tests, or asks for test-first development.
---

# Test-Driven Development

## Philosophy

**Core principle**: Tests should verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't.

**Good tests** are integration-style: they exercise real code paths through public APIs. They describe _what_ the system does, not _how_ it does it. A good test reads like a specification - "user can checkout with valid cart" tells you exactly what capability exists. These tests survive refactors because they don't care about internal structure.

**Bad tests** are coupled to implementation. They mock internal collaborators, test private methods, or verify through external means (like querying a database directly instead of using the interface). The warning sign: your test breaks when you refactor, but behavior hasn't changed. If you rename an internal function and tests fail, those tests were testing implementation, not behavior.

See [tests.md](tests.md) for examples and [mocking.md](mocking.md) for mocking guidelines.

## Anti-Pattern: Horizontal Slices

**DO NOT write all tests first, then all implementation.** This is "horizontal slicing" - treating RED as "write all tests" and GREEN as "write all code."

This produces **crap tests**:

- Tests written in bulk test _imagined_ behavior, not _actual_ behavior
- You end up testing the _shape_ of things (data structures, function signatures) rather than user-facing behavior
- Tests become insensitive to real changes - they pass when behavior breaks, fail when behavior is fine
- You outrun your headlights, committing to test structure before understanding the implementation

**Correct approach**: Vertical slices via tracer bullets. One test → one implementation → repeat. Each test responds to what you learned from the previous cycle. Because you just wrote the code, you know exactly what behavior matters and how to verify it.

```
WRONG (horizontal):
  RED:   test1, test2, test3, test4, test5
  GREEN: impl1, impl2, impl3, impl4, impl5

RIGHT (vertical):
  RED→GREEN: test1→impl1
  RED→GREEN: test2→impl2
  RED→GREEN: test3→impl3
  ...
```

## Workflow

### 1. Planning

When exploring the codebase, use the project's domain glossary so that test names and interface vocabulary match the project's language, and respect ADRs in the area you're touching.

Before writing any code:

- [ ] Confirm with user what interface changes are needed
- [ ] Confirm with user which behaviors to test (prioritize)
- [ ] Identify opportunities for [deep modules](deep-modules.md) (small interface, deep implementation)
- [ ] Design interfaces for [testability](interface-design.md)
- [ ] List the behaviors to test (not implementation steps)
- [ ] Get user approval on the plan

Ask: "What should the public interface look like? Which behaviors are most important to test?"

**You can't test everything.** Confirm with the user exactly which behaviors matter most. Focus testing effort on critical paths and complex logic, not every possible edge case.

### 2. Tracer Bullet

Write ONE test that confirms ONE thing about the system:

```
RED:   Write test for first behavior → test fails
GREEN: Write minimal code to pass → test passes
```

This is your tracer bullet - proves the path works end-to-end.

### 3. Incremental Loop

For each remaining behavior:

```
RED:   Write next test → fails
GREEN: Minimal code to pass → passes
```

Rules:

- One test at a time
- Only enough code to pass current test
- Don't anticipate future tests
- Keep tests focused on observable behavior

### 4. Refactor

After all tests pass, look for [refactor candidates](refactoring.md):

- [ ] Extract duplication
- [ ] Deepen modules (move complexity behind simple interfaces)
- [ ] Apply SOLID principles where natural
- [ ] Consider what new code reveals about existing code
- [ ] Run tests after each refactor step

**Never refactor while RED.** Get to GREEN first.

## Test Scope Per Cycle

Match the test command to the loop's radius. Running the whole workspace on every red→green tick burns time and tokens for no signal — you only need to know whether _this_ behavior flipped from failing to passing.

Always go through `nx`, never call `vitest` directly — the bare binary skips Nx's cache, so a re-run that should be free re-executes from scratch.

| Moment in the loop                          | What to run                                                | How                                                                       |
| ------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| Inner RED→GREEN (most cycles)               | Just the spec file you're editing, optionally one `-t` name | `pnpm exec nx test <project> -- run <spec-path-relative-to-project> -t "<test name>"` |
| Finished a vertical slice / before refactor | The affected project(s) only                               | `pnpm exec nx affected -t test`                                           |
| Before commit                               | Full validation                                            | `pnpm run check`                                                          |

The spec path in the inner-loop command is relative to the project root (the target's cwd), e.g. `src/lib/canonical/canonicalize.spec.ts`, not `libs/core/src/...`. The `run` token is required so vitest does a single pass instead of entering watch mode. Args after `--` are part of Nx's cache key, so a repeated identical run is served from cache.

Rules of thumb:

- Default to file-scoped + name-pattern in the tight loop. Widen scope only when you have a reason (touched shared code, finished a slice, about to refactor).
- Do **not** run `pnpm run check` or `nx run-many -t test` between every red and green. That's the pre-commit gate, not the development heartbeat.
- If a focused run goes green but you suspect collateral damage (changed a shared helper, touched a type used across packages), widen to `nx affected -t test` before continuing — don't wait for the final gate to find out.
- Never invoke `vitest` directly. Everything goes through `nx test` / `nx affected -t test` so the cache stays authoritative.

## Checklist Per Cycle

```
[ ] Test describes behavior, not implementation
[ ] Test uses public interface only
[ ] Test would survive internal refactor
[ ] Code is minimal for this test
[ ] No speculative features added
```
