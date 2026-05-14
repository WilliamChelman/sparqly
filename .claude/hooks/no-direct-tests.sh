#!/usr/bin/env bash
# PreToolUse hook for Bash: blocks direct test-runner invocations so they go
# through the `test-runner` subagent instead. See CLAUDE.md → "Running tests".
#
# Exits 2 on block (Claude Code surfaces stderr back to the model as feedback).
# Exits 0 on allow (no output, tool call proceeds).

set -euo pipefail

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
[[ -z "$cmd" ]] && exit 0

# Allow when invoked from a subagent (test-runner, Explore, etc.). Hook input
# includes `agent_id`/`agent_type` for subagent calls and omits them for the
# main agent. The block exists to keep test output out of the main Opus
# context — once a subagent is carrying its own context, running the test
# there is the desired path.
agent_id=$(printf '%s' "$input" | jq -r '.agent_id // empty')
if [[ -n "$agent_id" ]]; then
  exit 0
fi

# "Command head" prefix: start-of-string (with optional leading whitespace),
# after a shell separator (; && || |), or after `$(`. This avoids false
# positives like `pnpm install vitest` or `cat path/to/vitest/...`.
HEAD='(^[[:space:]]*|[;&|]+[[:space:]]*|\$\([[:space:]]*)'

PATTERNS=(
  # pnpm/npm/yarn:
  #   pnpm test
  #   pnpm run test | pnpm run check
  #   pnpm exec vitest | pnpm exec jest
  #   pnpm exec nx test | nx affected -t test | nx run-many -t test | nx run <p>:test
  "${HEAD}(pnpm|npm|yarn)[[:space:]]+(test|run[[:space:]]+(test|check)|exec[[:space:]]+(vitest|jest|nx[[:space:]]+(test|affected[^|;&]*-t[[:space:]]+test|run-many[^|;&]*-t[[:space:]]+test|run[[:space:]]+[^[:space:]]+:test)))(\b|$)"
  # npx vitest|jest|nx test
  "${HEAD}npx[[:space:]]+(vitest|jest|nx[[:space:]]+(test|affected[^|;&]*-t[[:space:]]+test|run-many[^|;&]*-t[[:space:]]+test))(\b|$)"
  # Bare vitest or jest at a command head.
  "${HEAD}(vitest|jest)(\b|$)"
  # Bare nx at a command head.
  "${HEAD}nx[[:space:]]+(test|affected[^|;&]*-t[[:space:]]+test|run-many[^|;&]*-t[[:space:]]+test|run[[:space:]]+[^[:space:]]+:test)(\b|$)"
)

for re in "${PATTERNS[@]}"; do
  if printf '%s' "$cmd" | grep -qE "$re"; then
    cat >&2 <<'EOF'
Blocked: use the test-runner subagent for test runs.

Direct test commands (nx test, pnpm test, pnpm run check, vitest, jest)
bloat the main conversation context with nx/vitest output. Delegate via
the Agent tool with subagent_type="test-runner" — it parses results and
returns a concise pass/fail summary.

See CLAUDE.md → "Running tests".
EOF
    exit 2
  fi
done

exit 0
