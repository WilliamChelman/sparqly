---
status: accepted
---

# Syntax highlighting for displayed code via CodeMirror `runMode`

## Context

The webapp displays code in four places, all rendered today as un-highlighted plain text:

- the query result pane's `raw` tab (`result-raw.component.ts`) — the server's wire output: `application/sparql-results+json` for SELECT/ASK, Turtle/N-Triples/N-Quads/TriG for triples;
- the query result pane's `turtle`/`trig` tab (`formatted-result.component.ts`) — the `sparqly format` output produced in the browser (ADR-0014);
- the `diff` page's source snippets (`source-snippet.component.ts`) — excerpts of real `.ttl`/`.trig` files on disk;
- the `diff` page's hunk lines (`diff-hunk.component.ts`) — the `+`/`-` lines, each a prefix-shortened Turtle *fragment*.

The SPARQL editor (Yasqe) is already syntax-highlighted and is explicitly out of scope. The gap is everywhere code is *displayed* rather than *edited*.

Two facts shape the decision. First, `@triply/yasqe` already depends on `codemirror@^5.51.0`, so `codemirror@5.65.21` is resolved in the lockfile — CodeMirror 5 is in the dependency tree whether or not this feature exists. CodeMirror 5 ships a `turtle` mode, a `javascript` mode (which handles JSON), and a `runmode` addon that tokenizes static text into `cm-*`-classed spans with no editor instance. Second, `apps/web/src/cm-s-sparqly.css` already maps every `cm-*` token class (`cm-keyword`, `cm-string`, `cm-number`, `cm-comment`, `cm-atom`, `cm-meta`, `cm-variable-3`, …) to the design-system palette, with `:root[data-theme='dark']` variants — built for the editor, but class-for-class reusable by anything that emits the same token classes.

## Decision

Highlight displayed code by running CodeMirror 5's `runMode` over the text and rendering the resulting token model. `codemirror` is promoted to a direct dependency of `apps/web` at the version already locked; the result pane imports `codemirror/addon/runmode/runmode`, `codemirror/mode/turtle/turtle`, and `codemirror/mode/javascript/javascript`.

A shared tokenize function wraps `runMode` and is the single source of truth. It returns a `{ text, className }[]` token model rendered through an Angular `@for` template — not `innerHTML` — so the surfaces stay `OnPush`- and sanitizer-safe. A thin `<app-code-block>` component sits over the function for the two single-`<pre>` surfaces (`raw`, `turtle`); `source-snippet` and `diff-hunk` call the function directly, per line, inside their existing gutter / `+`-`-`-marker layouts. Highlighted output carries the `cm-s-sparqly` ancestor class, so the existing editor theme — including its light/dark variants — applies with no new theme CSS.

Hunk lines are tokenized as Turtle fragments: the rendered fragment string is fed through the `turtle` mode (line-oriented and CURIE-aware, so a subject-less fragment tokenizes acceptably), while the `+`/`-` diff markers stay as a plain, un-tokenized prefix.

Highlighting on the `raw`/`turtle` tabs is lazy on tab activation and memoized per `DecodedResult`. Above a soft line/byte threshold the surface falls back to the existing plain `<pre>` — highlighting multiplies DOM node count per line, and an un-capped 100k-line CONSTRUCT would freeze the tab where plain text did not. Content with no recognized mode (RDF/XML, unknown content types) also falls back to plain text rather than erroring.

This introduces no domain term. Syntax highlighting is pure UI presentation; CONTEXT.md is unchanged, consistent with ADR-0014 treating result-pane views as "UI surface, not domain language".

## Considered alternatives

- **Prism.js.** A clean standalone tokenizer with `turtle`/`sparql`/`json` grammars. Rejected: it is a new dependency family and would need a fresh theme mapping Prism's `token` classes to the design-system CSS variables with dark variants — duplicating the `cm-s-sparqly` effort — after which the editor and the result pane would drift apart on every palette change.
- **Shiki.** The most accurate option (TextMate grammars). Rejected: heavy (oniguruma WASM) and its JSON-theme model fights a CSS-variable design system, making runtime light/dark awkward.
- **Hand-rolled Turtle/JSON tokenizer.** Tiny, no dependency, full control over fragments. Rejected: a correct Turtle tokenizer (triple-quoted literals, escapes, datatypes, langtags, RDF-star) is a real maintenance surface, and it would still give zero consistency with the editor.
- **Structured token spans for hunk lines** built from the `HunkLine` term data instead of tokenizing the rendered string. Rejected: it is a second, hand-rolled highlighting mechanism diverging from the `runMode` path used by the other three surfaces, for marginal precision on an already-shortened fragment.
- **No size cap**, matching ADR-0014 literally. Rejected: ADR-0014 rejected a cap because plain text in a `<pre>` is cheap; highlighting replaces each line with several `<span>`s, so the cost profile differs enough to justify the deviation. The fallback is the rendering that exists today — a graceful degrade, not a missing feature.

## Consequences

- `codemirror@^5.65.21` becomes a direct dependency of `apps/web`; the bundle gains the `turtle` mode, `javascript` mode, and `runmode` addon. No new top-level dependency family — CodeMirror 5 was already present transitively via Yasqe.
- `cm-s-sparqly.css` now themes static `runMode` output in addition to the editor; its header comment is updated to say so. No new theme rules, no new dark-mode rules.
- The codebase is committed to CodeMirror 5 — a maintenance-mode library — as its highlighter. This adds no lock-in beyond what Yasqe already imposes; if Yasqe ever migrates off CM5, this decision is revisited alongside it.
- A new shared tokenize function and a thin `<app-code-block>` component live under `apps/web/src/app/modules/`; `result-raw`, `formatted-result`, `source-snippet`, and `diff-hunk` consume them.
- No server, wire-contract, or CLI change. Highlighting is entirely client-side, consistent with ADR-0011 and ADR-0014.
