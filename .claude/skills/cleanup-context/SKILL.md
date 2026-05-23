---
name: cleanup-context
description: Audit and clean up CONTEXT.md files against the project's documented glossary format and rules. Use when the user wants to tidy, refactor, deduplicate, normalize, or lint CONTEXT.md (or per-context CONTEXT.md files when a CONTEXT-MAP.md exists).
---

# Cleanup CONTEXT.md

## Authoritative references

Do **not** restate the rules — read them every run:

- File layout, single vs multi-context conventions, and the role of `CONTEXT.md`: [`../grill-with-docs/SKILL.md`](../grill-with-docs/SKILL.md) (sections "Domain awareness" and "Update CONTEXT.md inline").
- Glossary structure, term format, and rules: [`../grill-with-docs/CONTEXT-FORMAT.md`](../grill-with-docs/CONTEXT-FORMAT.md).

If either file is missing, stop and tell the user — this skill has nothing to enforce against.

## Workflow

1. **Load the rules.** Read both reference files above. Treat their "Rules" and "Structure" sections as the spec for this run.
2. **Locate targets.**
   - If `CONTEXT-MAP.md` exists at the repo root, read it and collect every `CONTEXT.md` it points to.
   - Otherwise, the root `CONTEXT.md` is the only target.
   - If no `CONTEXT.md` exists anywhere, stop — there is nothing to clean.
3. **Audit each target** against the loaded rules (see checklist below). Produce a short list of findings per file, grouped by issue type.
4. **Confirm scope with the user** before editing — show the findings and ask which to apply. Default to applying all unless the user objects.
5. **Edit in place.** Preserve the file's existing voice and any terms that already pass the rules. Do not rewrite from scratch.
6. **Re-read** the file after edits and verify each finding is resolved.

## Audit checklist

Derive this from the referenced files; use it as a memory aid, not a substitute. For each file:

- [ ] Header is `# {Context Name}` followed by a 1–2 sentence description.
- [ ] Every term follows the `**Term**: definition` shape with optional `_Avoid_:` aliases.
- [ ] Definitions are 1–2 sentences and describe what the term **is**, not what it does.
- [ ] Implementation details are removed (no APIs, file paths, code, config, infra choices).
- [ ] General programming concepts that aren't project-specific are removed.
- [ ] Synonyms used elsewhere in the doc or codebase appear under `_Avoid_`.
- [ ] Near-duplicate terms are merged; one canonical term wins, others move to `_Avoid_`.
- [ ] Cardinality and relationships between terms are expressed where obvious.
- [ ] Natural clusters are grouped under subheadings; otherwise the list stays flat.
- [ ] A "Flagged ambiguities" section captures unresolved conflicts (don't silently fix — surface them).
- [ ] An example dialogue between a dev and a domain expert exists, uses bold term names, and exercises the boundaries between related concepts.
- [ ] (Multi-context only) Terms belong to the right context; cross-context terms are noted in `CONTEXT-MAP.md` under Relationships rather than duplicated.

## What this skill does NOT do

- It does not invent new domain terms. If a term is missing, note the gap and recommend a `grill-with-docs` session.
- It does not resolve ambiguities by guessing. Surface them in "Flagged ambiguities" and let the user decide.
- It does not touch ADRs, code, or any file other than the located `CONTEXT.md` / `CONTEXT-MAP.md` files.
