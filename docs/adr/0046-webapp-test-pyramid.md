---
status: accepted
---

# Webapp test pyramid: Web e2e + DOM-free specs, no component-shaped specs

## Context

The webapp under `apps/web/src` accumulated 71 spec files (~15.8k LOC,
967 tests) covering presentational components, page-level integration
flows, and pure functions in roughly equal measure. Three patterns came
to dominate, and the first two pay no rent:

- **Template-mirror specs.** Each presentational component — the
  per-icon `IconDisclosureComponent`, `IconCheckComponent`, etc., and
  small modules like `EyebrowComponent`, `CodeChipComponent` — carries
  a spec asserting what its template already says (an SVG renders, a
  `rotate-90` class toggles on an `expanded` input). If the template
  changes, the spec breaks; if the template silently breaks, the spec
  still passes for the wrong reasons.
- **Golden class-string snapshots.** `button.component.spec.ts`
  inline-snapshots every Tailwind class string across the
  variant × size matrix. The snapshot encodes the implementation, not
  the visual contract; any class reshuffle is a "test failure" with
  no real-world consequence.
- **Page-level component specs with deep DOM scaffolding.**
  `sources.page.spec.ts` (1777 LOC), `queries.page.spec.ts` (1698),
  and `describe.page.spec.ts` (1041) wire fake SSE streams, fake
  HTTP, and routing harnesses, then drive the rendered DOM by
  `data-testid` chains. They duplicate the work a real browser does
  while running in a synthetic environment that can mask real-world
  race conditions.

The third pattern is the proximate cause of `data-testid` attributes
proliferating across production HTML — 74 files in `apps/web/src`
carry them, and many ship to users. The cli already has an end-to-end
suite under `apps/cli-e2e`, but the webapp has none: unit/component
specs were the only safety net, which made each spec feel
non-negotiable even when it provided no real coverage.

## Decision

Webapp test layers are **exclusive and exhaustive** — every behavior
worth covering lives in exactly one of three layers, named in
`CONTEXT.md`:

1. **Pure-function unit specs.** Continue covering extracted
   algorithmic logic: `sparql-result-decoder`, `query-detection`,
   `csv-exporter`, `select-spo-reifier`, etc. No change.
2. **DOM-free specs.** The canonical home for non-trivial derived
   state — services, signal-only classes, and pure functions
   extracted out of a page or component. May use `TestBed`,
   dependency injection, and `HttpTestingController`. **Must not**
   call `fixture.detectChanges()`, instantiate a component fixture,
   query the rendered DOM, or assert on rendered HTML, classes, or
   attributes.
3. **Web e2e.** Playwright, under `apps/web-e2e`, driving a real
   browser against a real `serve` booted on a fixture project config.
   Coverage scope: **happy path per user-visible feature** — load
   each page, run one query, run one diff, open one describe, save
   and rerun one saved query, load and reload one source. Selectors
   default to **accessible queries** (role, accessible name, label,
   visible text); `data-testid` is the **Test escape hatch**,
   allowed only when no accessible selector can disambiguate the
   target, and each surviving use is reviewed against fixing the
   markup first.

Component-shaped specs that render a fixture and assert on the DOM
are **not a layer**. They collapse into Web e2e.

Migration runs in three sequenced PRs to keep coverage from dipping
below the existing bar:

- **PR-1**: delete the template-mirror specs (icons, presentational
  modules) and the button class-string snapshot. No production code
  changes. These specs caught no bugs because they re-encoded the
  template.
- **PR-2**: scaffold `apps/web-e2e` with Playwright, the fixture
  config, and the first happy-path tests (each page loads + primary
  widget visible). Add a CI target.
- **PR-3 onwards, per page**: extract derived logic from the page
  into a service or pure function with a DOM-free spec, expand Web
  e2e for that page's happy path, then delete the page spec. Pages
  in order: sources → queries → describe → diff → query.

## Considered options

- **Keep page specs, rewrite to accessible queries.** Rejected. Still
  ~1700-line files exercising the rendered DOM in a synthetic
  environment; the `data-testid` proliferation goes away but the
  template-mirror cost and the false-confidence-from-jsdom cost stay.
  Maximum migration cost, marginal real gain.
- **Mocked HTTP/SSE layer for Web e2e (MSW or Playwright route
  interception).** Rejected. We have no contract test today; a single
  mock layer would mean the only e2e proves the mocks work rather
  than proving the app works. Real `serve` against the existing
  fixture config is the only path that lets the SSE fake in
  `sources.page.spec.ts` go away rather than relocating it.
- **Cypress instead of Playwright.** Rejected. Cypress's in-browser
  same-origin execution model fights the **Sources page**'s SSE
  stream; Playwright's network-event APIs and `expect.poll` handle
  live streams cleanly.
- **Keep `data-testid` everywhere, just move consumers from unit
  specs to Web e2e.** Rejected. Does not address the markup-tax
  complaint that motivated this work; production HTML continues to
  ship test-only attributes.
- **Strip `data-testid` from production builds via a build plugin.**
  Rejected. Hides the smell instead of removing it, keeps the dev
  markup tax, and does not drive accessibility improvements.
- **Big-bang single PR.** Rejected. Long-lived branch, scary diff,
  and a long window in which coverage is mid-migration.
- **Build Web e2e first, finish it, then start deleting.** Rejected
  as the *default* sequence: it delays every visible win for the
  weeks Web e2e takes to land. The PR-1 deletions are safe to ship
  immediately because the specs being deleted re-encoded the
  template — they caught no bugs an IDE would not catch.

## Consequences

- Presentational components (icons, eyebrow, code-chip, error-banner
  visuals, etc.) ship with **no specs**. A future reader who expects
  one will find the answer in `CONTEXT.md` under **DOM-free spec** and
  this ADR.
- `apps/web-e2e` becomes a CI target alongside `apps/cli-e2e`. The
  unqualified `pnpm run e2e` continues to mean the cli lane; the new
  lane is **Web e2e** (CONTEXT.md). Both lanes are independent
  processes with independent fixtures.
- The Web e2e suite boots a real `serve` per test run, which adds CI
  cost and introduces real-network timing into the test loop. This is
  the price of catching wiring regressions that mock-based e2e would
  not — the layer's purpose is realism.
- Default selectors becoming accessibility-first turns one of the
  webapp's weakest surfaces (a11y) into a tested-by-default property.
  Buttons need `aria-label`s, form controls need real `<label>`s, and
  headings need correct levels — otherwise Web e2e can't find them
  without falling back to the escape hatch.
- The rule "any `fixture.detectChanges()` or `nativeElement` access in
  a unit spec is the wrong layer" is mechanically checkable and could
  be enforced by a lint rule in a follow-up.
- Reverting this ADR is expensive once page specs are deleted —
  re-deriving the synthetic-DOM scaffolding is non-trivial. The
  three-PR migration is structured so each step is independently
  reversible until the corresponding page spec is removed.
