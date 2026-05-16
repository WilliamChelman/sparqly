---
status: accepted
---

# Webapp visual primitives: attribute components, flat per-primitive modules

## Context

Tailwind class strings duplicate across the webapp. The Run-button shape (`rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground shadow-sm transition-colors hover:bg-accent-strong disabled:opacity-50`) appears verbatim in `apps/web/src/app/pages/query/query.page.ts`, `pages/diff/diff.page.ts`, and `pages/describe/describe.page.ts`. The bordered-secondary shape (`rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-foreground hover:border-foreground-faint`) appears in 5+ call-sites across `modules/sources-picker/` and `modules/multi-sources-picker/`. Header nav pills repeat 3×. Inconsistencies have already crept in (gap, padding, transition subtleties drift between copies).

Introduce a webapp design-system layer of reusable visual primitives, starting with one button primitive plus an icons module. Subsequent thematic chunks (error-banner, eyebrow, code-chip, surface-card) ship as follow-up PRs, each its own ADR-worthy decision only if its shape deviates from the precedent this ADR sets.

## Decision

### Button primitive

The button is an **attribute component**: `selector: 'button[app-btn], a[app-btn]'`. The host element stays a native `<button>` or `<a>` — `type`, `disabled`, `form`, `formaction`, `routerLink`, `aria-*` forward without re-exposure.

Inputs: `variant: 'primary' | 'secondary' | 'accent' | 'pill' | 'ghost'`, `size: 'sm' | 'md'` (default `'md'`), `loading: boolean`.

Behaviour:

- Named slots `iconStart` and `iconEnd` project SVG/icon components via `<ng-content select="[iconStart]" />` / `[iconEnd]`. The component owns flex+gap layout and wraps slots in size-aware spans (sm → 14px, md → 16px).
- `[loading]="true"` sets host `disabled`, sets `aria-busy="true"`, and **replaces the `iconStart` slot with `IconSpinnerComponent`** if `iconStart` was projected; otherwise prepends a spinner before the label. The label stays at full opacity — width stays roughly stable, the button's purpose stays readable to assistive tech.
- A pure-function sibling `button.classes.ts` exports `getButtonClasses(variant, size, loading?): string`. The variant×size matrix is golden-tested in `button.classes.spec.ts`; `button.component.spec.ts` covers behaviour (slot projection, loading swap, aria-busy, disabled coupling).
- `tailwind-merge` composes the variant classes with any call-site `class="…"` overrides so consumers can override predictably (`routerLinkActive` set classes on header nav included).

The 5-variant taxonomy maps every existing button call-site:

| Variant | Today's call-sites |
|---|---|
| `primary` | Run Diff, Run Describe, Run Query |
| `secondary` | refs-refresh, refs-clear, overlay-cancel, multi-sources select-all, overlay-clear-search |
| `accent` | overlay-apply (only one call-site; kept as a separate variant because the rounded-md vs rounded-full distinction is deliberate — modal affirmative is visually distinct from page-primary) |
| `pill` | header nav (Playground/Diff/Describe); transparent → filled via `routerLinkActive` |
| `ghost` | copy-iri, theme-toggle modes, multi-sources group-toggle |

### Placement: flat per-primitive modules

The button lives at `apps/web/src/app/modules/button/`. Each future primitive lives at its own sibling `modules/<primitive>/`. Rejected:

- **`modules/ui/`** as a single primitives module — names by *category*, not *unit*. ADR-0013 explicitly rejected `shared/` as a dumping-ground anti-pattern; `ui/` would reproduce it.
- **`modules/primitives/<primitive>/`** two-level grouping — solves a problem we don't have yet. If the count crosses ~8 sibling primitives, a follow-up ADR can introduce the grouping folder.

### Mechanism: attribute component over alternatives

Considered and rejected:

- **Attribute directive (`[appBtn]`)**. Can't host a template, so loading state and icon slots become awkward (host bindings alone can't project content). The user explicitly asked for these features.
- **Element component (`<app-btn>`)**. Loses native semantics — would re-expose `type`, `form`, `formaction`, `aria-*`, `routerLink`, etc. as inputs. The header's `<a routerLink>` link-styled buttons would not benefit.
- **CSS-only (`@layer components { .btn { @apply … } }`)**. No type safety on variant names; typos are silent. Adding loading-state logic would require Angular code anyway, defeating the simplicity.

### Icons module

A separate **`apps/web/src/app/modules/icons/`** module. Unlike the button module (a unit), this module is a *collection* — every file in it is the same kind. Convention:

- Selector `app-icon-<name>` (e.g. `<app-icon-spinner class="h-4 w-4" />`).
- SVGs default to `width: 1em; height: 1em; fill: currentColor` so size and color follow the consuming text context; consumers override via Tailwind on the host element.
- Files sit **flat at the module root** (`modules/icons/icon-spinner.component.ts`), not under `modules/icons/components/`. Minor deviation from ADR-0013's multi-component-module convention, justified because there is no entry-vs-internals distinction within a collection.

PR-1 ships only `IconSpinnerComponent`. Existing inline SVGs in `modules/header/components/theme-toggle.component.ts` (sun/moon/system glyphs) and `modules/describe-link/copy-iri.component.ts` (copy/check glyphs) migrate in a follow-up PR — they are not blockers for the button primitive.

### Picker-trigger styling is deliberately NOT a button variant

The "picker trigger" shape (`rounded-lg border + chevron + active:translate-y` in `modules/sources-picker/sources-picker.component.ts` and `modules/multi-sources-picker/multi-sources-picker.component.ts`) carries an interaction *contract* — opens an overlay, displays current selection, has a chevron, may show a clear-X — not just styling. Folding it into `variant="picker"` would either pollute the button API with chevron/state-display logic no other variant uses, or push that logic into every call-site. It stays raw Tailwind for now; a future `modules/picker-trigger/` (or absorption into the picker module itself) handles it as its own decision.

## Migration

PR-1 ships the primitive + icons module + all ~15 button migrations together. This validates the 5-variant taxonomy by forcing every variant to be exercised at least once. If a variant turns out not to fit a call-site cleanly, the same PR widens the API or drops the variant — no follow-up needed.

## Consequences

- **`tailwind-merge` becomes a webapp dependency**. ~5kb. Used inside the button component to compose host classes with call-site overrides; available for future primitives without re-justifying.
- **Every existing button call-site changes** in PR-1: ~15 sites lose their inline Tailwind soup and gain `<button app-btn variant="…">`. Pages and modules under `pages/` and `modules/` are touched.
- **No CONTEXT.md change**. The webapp design-system layer is implementation structure, not domain language. CONTEXT.md stays a glossary.
- **Future primitives follow this precedent without a new ADR** unless their shape deviates — e.g. an error-banner that wants element-component shape rather than attribute-component shape would re-open the decision.
