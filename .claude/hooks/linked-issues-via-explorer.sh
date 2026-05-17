#!/usr/bin/env bash
# PreToolUse hook for Bash: blocks direct `gh issue/pr view` (and equivalent
# `gh api .../issues/<n>` / `.../pulls/<n>`) reads for any issue other than
# the primary one declared via $SPARQLY_ISSUE. Reads of linked or unrelated
# issues should go through the `explorer` subagent so their bodies do not
# bloat the main agent's context. See CLAUDE.md → "Issues reading".
#
# Activation: fires only when $SPARQLY_ISSUE is set. Launch with
#   SPARQLY_ISSUE=314 claude
# to declare the primary issue for the session.
#
# Exits 2 on block (stderr is surfaced back to the model). Exits 0 on allow.

set -euo pipefail

# No primary issue declared → hook is a no-op.
[[ -z "${SPARQLY_ISSUE:-}" ]] && exit 0

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
[[ -z "$cmd" ]] && exit 0

# Allow when invoked from a subagent — explorer / Explore / etc. carry their
# own context, which is the whole point of routing linked-issue reads there.
agent_id=$(printf '%s' "$input" | jq -r '.agent_id // empty')
[[ -n "$agent_id" ]] && exit 0

# Normalise: accept "#314", "314", "GH-314" etc. in the env var.
primary=$(printf '%s' "$SPARQLY_ISSUE" | tr -cd '0-9')
[[ -z "$primary" ]] && exit 0

# Extract each issue/PR target in the command. Patterns:
#   gh issue view <n>
#   gh pr view <n>
#   gh issue view https://github.com/<owner>/<repo>/issues/<n>
#   gh pr view    https://github.com/<owner>/<repo>/pull/<n>
#   gh api [flags] repos/<owner>/<repo>/issues/<n>
#   gh api [flags] repos/<owner>/<repo>/pulls/<n>
targets=$(
  printf '%s\n' "$cmd" | grep -oE \
    -e 'gh[[:space:]]+(issue|pr)[[:space:]]+view[[:space:]]+(#?[0-9]+|https?://github\.com/[^[:space:]]+/(issues|pull)/[0-9]+)' \
    -e 'gh[[:space:]]+api[[:space:]]+([^[:space:]]+[[:space:]]+)*repos/[^[:space:]]+/(issues|pulls)/[0-9]+' \
  || true
)
[[ -z "$targets" ]] && exit 0

while IFS= read -r match; do
  [[ -z "$match" ]] && continue
  n=$(printf '%s' "$match" | grep -oE '[0-9]+' | tail -1)
  [[ -z "$n" ]] && continue
  if [[ "$n" != "$primary" ]]; then
    cat >&2 <<EOF
Blocked: use the explorer subagent to read issue/PR #$n.

The primary issue declared via \$SPARQLY_ISSUE is #$primary. Reading
linked or unrelated issues directly bloats the main conversation
context. Delegate via the Agent tool with subagent_type="explorer"
and ask it to extract only the relevant fields.

See CLAUDE.md → "Issues reading". To change the primary issue, restart
Claude Code with SPARQLY_ISSUE=<n> claude.
EOF
    exit 2
  fi
done <<<"$targets"

exit 0
