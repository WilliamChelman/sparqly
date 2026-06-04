# Webapp document title strategy

Every webapp page sets a `value — Page — sparqly` document title (collapsing to `Page — sparqly` when there is no value), where `Page` is the nav-label name and `value` is the page's most identifying per-instance state. We wire this **per component** — each page injects Angular's `Title` service and recomputes the title inside an `effect()` via a shared `pageTitle(value, page)` helper — rather than using Angular's idiomatic `TitleStrategy` + route `title`, because our titles are signal-reactive (the Playground title changes as you type, Describe's seed comes from a query param, Diff's sources from pickers), and `TitleStrategy` only fires on navigation. `index.html` keeps a static `sparqly` as the pre-bootstrap fallback.

## Considered options

- **`TitleStrategy` + route `title`** (the framework default): centralizes the ` — sparqly` suffix and handles static titles cleanly, but it re-runs on navigation and cannot react to in-page signal changes — it would fight the components' reactive titles and leave a split-brain (two sources of truth).
- **Route resolvers**: clean for URL-derived titles (slug, describe seed) but cannot react after activation, so the Playground snippet would never update as you type. Disqualified.
- **Per-component reactive (chosen)**: one uniform mechanism everywhere, fully reactive, at the cost of decentralization and deviating from the framework convention.

## Per-page values

- **Playground** (`/`): `{source id, + @ref when pinned} · {first ~40 chars of the query body}` — the body has its leading `PREFIX`/`BASE` declarations, comments, and blank lines stripped and whitespace collapsed before truncation.
- **Diff** (`/diff`): `{left token} → {right token}` (sources only), collapsed to a single token when both sides resolve to the same id+ref — mirroring the describe-this affordance precedent in `CONTEXT.md`.
- **Describe** (`/describe`): the seed rendered through the existing `curieOrIri` util (curie, else `<IRI>`); `Describe` alone before a seed is entered.
- **Queries** (`/queries…`): the `slug` when one is loaded or loading (known from the URL, so no loading flicker); `New query` for `/queries/new`; `Not found` for an unknown slug; `Queries` for the list.
- **Sources** (`/sources`): static `Sources`.

## Consequences

- Adding a new page means adding a `Title` injection + `effect()` + `pageTitle(...)` call; there is no central registry to update, and no route-data title to keep in sync.
- The Playground title tracks the live editor buffer, so it updates on every keystroke (debounced only by Angular's effect scheduling); it deliberately does not surface the loaded saved-query `slug`, since the source + body snippet identify the tab more faithfully once a draft is edited.
