import type { ParsedSource } from 'core';

/**
 * Layer 1 (identity & state) of the Sources page's per-row wire shape (#353,
 * parent #352). Deeper layers — quad counts, build timing, endpoint URL,
 * inline errors — extend this discriminated union without changing Layer 1.
 *
 * The discriminator is {@link SourceRow.mode}: an in-memory source carries the
 * full lazy-materialization state machine (ADR-0031); a disk-backed glob
 * carries the Glob index state machine (ADR-0041, amended by ADR-0043 for the
 * `stale` → user-triggered rebuild transition); a pass-through endpoint
 * carries no state field at all (the row is just an identity entry).
 */
export type SourceRow =
  | ({
      mode: 'in-memory';
      id: string;
      kind: 'glob' | 'file' | 'view' | 'empty';
      state: InMemoryState;
      default?: true;
      /** Split-glob children expose their meta's id for grouping on the page. */
      parentId?: string;
    } & Layer2Fields)
  | ({
      mode: 'disk-backed';
      id: string;
      kind: 'glob' | 'file';
      state: DiskBackedState;
      default?: true;
      parentId?: string;
    } & Layer2Fields)
  | {
      mode: 'endpoint';
      id: string;
      kind: 'endpoint';
      default?: true;
    };

/**
 * Layer 2 of the Sources page row shape (#355, parent #352). Materialization
 * metrics that surface only when the entry is actually materialized — state is
 * `loaded` (in-memory) or `ready` (disk-backed). Every field is optional on
 * the wire so a row that arrives without a complete metrics block (e.g. a
 * disk-backed `ready` whose pre-`quadCount`-manifest is open — see #352's
 * forward-compatibility decision) still parses cleanly. Fields are always
 * absent when state does not qualify (the projector strips them; that
 * invariant is locked by the fixture table in `source-row-projector.spec.ts`).
 */
interface Layer2Fields {
  /**
   * Quad count of the materialized store. In-memory loaded reads it from the
   * live `StoreRef`. Disk-backed `ready` carries it once the **Glob index
   * manifest** ships its `quadCount` field — until then it is `undefined`
   * (the page renders that as a blank metric cell).
   */
  quads?: number;
  /** Number of files baked into the source at materialization time. */
  files?: number;
  /** Epoch ms when the last successful load settled. */
  loadedAt?: number;
  /** Wall-clock ms the last successful load took. */
  loadMs?: number;
}

/**
 * Materialization metrics observed on a materialized entry (#355). Travel
 * with the {@link SourceRuntime} so the projector can decide — based on
 * `state` — whether to emit them onto the wire row. `quads` is optional
 * because the **Glob index manifest** does not yet carry `quadCount`
 * (separate slice of #352); the in-memory loaded path always fills it from
 * the live `StoreRef`.
 */
export interface LoadMetrics {
  quads?: number;
  files: number;
  loadedAt: number;
  loadMs: number;
}

/**
 * In-memory **Source load state** (CONTEXT.md, parent #352). `not-loaded` is
 * the post-boot resting state under lazy materialization (ADR-0031);
 * `loading` covers an in-flight first touch; `loaded` is the memoized
 * post-resolution state; `failed` is the (self-healing) error state — the
 * load slot clears so the next query touch retries (#290).
 */
export type InMemoryState = 'not-loaded' | 'loading' | 'loaded' | 'failed';

/**
 * Disk-backed **Glob index** state machine (ADR-0041, ADR-0042, ADR-0043).
 * `not-built` is the rest state with no on-disk manifest; `indexing` covers
 * the in-flight child-process build; `ready` is an opened, manifest-fresh
 * index; `stale` is an opened-but-mismatched manifest pending user-triggered
 * rebuild (ADR-0043 — the only clearing path); `failed` is a sticky error.
 */
export type DiskBackedState =
  | 'not-built'
  | 'indexing'
  | 'ready'
  | 'stale'
  | 'failed';

/**
 * Runtime state input to {@link projectSourceRow}. Discriminated by `mode` so
 * the caller (`SourcesController` reading off `EngineMap`) cannot accidentally
 * pass a disk-backed state for an in-memory source or vice versa. Pass-through
 * endpoint sources carry no state at all — that's the contract Layer 1 makes
 * visible to the page so the absence of `quads` reads as "endpoint" not
 * "problem" (#352 user story 45).
 */
export type SourceRuntime =
  | { mode: 'in-memory'; state: InMemoryState; metrics?: LoadMetrics }
  | { mode: 'disk-backed'; state: DiskBackedState; metrics?: LoadMetrics }
  | { mode: 'endpoint' };

/**
 * Pure mapping from a {@link ParsedSource} + its current {@link SourceRuntime}
 * to the Layer 1 wire row. Every (kind, state) combination is covered by the
 * fixture table in `source-row-projector.spec.ts`. Deeper layers (Layer 2-4)
 * arrive in later slices of #352 and append fields without changing the
 * discriminator.
 *
 * Reference sources are never served (CONTEXT.md, **Served registry**); the
 * caller is responsible for filtering them out, so the projector does not
 * accept them — narrowing the input keeps the per-mode shape exhaustive.
 */
export function projectSourceRow(
  source: ParsedSource,
  runtime: SourceRuntime,
): SourceRow {
  if (source.id === undefined) {
    throw new Error(
      `projectSourceRow: source of kind '${source.kind}' has no id — ` +
        `parse must have filled it in before the Sources page sees it`,
    );
  }
  const id = source.id;
  const isDefault =
    (source as { default?: true }).default === true ? true : undefined;
  const parentId =
    source.kind === 'file' ? source.parentId : undefined;
  if (runtime.mode === 'endpoint') {
    if (source.kind !== 'endpoint') {
      throw new Error(
        `projectSourceRow: endpoint runtime requires kind 'endpoint' (got '${source.kind}')`,
      );
    }
    return withOptionalDefault(
      { mode: 'endpoint', id, kind: 'endpoint' },
      isDefault,
    );
  }
  if (runtime.mode === 'disk-backed') {
    if (source.kind !== 'glob' && source.kind !== 'file') {
      throw new Error(
        `projectSourceRow: disk-backed runtime requires kind 'glob' or 'file' (got '${source.kind}')`,
      );
    }
    const row: SourceRow = {
      mode: 'disk-backed',
      id,
      kind: source.kind,
      state: runtime.state,
    };
    if (parentId !== undefined) row.parentId = parentId;
    if (runtime.state === 'ready') applyLayer2(row, runtime.metrics);
    return withOptionalDefault(row, isDefault);
  }
  if (
    source.kind !== 'glob' &&
    source.kind !== 'file' &&
    source.kind !== 'view' &&
    source.kind !== 'empty'
  ) {
    throw new Error(
      `projectSourceRow: in-memory runtime rejects kind '${source.kind}'`,
    );
  }
  const row: SourceRow = {
    mode: 'in-memory',
    id,
    kind: source.kind,
    state: runtime.state,
  };
  if (parentId !== undefined) row.parentId = parentId;
  if (runtime.state === 'loaded') applyLayer2(row, runtime.metrics);
  return withOptionalDefault(row, isDefault);
}

/**
 * Copies Layer 2 metric fields onto an in-memory or disk-backed row when the
 * caller has already checked that the state qualifies (`loaded` / `ready`).
 * Keeps absent fields absent — `quads` is genuinely optional (no
 * `quadCount` in the **Glob index manifest** yet, #352), and the projector
 * never substitutes a fallback value: a missing metric reads as "we don't
 * know" on the page, not as "zero".
 */
function applyLayer2(
  row: SourceRow & Layer2Fields,
  metrics: LoadMetrics | undefined,
): void {
  if (metrics === undefined) return;
  if (metrics.quads !== undefined) row.quads = metrics.quads;
  row.files = metrics.files;
  row.loadedAt = metrics.loadedAt;
  row.loadMs = metrics.loadMs;
}

function withOptionalDefault(row: SourceRow, isDefault: true | undefined): SourceRow {
  if (isDefault === true) {
    return { ...row, default: true } as SourceRow;
  }
  return row;
}
