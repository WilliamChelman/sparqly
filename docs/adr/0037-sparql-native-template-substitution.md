---
status: proposed
---

# Client-side SPARQL-native template substitution via `VALUES`

## Context

The new **Templated saved query** concept (CONTEXT.md, ADR-0036) lets users save a SPARQL query parameterized by a small set of run-time inputs, present a form for those inputs in the webapp, and execute the result. The substitution model — *how* a template plus a set of **parameter bindings** becomes runnable SPARQL — is the load-bearing choice of this feature: it determines what the editor sees, what the validator sees, where injection risk lives, where the executor lives, and whether CLI parity is reachable.

The default templating instinct from the web-app world is text-level placeholder substitution (`{{var}}`, Mustache-style). That is genuinely simpler to author and maximally expressive (any token position can be parameterized), but it places the template *outside* every existing sparqly invariant: the template body is not parseable SPARQL, the existing shape detector (`detectQueryType`) can't classify it, YASQE can't lint it, the view-boundary projection check can't run on it, and the substitution layer becomes responsible for RDF-term escaping that SPARQL already does natively. Once a template is non-parseable, every downstream consumer that expects valid SPARQL has to special-case templates or skip checks for them.

SPARQL 1.1 already provides a structural mechanism for "compute this query against a set of supplied bindings": the `VALUES` clause. A query body that references `?country` and `?year` becomes a templated query by declaring `country` and `year` as parameters; at run time the executor prepends `VALUES (?country ?year) { (v1 v2) }` (or multiple rows for multi-cardinality parameters) to the body. The body itself is always a valid SPARQL string. RDF-term escaping is the engine's job, not ours.

This ADR captures the substitution model and the locus of substitution.

## Decision

- **Templates use SPARQL-native parameter substitution via `VALUES` injection.** No text-level placeholder syntax exists. A template body is always a valid SPARQL string; parameters appear as `?name` variables exactly as in any SELECT/CONSTRUCT.
- **Parameters are declared explicitly in the entry's `parameters:` list.** Each **Parameter declaration** carries:
  - `name` — the SPARQL variable name (without `?`).
  - `type` — one of a closed, curated set of convenience types: `iri`, `string`, `integer`, `decimal`, `boolean`, `date`, `dateTime`, `langString`. An open escape hatch exists as `literal` with a free-form `datatype:` IRI for the long-tail xsd types.
  - `cardinality` — one of `0..1`, `1..1`, `0..n`, `1..n`. The lower bound replaces a separate `required` flag; the upper bound determines single-row vs multi-row `VALUES`.
  - Form-presentation fields: `label`, `description`, `default`, `enum`.
- **Load-time lint enforces declaration/body agreement.** Every declared parameter name must appear as `?name` in the body. Every body variable not in a projection and not introduced by the WHERE patterns should be declared. Mismatches surface at sidecar-load time, not at run time.
- **Substitution is client-side.** The webapp composes the final SPARQL string (prepends the `VALUES` clause, escapes per RDF-term type from the declarations) and posts it to the existing `/api/sparql` route. The server learns nothing new — it sees substituted SPARQL like any other request.
- **The substitution algorithm lives in a shared module** at `libs/common/src/lib/templates/` (or named analogously), exporting `substitute(template, bindings): Result<string, SubstitutionError>` as a pure function. `libs/common` is the only library `apps/web` and the server/CLI can both reach — `apps/web` cannot import from `libs/core` — so substitution must live there. The webapp imports it for browser-side substitution at run time; `libs/core/saved-queries/` imports it for parameter-declaration parsing and the load-time `declarations ⇔ body` lint.
- **Omitted optional parameters drop their column from `VALUES` entirely.** If every parameter is omitted or no parameters are declared, no `VALUES` clause is prepended at all — the body runs as a plain SPARQL query.
- **`UNDEF` rows are not used.** SPARQL 1.1's `VALUES … UNDEF` semantics interact subtly with `OPTIONAL` and joins; users who want "any value matches this position" express it by writing the pattern that way, not by leaving a typed parameter blank with `UNDEF`-on-the-wire.

## Considered options

- **Mustache-style text placeholders (`{{var}}`).** Rejected.
  - The template body is *not a valid SPARQL string*. Every existing consumer that expects valid SPARQL (YASQE, `detectQueryType`, the view-boundary projection check, `parseQuery` boundaries) either has to special-case templates or skip the check. The maintenance surface for "valid for everything except templates" is large and grows with every new SPARQL-aware feature.
  - String substitution requires the substitution layer to escape every RDF-term type correctly. An IRI containing `>` or a literal containing `"` breaks out of the syntactic position the placeholder occupied. Mitigation would re-implement the escaping SPARQL already does natively in `VALUES`.
  - "Templatize a predicate IRI inline" — the main thing text placeholders can do that `VALUES` can't — is rarer in real templated-SPARQL corpora than the simplicity argument suggests. When it does come up, the SPARQL-native workaround (`?pred` variable + `VALUES`) handles it readably.
- **Hybrid (SPARQL-native default with an opt-in `kind: 'raw'` for text-spliced parameters).** Rejected for v1. The escape hatch becomes the default path the moment it exists ("I'll just use `raw` and skip declaring a type"). Keeping the discipline tight matters more than the long-tail expressivity gain. If a real templatize-the-predicate use case materializes, the hybrid can be added later with the type-system constraints learned from v1.
- **Sniffed parameters (every `?var` is a candidate parameter unless used as an output projection).** Rejected. SPARQL doesn't naturally distinguish "input variable" from "output variable" — both come out of `?` syntax. Sniffing requires a heuristic ("appears in SELECT = output, doesn't = input") or a marker comment. Either way, no `type`, no `cardinality`, no `label`, no `default`, no `enum` survives — meaning the *form* (the user-visible payoff of templating) degrades to a string box per variable. Explicit declarations cost the author a tiny up-front diligence and pay every form render forever.
- **Server-side substitution via a new `/api/saved-queries/:id/run` endpoint.** Rejected. The existing `/api/sparql` route already accepts arbitrary SPARQL from the browser, so moving validation server-side does not raise the trust floor — it just adds a narrower path alongside the wide-open one. Client-side substitution keeps the algorithm in one module (no client/server divergence risk), keeps `/api/sparql`'s observability and caching paths untouched, and avoids forking a second execution route. Template-aware server-side observability ("which template was this?") is recoverable later by tagging requests with a header (`X-Sparqly-Template-Id`) on the existing route.
- **Hybrid client + server substitution (client substitutes for preview/sharing, server also runs by id-plus-bindings).** Rejected. Two execution paths with the same intent must stay behaviorally identical — the substitution algorithm gets duplicated in two languages-or-runtimes and the test surface doubles. One path, in one module, is the discipline.
- **Persisted `version:` / `required:` flag separate from cardinality.** Rejected upstream of this ADR (cardinality absorbs requiredness as its lower bound).

## Consequences

- **The template body is always a valid SPARQL string** — parseable, lintable, shape-classifiable, projection-checkable. Every existing SPARQL-aware boundary in the codebase keeps working on template bodies with no special case.
- **A new `libs/common/src/lib/templates/` module** exports:
  - The Zod schema for **Parameter declaration** (closed enum of convenience types, the four cardinalities, optional form-presentation fields).
  - The load-time lint (`declarations ⇔ body variables`).
  - The pure substitution function `substitute(template, bindings): Result<string, SubstitutionError>` — composes the `VALUES` clause, escapes values per declared type, omits columns for unbound optional parameters.
  - The binding validator (`validate(declarations, bindings): Result<Bindings, BindingError>`) — type, cardinality, lower-bound checks.
- **The webapp's `EditorFrameComponent` (extracted from the query page module per the Q4 design)** consumes the templates module for substitution and binding validation. The diff page's left and right editor instances both reuse it.
- **CLI parity is reachable without a new substitution mechanic.** A future `sparqly query --saved <slug>` (with `--bind name=value` repeats) imports the same `substitute` function. No second algorithm to specify.
- **`serve` does not learn about templates.** No `/api/saved-queries/:id/run` endpoint exists; substitution is the browser's job; `/api/sparql` sees substituted SPARQL like everything else. Template identity can be passed as an `X-Sparqly-Template-Id` header for logging/caching if and when those features are added — non-breaking, non-required.
- **The `iri`/`literal` curated convenience types are a closed registry inside `libs/core/templates`.** New convenience types are non-breaking schema additions; users who need an obscure xsd datatype use `type: 'literal', datatype: 'xsd:duration'` and get a string-input form widget for that one parameter. The mainline form-widget pipeline stays driven by the convenience set.
- **Cardinality determines substitution shape directly:** `0..1` and `1..1` produce a single-row `VALUES` (or no column if `0..1` and unbound); `0..n` and `1..n` produce a multi-row `VALUES`. The substitution branches on upper bound (`1` vs `n`); the binding validator branches on lower bound (`0` permits empty; `1` rejects empty).
- **Wire format for run-time bindings is URL-shaped:** `?savedQuery=<slug>&bind.<name>=<value>` with repeated keys for multi-cardinality parameters (ADR-0036's URL contract). The browser parses the URL, validates against declarations, builds the substituted SPARQL, and runs it.
- **CONTEXT.md additions** covering **Templated saved query**, **Parameter declaration**, **Parameter binding** are already in place (added during the design session that produced this ADR). The substitution-locus and substitution-shape rules are encoded there as the canonical definitions.
- **No `{{var}}` syntax exists at any layer.** If a future requirement makes a hybrid model worth revisiting, this ADR is the place to start that discussion — the rejection is reasoned, not absolute.
