# Running tests

Tests in this repo always go through Nx — never invoke `vitest` or `jest` directly, as the bare binary skips Nx's cache and re-runs that should be free re-execute from scratch.

Command shapes:

- **Inner RED→GREEN** (single spec, optionally one test by name): `pnpm exec nx test <project> -- run <spec-path-relative-to-project> -t "<test name>"`. The spec path is relative to the project root (the target's cwd), e.g. `src/lib/canonical/canonicalize.spec.ts`, not `libs/core/src/...`. The `run` token is required so vitest does a single pass instead of entering watch mode. Args after `--` are part of Nx's cache key, so an identical repeat is served from cache.
- **Slice boundary / pre-refactor** (affected projects): `pnpm exec nx affected -t test`.
- **Pre-commit gate** (everything): `pnpm run check`.

## Who runs what

**Main agent**: NEVER invoke `nx test`, `nx affected -t test`, `nx run-many -t test`, `nx run <p>:test`, `pnpm test`, `pnpm run check`, `pnpm exec vitest`, `npx vitest`, `vitest`, or `jest` via the `Bash` tool. ALWAYS delegate to the `test-runner` subagent (`Agent` tool, `subagent_type="test-runner"`). The subagent runs the command and reports a concise pass/fail summary, keeping nx/vitest output out of the main conversation context. This applies to inner-loop file-scoped runs and to the pre-commit gate.

**`test-runner` subagent**: this rule does NOT apply to you — running these commands via `Bash` is exactly your job. Execute the command directly and report the result per the format in `.claude/agents/test-runner.md`.

## Enforcement

A PreToolUse hook (`.claude/hooks/no-direct-tests.sh`) hard-blocks direct invocations from the main agent. It detects subagent invocations via the `agent_id` field in hook input and lets them through, so the same hook is safe for the test-runner subagent and any other subagent that legitimately needs to run tests.
