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
    } & Layer2Fields &
      Layer3Fields)
  | ({
      mode: 'endpoint';
      id: string;
      kind: 'endpoint';
      default?: true;
    } & Layer4Fields);

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
 * Layer 3 disk-backed extras on the Sources page row (#357). Disk-backed
 * **Glob index** entries surface where the index lives, how much disk it
 * occupies, and which sparqly version baked it; a `stale` entry additionally
 * carries a human-readable mismatch reason. Every field is optional on the
 * wire — a pre-`ready` row (e.g. `not-built`, `indexing`) has nothing to
 * report yet; `manifestSparqlyVersion` is absent when no manifest has ever
 * been written; `staleReason` appears exactly when `state === 'stale'`.
 */
interface Layer3Fields {
  /** Absolute path of the on-disk index directory. */
  indexDir?: string;
  /** Total bytes occupied by the LevelDB index on disk. */
  indexBytes?: number;
  /** The sparqly version recorded in the index's manifest. */
  manifestSparqlyVersion?: string;
  /**
   * Human-readable mismatch reason ("sparqly version changed: 0.28.0 → 0.29.0",
   * "matched file changed: /data/a.nq", …). Populated exactly when
   * `state === 'stale'`; never appears on any other disk-backed state, even
   * if the runtime supplied one.
   */
  staleReason?: string;
}

/**
 * Layer 4 endpoint extras on the Sources page row (#359). **Endpoint source**
 * entries surface the endpoint URL the row points at, so the operator can
 * identify a row at a glance without round-tripping through `/api/config`.
 * The field is unconditional on endpoint rows (every endpoint declaration
 * has a URL — there is no "unknown" branch) and the discriminated union
 * forbids it on any other mode.
 */
interface Layer4Fields {
  /** Absolute URL of the remote SPARQL endpoint declared by the source. */
  endpointUrl?: string;
}

/**
 * Layer 3 disk extras supplied alongside a disk-backed {@link SourceRuntime}
 * (#357). The projector copies these onto the row, gating `staleReason` on
 * `state === 'stale'`. Sourced by `projectEntryState`: `indexDir` from the
 * **Glob index** layout helper, `indexBytes` from a walk of the index db
 * directory, `manifestSparqlyVersion` from the read manifest, and
 * `staleReason` from `compareGlobIndexManifests`.
 */
export interface DiskExtras {
  indexDir?: string;
  indexBytes?: number;
  manifestSparqlyVersion?: string;
  staleReason?: string;
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
  | {
      mode: 'disk-backed';
      state: DiskBackedState;
      metrics?: LoadMetrics;
      /** Layer 3 extras for the **Sources page** (#357). */
      disk?: DiskExtras;
    }
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
    // Layer 4 (#359): the endpoint URL rides on every endpoint row — there
    // is no "unknown" branch for it (a parsed endpoint source by definition
    // has an `endpoint` URL). The Sources page chip uses it as the row's
    // identifying detail next to the @id.
    return withOptionalDefault(
      {
        mode: 'endpoint',
        id,
        kind: 'endpoint',
        endpointUrl: source.endpoint,
      },
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
    applyLayer3(row, runtime.state, runtime.disk);
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

/**
 * Copies Layer 3 disk-backed extras onto a disk-backed row (#357). `indexDir`,
 * `indexBytes`, and `manifestSparqlyVersion` ride along whenever the runtime
 * supplied them — the page renders blank cells for absent values. `staleReason`
 * is the one field gated on state: it appears exactly when `state === 'stale'`
 * so the wire shape can never lie about the state machine (a stray reason on a
 * `ready` row would be a Sources-page bug, not a "harmless extra field").
 */
function applyLayer3(
  row: SourceRow & Layer3Fields,
  state: DiskBackedState,
  extras: DiskExtras | undefined,
): void {
  if (extras === undefined) return;
  if (extras.indexDir !== undefined) row.indexDir = extras.indexDir;
  if (extras.indexBytes !== undefined) row.indexBytes = extras.indexBytes;
  if (extras.manifestSparqlyVersion !== undefined) {
    row.manifestSparqlyVersion = extras.manifestSparqlyVersion;
  }
  if (state === 'stale' && extras.staleReason !== undefined) {
    row.staleReason = extras.staleReason;
  }
}

function withOptionalDefault(row: SourceRow, isDefault: true | undefined): SourceRow {
  if (isDefault === true) {
    return { ...row, default: true } as SourceRow;
  }
  return row;
}
