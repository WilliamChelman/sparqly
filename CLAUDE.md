## Agent skills

### Running tests

Main agent delegates test runs to the `test-runner` subagent; the subagent itself runs commands directly. See `docs/agents/running-tests.md`.

### Issue tracker

GitHub Issues on `WilliamChelman/sparqly` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Agent navigation

File-size budget: soft 300, hard 500 (ADR-0026). Use this to your advantage.

- **Barrels first.** When entering an unfamiliar feature folder under `libs/core/src/lib/<feature>/` or `libs/server/src/lib/<feature>/`, read `index.ts` before any sibling. ~10 lines tells you what is public; skim the export names and only open the sibling whose name matches your task.
- **`explorer` subagent for ≥400-line files.** Files at or near the 500-line ceiling are the ones most likely to mix concerns you do not need. Delegate the read to the `explorer` subagent with a focused question ("which lines in `view-cache.ts` handle TTL eviction?") instead of pulling the whole buffer into your context. Files under 300 are safe to read directly.
- **Specs as contract.** A sibling's `.spec.ts` is the fastest way to learn what it does — the test names enumerate the behaviour, and `*.golden.spec.ts` files pin the exact output shape. When in doubt about what a function is *supposed* to do, read its spec before its implementation.
