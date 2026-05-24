import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { describe, expect, it } from 'vitest';
import { SourcesPage, type SourceRow } from './sources.page';
import {
  SOURCE_STATE_STREAM_FACTORY,
  type SourceStateStream,
  type SourceStateStreamFactory,
  type SourceStateStreamHandlers,
} from './source-state-stream';

const LOADED_AT = 1_700_000_000_000;
const SNAPSHOT: SourceRow[] = [
  { mode: 'in-memory', id: 'docs', kind: 'glob', state: 'not-loaded' },
  {
    mode: 'in-memory',
    id: 'projects',
    kind: 'glob',
    state: 'loaded',
    default: true,
    quads: 42,
    files: 3,
    loadedAt: LOADED_AT,
    loadMs: 17,
  },
  {
    mode: 'disk-backed',
    id: 'big',
    kind: 'glob',
    state: 'ready',
    files: 12,
    loadedAt: LOADED_AT,
    loadMs: 90,
  },
  {
    mode: 'endpoint',
    id: 'wikidata',
    kind: 'endpoint',
    // Layer 4 (#359): the endpoint URL rides on the row so the page chip
    // can render which remote the row points at.
    endpointUrl: 'https://query.wikidata.org/sparql',
  },
];

/**
 * Test-side `SourceStateStreamFactory` — captures the handlers passed by the
 * page and exposes `emitRow`/`emitRefetchSnapshot` so the test can drive
 * live updates without a real `EventSource`. `closed` flips true when the
 * page calls `close()`, which the lifecycle tests assert.
 */
interface FakeStream {
  factory: SourceStateStreamFactory;
  emitRow: (row: SourceRow) => void;
  emitRefetchSnapshot: () => void;
  closed: () => boolean;
  openCount: () => number;
}

function createFakeStream(): FakeStream {
  let handlers: SourceStateStreamHandlers | undefined;
  let closed = false;
  let openCount = 0;
  const factory: SourceStateStreamFactory = {
    open(h): SourceStateStream {
      handlers = h;
      openCount += 1;
      closed = false;
      return {
        close: () => {
          closed = true;
          handlers = undefined;
        },
      };
    },
  };
  return {
    factory,
    emitRow: (row) => handlers?.onRow(row),
    emitRefetchSnapshot: () => handlers?.onRefetchSnapshot(),
    closed: () => closed,
    openCount: () => openCount,
  };
}

async function setup(
  initialUrl = '/sources',
  options: { stream?: FakeStream } = {},
) {
  // jsdom has no native `EventSource`; tests that don't care about the SSE
  // path get a no-op factory so subscribing is silent. Tests that do drive
  // live updates pass their own fake.
  const stream = options.stream ?? createFakeStream();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'sources', component: SourcesPage }]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SOURCE_STATE_STREAM_FACTORY, useValue: stream.factory },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(initialUrl, SourcesPage);
  const http = TestBed.inject(HttpTestingController);
  return {
    harness,
    http,
    stream,
    nativeElement: () => harness.routeNativeElement as HTMLElement,
    detect: () => harness.detectChanges(),
    stable: () => harness.fixture.whenStable(),
  };
}

function flushSources(http: HttpTestingController, rows = SNAPSHOT): void {
  const req = http.expectOne('/api/sources');
  expect(req.request.method).toBe('GET');
  req.flush(rows);
}

function flushConfig(
  http: HttpTestingController,
  opts: { allowAdminActions?: boolean } = {},
): void {
  const req = http.expectOne('/api/config');
  expect(req.request.method).toBe('GET');
  req.flush({
    sources: [],
    context: { prefixes: {} },
    describe: {
      perSourceSoftLimit: 0,
      perSourceHardLimit: 0,
      fromSourcePredicate: '',
    },
    sourcesAdmin: { allowAdminActions: opts.allowAdminActions ?? true },
  });
}

/**
 * Initial-load helper — flushes both the snapshot and the config boot fetch.
 * The refetch-snapshot path re-issues only `/api/sources`, so that test
 * calls `flushSources` directly on the second turn.
 */
function flush(
  http: HttpTestingController,
  rows = SNAPSHOT,
  opts: { allowAdminActions?: boolean } = {},
): void {
  flushSources(http, rows);
  flushConfig(http, opts);
}

// Card root carries `data-testid="source-row-<id>"`; the id is derived from
// that single attribute rather than a parallel `data-source-id`.
function renderedRowIds(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('[data-testid^="source-row-"]')).map(
    (el) => el.getAttribute('data-testid')!.slice('source-row-'.length),
  );
}

// Find a metric value by its visible <dt> label inside a card.
function metricValue(row: Element | null | undefined, label: string): string {
  if (!row) return '';
  const dt = Array.from(row.querySelectorAll('dt')).find(
    (el) => el.textContent?.trim() === label,
  );
  return dt?.nextElementSibling?.textContent?.trim() ?? '';
}

// Find a button by its visible label inside a card (action + error-details).
function buttonByText(
  row: Element | null | undefined,
  label: string,
): HTMLButtonElement | null {
  if (!row) return null;
  return (
    Array.from(row.querySelectorAll('button')).find(
      (el) => el.textContent?.trim() === label,
    ) ?? null
  );
}

// The disclosure toggle is the row's only `aria-expanded` button.
function disclosureToggle(
  row: Element | null | undefined,
): HTMLButtonElement | null {
  return row?.querySelector<HTMLButtonElement>('button[aria-expanded]') ?? null;
}

describe('SourcesPage (#353)', () => {
  it('fetches the GET /api/sources snapshot on init', async () => {
    const ctx = await setup();
    flush(ctx.http);
    ctx.detect();
    await ctx.stable();
    ctx.http.verify();
  });

  it('renders a row per snapshot entry with id, kind, and current state', async () => {
    const ctx = await setup();
    flush(ctx.http);
    ctx.detect();
    await ctx.stable();
    ctx.detect();

    expect(renderedRowIds(ctx.nativeElement())).toEqual([
      'docs',
      'projects',
      'big',
      'wikidata',
    ]);
    const projectsRow = ctx.nativeElement().querySelector(
      '[data-testid="source-row-projects"]',
    );
    expect(
      projectsRow?.querySelector('[data-testid="row-kind"]')?.textContent,
    ).toContain('glob');
    expect(
      projectsRow?.querySelector('[data-testid="row-state"]')?.textContent,
    ).toContain('loaded');
  });

  it('renders pass-through endpoint rows without a state chip', async () => {
    const ctx = await setup();
    flush(ctx.http);
    ctx.detect();
    await ctx.stable();
    ctx.detect();

    const endpointRow = ctx.nativeElement().querySelector(
      '[data-testid="source-row-wikidata"]',
    );
    expect(endpointRow).not.toBeNull();
    expect(
      endpointRow?.querySelector('[data-testid="row-state"]'),
    ).toBeNull();
  });

  it('marks the Default source row with a default flag', async () => {
    const ctx = await setup();
    flush(ctx.http);
    ctx.detect();
    await ctx.stable();
    ctx.detect();

    const defaultRow = ctx.nativeElement().querySelector(
      '[data-testid="source-row-projects"]',
    );
    expect(defaultRow?.querySelector('[title="default"]')).not.toBeNull();
    const nonDefault = ctx.nativeElement().querySelector(
      '[data-testid="source-row-docs"]',
    );
    expect(nonDefault?.querySelector('[title="default"]')).toBeNull();
  });

  it('applies a row event from the live stream by replacing the matching row in-place', async () => {
    // The page opens an SSE subscription after the snapshot lands; a live
    // `row` event for an existing id swaps that row blind (ADR-0044, #354).
    const stream = createFakeStream();
    const ctx = await setup('/sources', { stream });
    flush(ctx.http);
    ctx.detect();
    await ctx.stable();
    ctx.detect();

    stream.emitRow({
      mode: 'in-memory',
      id: 'docs',
      kind: 'glob',
      state: 'loading',
    });
    ctx.detect();
    await ctx.stable();
    ctx.detect();

    const docsRow = ctx.nativeElement().querySelector(
      '[data-testid="source-row-docs"]',
    );
    expect(
      docsRow?.querySelector('[data-testid="row-state"]')?.textContent,
    ).toContain('loading');
    // Other rows are untouched.
    const projectsRow = ctx.nativeElement().querySelector(
      '[data-testid="source-row-projects"]',
    );
    expect(
      projectsRow?.querySelector('[data-testid="row-state"]')?.textContent,
    ).toContain('loaded');
  });

  it('on `refetch-snapshot` sentinel, re-fetches /api/sources and re-subscribes (ADR-0044)', async () => {
    // Unbridgeable reconnect — the server-side ring evicted past our cursor.
    // The page closes the old stream, re-fetches the canonical snapshot,
    // and opens a fresh stream so future live updates resume.
    const stream = createFakeStream();
    const ctx = await setup('/sources', { stream });
    flush(ctx.http);
    ctx.detect();
    await ctx.stable();
    ctx.detect();
    expect(stream.openCount()).toBe(1);

    stream.emitRefetchSnapshot();
    ctx.detect();
    await ctx.stable();
    // The stream from before the sentinel is closed.
    expect(stream.closed()).toBe(true);

    // The page re-issues GET /api/sources with the fresh state of the world.
    // Config is not re-fetched on the refetch path — capability is a boot
    // concern, not a per-snapshot one — so only the snapshot endpoint is
    // flushed on the second turn.
    const refetched: SourceRow[] = [
      { mode: 'in-memory', id: 'docs', kind: 'glob', state: 'loaded' },
      { mode: 'in-memory', id: 'projects', kind: 'glob', state: 'loaded' },
      { mode: 'disk-backed', id: 'big', kind: 'glob', state: 'ready' },
      { mode: 'endpoint', id: 'wikidata', kind: 'endpoint' },
    ];
    flushSources(ctx.http, refetched);
    ctx.detect();
    await ctx.stable();
    ctx.detect();

    // Snapshot replaced.
    const docsRow = ctx.nativeElement().querySelector(
      '[data-testid="source-row-docs"]',
    );
    expect(
      docsRow?.querySelector('[data-testid="row-state"]')?.textContent,
    ).toContain('loaded');

    // A second stream is open for live delivery.
    expect(stream.openCount()).toBe(2);
  });

  it('closes the live stream when the page is destroyed', async () => {
    // Navigating away tears down the page — its SSE subscription must close
    // too, otherwise a long-lived server connection leaks per visit.
    const stream = createFakeStream();
    const ctx = await setup('/sources', { stream });
    flush(ctx.http);
    ctx.detect();
    await ctx.stable();
    ctx.detect();
    expect(stream.closed()).toBe(false);

    ctx.harness.fixture.destroy();
    expect(stream.closed()).toBe(true);
  });

  it('renders Layer 2 metric cells (quads, files, loadedAt, loadMs) on a loaded in-memory row — #355', async () => {
    const ctx = await setup();
    flush(ctx.http);
    ctx.detect();
    await ctx.stable();
    ctx.detect();

    const row = ctx.nativeElement().querySelector(
      '[data-testid="source-row-projects"]',
    );
    expect(metricValue(row, 'quads')).toContain('42');
    expect(metricValue(row, 'files')).toContain('3');
    expect(metricValue(row, 'last load')).toBeTruthy();
    expect(metricValue(row, 'load ms')).toContain('17');
  });

  it('renders Layer 2 metric cells on a disk-backed ready row (quads cell blank pending the manifest slice) — #355', async () => {
    const ctx = await setup();
    flush(ctx.http);
    ctx.detect();
    await ctx.stable();
    ctx.detect();

    const row = ctx.nativeElement().querySelector(
      '[data-testid="source-row-big"]',
    );
    expect(metricValue(row, 'files')).toContain('12');
    expect(metricValue(row, 'load ms')).toContain('90');
    // `quads` is undefined for disk-backed `ready` until the manifest's
    // `quadCount` field ships in a later slice of #352 — the cell must render
    // empty rather than e.g. "0", so the operator can tell "unknown" apart
    // from "the index really has zero quads".
    expect(metricValue(row, 'quads')).toBe('');
  });

  it('leaves the metric cells blank for non-loaded / non-ready rows — #355', async () => {
    const ctx = await setup();
    flush(ctx.http);
    ctx.detect();
    await ctx.stable();
    ctx.detect();

    const row = ctx.nativeElement().querySelector(
      '[data-testid="source-row-docs"]',
    );
    for (const label of ['quads', 'files', 'last load', 'load ms']) {
      expect(metricValue(row, label)).toBe('');
    }
  });

  it('a live row event that crosses into loaded populates the metric cells — #355', async () => {
    const stream = createFakeStream();
    const ctx = await setup('/sources', { stream });
    flush(ctx.http);
    ctx.detect();
    await ctx.stable();
    ctx.detect();

    stream.emitRow({
      mode: 'in-memory',
      id: 'docs',
      kind: 'glob',
      state: 'loaded',
      quads: 99,
      files: 5,
      loadedAt: LOADED_AT,
      loadMs: 250,
    });
    ctx.detect();
    await ctx.stable();
    ctx.detect();

    const row = ctx.nativeElement().querySelector(
      '[data-testid="source-row-docs"]',
    );
    expect(metricValue(row, 'quads')).toContain('99');
    expect(metricValue(row, 'files')).toContain('5');
    expect(metricValue(row, 'load ms')).toContain('250');
  });

  it('a live row event that crosses out of loaded clears the metric cells — #355', async () => {
    const stream = createFakeStream();
    const ctx = await setup('/sources', { stream });
    flush(ctx.http);
    ctx.detect();
    await ctx.stable();
    ctx.detect();

    // `projects` came in loaded with metrics; an `unload` (later slice) or a
    // failure path drops it back to `not-loaded` with no metrics block. The
    // page must drop the metric cells back to blank — stale numbers next to
    // a `not-loaded` chip would be a worse lie than a missing one.
    stream.emitRow({
      mode: 'in-memory',
      id: 'projects',
      kind: 'glob',
      state: 'not-loaded',
    });
    ctx.detect();
    await ctx.stable();
    ctx.detect();

    const row = ctx.nativeElement().querySelector(
      '[data-testid="source-row-projects"]',
    );
    for (const label of ['quads', 'files', 'last load', 'load ms']) {
      expect(metricValue(row, label)).toBe('');
    }
  });

  describe('Layer 3 disk-backed extras (#357)', () => {
    /**
     * The Layer 3 fixture sets `quads` so the existing Layer 2 cell now has
     * a number to show, plus the on-disk extras the server now ships once
     * the manifest carries `quadCount`. The `ready` row's extras render
     * unconditionally on disk-backed rows (a blank cell still means
     * "unknown"); `stale` adds a chip + reason that no other state shows.
     */
    const SNAPSHOT_WITH_L3: SourceRow[] = [
      {
        mode: 'disk-backed',
        id: 'big',
        kind: 'glob',
        state: 'ready',
        quads: 4242,
        files: 12,
        loadedAt: LOADED_AT,
        loadMs: 90,
        indexDir: '/cfg/.sparqly/index/big',
        indexBytes: 8192,
        manifestSparqlyVersion: '0.29.0',
      },
      {
        mode: 'disk-backed',
        id: 'drifted',
        kind: 'glob',
        state: 'stale',
        indexDir: '/cfg/.sparqly/index/drifted',
        indexBytes: 4096,
        manifestSparqlyVersion: '0.29.0',
        staleReason: 'matched file changed: /data/newcomer.ttl',
      },
    ];

    it('renders Layer 3 cells (indexDir, indexBytes, manifestSparqlyVersion) and a quads number on a disk-backed ready row', async () => {
      const ctx = await setup();
      flush(ctx.http, SNAPSHOT_WITH_L3);
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const row = ctx.nativeElement().querySelector(
        '[data-testid="source-row-big"]',
      );
      expect(metricValue(row, 'quads')).toContain('4242');
      expect(metricValue(row, 'index')).toContain('/cfg/.sparqly/index/big');
      // 8192 bytes → a human-readable size, not the raw byte count.
      expect(metricValue(row, 'size')).toMatch(/8(\.0)? ?KB|8192/);
      expect(metricValue(row, 'version')).toContain('0.29.0');
    });

    it('renders a stale chip with the human-readable reason on a stale disk-backed row', async () => {
      const ctx = await setup();
      flush(ctx.http, SNAPSHOT_WITH_L3);
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const row = ctx.nativeElement().querySelector(
        '[data-testid="source-row-drifted"]',
      );
      // The state chip itself already exists (Layer 1); the new affordance is
      // a separate `row-stale-reason` element that surfaces the human-readable
      // mismatch so the operator can read *why* without opening the index.
      expect(
        row?.querySelector('[data-testid="row-state"]')?.textContent,
      ).toContain('stale');
      const reason = row?.querySelector('[data-testid="row-stale-reason"]');
      expect(reason).not.toBeNull();
      expect(reason?.textContent).toContain('newcomer.ttl');
    });

    it('omits row-stale-reason on a non-stale disk-backed row (the wire never lies about state)', async () => {
      const ctx = await setup();
      flush(ctx.http, SNAPSHOT_WITH_L3);
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const row = ctx.nativeElement().querySelector(
        '[data-testid="source-row-big"]',
      );
      expect(
        row?.querySelector('[data-testid="row-stale-reason"]'),
      ).toBeNull();
    });

    it('omits Layer 3 cells entirely on in-memory and endpoint rows', async () => {
      const ctx = await setup();
      flush(ctx.http);
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      for (const id of ['projects', 'docs', 'wikidata']) {
        const row = ctx.nativeElement().querySelector(
          `[data-testid="source-row-${id}"]`,
        );
        // The disk-backed-only metric block (index / size / version) must not
        // render on non-disk-backed rows; the staleness chip neither.
        const dtLabels = Array.from(row?.querySelectorAll('dt') ?? []).map(
          (d) => d.textContent?.trim(),
        );
        for (const label of ['index', 'size', 'version']) {
          expect(dtLabels).not.toContain(label);
        }
        expect(
          row?.querySelector('[data-testid="row-stale-reason"]'),
        ).toBeNull();
      }
    });
  });

  describe('per-row admin action menu (#356)', () => {
    it('renders a Load button on a not-loaded in-memory row when allowAdminActions is true', async () => {
      const ctx = await setup();
      flush(ctx.http, SNAPSHOT, { allowAdminActions: true });
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const docsRow = ctx.nativeElement().querySelector(
        '[data-testid="source-row-docs"]',
      );
      expect(buttonByText(docsRow, 'Load')).not.toBeNull();
    });

    it('renders a Reload button on a loaded in-memory row that POSTs /api/sources/:id/reload on click', async () => {
      const ctx = await setup();
      flush(ctx.http, SNAPSHOT, { allowAdminActions: true });
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const projectsRow = ctx.nativeElement().querySelector(
        '[data-testid="source-row-projects"]',
      );
      const reload = buttonByText(projectsRow, 'Reload');
      expect(reload).not.toBeNull();

      reload!.click();
      ctx.detect();
      await ctx.stable();

      const req = ctx.http.expectOne('/api/sources/projects/reload');
      expect(req.request.method).toBe('POST');
      req.flush({ id: 'projects', state: 'loaded' });
      ctx.http.verify();
    });

    it('renders an Unload button on a loaded in-memory row that POSTs /api/sources/:id/unload on click', async () => {
      const ctx = await setup();
      flush(ctx.http, SNAPSHOT, { allowAdminActions: true });
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const projectsRow = ctx.nativeElement().querySelector(
        '[data-testid="source-row-projects"]',
      );
      const unload = buttonByText(projectsRow, 'Unload');
      expect(unload).not.toBeNull();

      unload!.click();
      ctx.detect();
      await ctx.stable();

      const req = ctx.http.expectOne('/api/sources/projects/unload');
      expect(req.request.method).toBe('POST');
      req.flush({ id: 'projects', state: 'not-loaded' });
      ctx.http.verify();
    });

    it('hides every per-row action button when allowAdminActions is false (read-only serve)', async () => {
      // The deployment-wide capability flag is the only switch the page
      // honours — read-only `serve` must not advertise affordances the
      // server will then 403 on. The assertion sweeps the whole list and
      // confirms no `row-action-*` element exists anywhere.
      const ctx = await setup();
      flush(ctx.http, SNAPSHOT, { allowAdminActions: false });
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const adminLabels = new Set([
        'Load',
        'Reload',
        'Unload',
        'Retry',
        '(Re)build index',
        'Cancel',
        'Test connection',
        'Reload loaded children',
      ]);
      const found = Array.from(
        ctx.nativeElement().querySelectorAll('button'),
      ).filter((b) => adminLabels.has(b.textContent?.trim() ?? ''));
      expect(found).toEqual([]);
    });

    it('clicking Load on a not-loaded row POSTs /api/sources/:id/load', async () => {
      const ctx = await setup();
      flush(ctx.http, SNAPSHOT, { allowAdminActions: true });
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const docsRow = ctx.nativeElement().querySelector(
        '[data-testid="source-row-docs"]',
      );
      const load = buttonByText(docsRow, 'Load');
      load!.click();
      ctx.detect();
      await ctx.stable();

      const req = ctx.http.expectOne('/api/sources/docs/load');
      expect(req.request.method).toBe('POST');
      req.flush({ id: 'docs', state: 'loading' });
      ctx.http.verify();
    });

    it('never renders in-memory verbs (Load/Reload/Unload) on endpoint or disk-backed rows', async () => {
      // #356 is in-memory only. Pass-through endpoints have no state machine
      // and disk-backed has its own verb set ((Re)build / Cancel — #358), so
      // neither row class may render the in-memory Load/Reload/Unload verbs
      // even when the capability is on.
      const ctx = await setup();
      flush(ctx.http, SNAPSHOT, { allowAdminActions: true });
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const inMemoryVerbs = ['Load', 'Reload', 'Unload'];
      for (const id of ['wikidata', 'big']) {
        const row = ctx.nativeElement().querySelector(
          `[data-testid="source-row-${id}"]`,
        );
        for (const label of inMemoryVerbs) {
          expect(buttonByText(row, label)).toBeNull();
        }
      }
    });
  });

  describe('disk-backed (Re)build / Cancel action menu (#358)', () => {
    const DISK_SNAPSHOT: SourceRow[] = [
      // A disk-backed `ready` row — confirm-on-rebuild path; the existing
      // built-up state matters, so the click must prompt before destroying it.
      {
        mode: 'disk-backed',
        id: 'ready-big',
        kind: 'glob',
        state: 'ready',
        quads: 4242,
        files: 12,
        loadedAt: LOADED_AT,
        loadMs: 90,
        indexDir: '/cfg/.sparqly/index/ready-big',
        indexBytes: 8192,
        manifestSparqlyVersion: '0.29.0',
      },
      // A disk-backed `stale` row — also confirm-on-rebuild; the prior index
      // is still serving queries and the user might not realise rebuild
      // is the destructive path (the staleness `warn` was the gentle one).
      {
        mode: 'disk-backed',
        id: 'stale-drifted',
        kind: 'glob',
        state: 'stale',
        indexDir: '/cfg/.sparqly/index/stale-drifted',
        indexBytes: 4096,
        manifestSparqlyVersion: '0.29.0',
        staleReason: 'matched file changed: /data/x.ttl',
      },
      // A `not-built` row — no on-disk state to lose, so the confirm is
      // skipped (per the ADR-0043 "skip confirm when nothing meaningful is
      // discarded" rule).
      {
        mode: 'disk-backed',
        id: 'fresh',
        kind: 'glob',
        state: 'not-built',
        indexDir: '/cfg/.sparqly/index/fresh',
      },
      // A `failed` row — same posture as `not-built`: rebuild is the only
      // path forward, no built state to discard, so confirm is skipped.
      {
        mode: 'disk-backed',
        id: 'broken',
        kind: 'glob',
        state: 'failed',
        indexDir: '/cfg/.sparqly/index/broken',
      },
      // An in-flight build — Cancel is the only verb that should appear; the
      // (Re)build affordance hides while a build is mid-flight (issuing
      // another is a no-op anyway and adds UI confusion).
      {
        mode: 'disk-backed',
        id: 'building',
        kind: 'glob',
        state: 'indexing',
        indexDir: '/cfg/.sparqly/index/building',
      },
    ];

    it('renders a (Re)build button on every disk-backed row regardless of state — except indexing', async () => {
      const ctx = await setup();
      flush(ctx.http, DISK_SNAPSHOT, { allowAdminActions: true });
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      for (const id of ['ready-big', 'stale-drifted', 'fresh', 'broken']) {
        const row = ctx.nativeElement().querySelector(
          `[data-testid="source-row-${id}"]`,
        );
        const label = id === 'broken' ? 'Retry' : '(Re)build index';
        expect(
          buttonByText(row, label),
          `expected ${label} button on row ${id}`,
        ).not.toBeNull();
      }
      // The indexing row hides (Re)build — Cancel is the only verb during
      // an in-flight build.
      const indexing = ctx.nativeElement().querySelector(
        '[data-testid="source-row-building"]',
      );
      expect(buttonByText(indexing, '(Re)build index')).toBeNull();
    });

    it('renders a Cancel button on indexing rows only', async () => {
      const ctx = await setup();
      flush(ctx.http, DISK_SNAPSHOT, { allowAdminActions: true });
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const indexing = ctx.nativeElement().querySelector(
        '[data-testid="source-row-building"]',
      );
      expect(buttonByText(indexing, 'Cancel')).not.toBeNull();
      for (const id of ['ready-big', 'stale-drifted', 'fresh', 'broken']) {
        const row = ctx.nativeElement().querySelector(
          `[data-testid="source-row-${id}"]`,
        );
        expect(
          buttonByText(row, 'Cancel'),
          `expected no Cancel on row ${id}`,
        ).toBeNull();
      }
    });

    it('clicking (Re)build on a not-built row POSTs /api/sources/:id/index-build without a confirm prompt', async () => {
      const ctx = await setup();
      flush(ctx.http, DISK_SNAPSHOT, { allowAdminActions: true });
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      // Track confirm() calls so the test can assert it was NOT invoked.
      let confirmed = 0;
      const origConfirm = window.confirm;
      window.confirm = () => {
        confirmed += 1;
        return true;
      };
      try {
        const row = ctx.nativeElement().querySelector(
          '[data-testid="source-row-fresh"]',
        );
        const btn = buttonByText(row, '(Re)build index');
        btn!.click();
        ctx.detect();
        await ctx.stable();

        const req = ctx.http.expectOne('/api/sources/fresh/index-build');
        expect(req.request.method).toBe('POST');
        req.flush({ id: 'fresh', state: 'indexing' });
        expect(confirmed).toBe(0);
      } finally {
        window.confirm = origConfirm;
      }
    });

    it('clicking (Re)build on a ready row prompts a confirm dialog and only POSTs after the user accepts', async () => {
      const ctx = await setup();
      flush(ctx.http, DISK_SNAPSHOT, { allowAdminActions: true });
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const origConfirm = window.confirm;
      window.confirm = () => false; // user cancels the confirm
      try {
        const row = ctx.nativeElement().querySelector(
          '[data-testid="source-row-ready-big"]',
        );
        const btn = buttonByText(row, '(Re)build index');
        btn!.click();
        ctx.detect();
        await ctx.stable();
        // Confirm refused — no request is issued.
        ctx.http.expectNone('/api/sources/ready-big/index-build');

        // User accepts the second time.
        window.confirm = () => true;
        btn!.click();
        ctx.detect();
        await ctx.stable();
        const req = ctx.http.expectOne('/api/sources/ready-big/index-build');
        expect(req.request.method).toBe('POST');
        req.flush({ id: 'ready-big', state: 'indexing' });
      } finally {
        window.confirm = origConfirm;
      }
    });

    it('clicking (Re)build on a stale row also prompts a confirm — the prior index is still meaningful state', async () => {
      const ctx = await setup();
      flush(ctx.http, DISK_SNAPSHOT, { allowAdminActions: true });
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const origConfirm = window.confirm;
      let confirmCalls = 0;
      window.confirm = () => {
        confirmCalls += 1;
        return true;
      };
      try {
        const row = ctx.nativeElement().querySelector(
          '[data-testid="source-row-stale-drifted"]',
        );
        const btn = buttonByText(row, '(Re)build index');
        btn!.click();
        ctx.detect();
        await ctx.stable();
        expect(confirmCalls).toBe(1);
        const req = ctx.http.expectOne(
          '/api/sources/stale-drifted/index-build',
        );
        req.flush({ id: 'stale-drifted', state: 'indexing' });
      } finally {
        window.confirm = origConfirm;
      }
    });

    it('clicking Cancel on an indexing row DELETEs /api/sources/:id/index-build', async () => {
      const ctx = await setup();
      flush(ctx.http, DISK_SNAPSHOT, { allowAdminActions: true });
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const row = ctx.nativeElement().querySelector(
        '[data-testid="source-row-building"]',
      );
      const btn = buttonByText(row, 'Cancel');
      btn!.click();
      ctx.detect();
      await ctx.stable();

      const req = ctx.http.expectOne('/api/sources/building/index-build');
      expect(req.request.method).toBe('DELETE');
      req.flush({ id: 'building', state: 'indexing' });
    });

    it('hides (Re)build and Cancel when allowAdminActions is false (read-only serve)', async () => {
      const ctx = await setup();
      flush(ctx.http, DISK_SNAPSHOT, { allowAdminActions: false });
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const labels = new Set(['(Re)build index', 'Retry', 'Cancel']);
      const found = Array.from(
        ctx.nativeElement().querySelectorAll('button'),
      ).filter((b) => labels.has(b.textContent?.trim() ?? ''));
      expect(found).toEqual([]);
    });
  });

  describe('endpoint Test connection (#359)', () => {
    it('renders a Test connection button on endpoint rows when allowAdminActions is true', async () => {
      // PRD user story 19 + AC: the button rides on every Endpoint source
      // row when admin actions are allowed. The selector follows the
      // `row-action-<verb>` convention already established for the other
      // in-memory and disk-backed verbs.
      const ctx = await setup();
      flush(ctx.http, SNAPSHOT, { allowAdminActions: true });
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const endpointRow = ctx.nativeElement().querySelector(
        '[data-testid="source-row-wikidata"]',
      );
      expect(buttonByText(endpointRow, 'Test connection')).not.toBeNull();
    });

    it('hides the Test connection button when allowAdminActions is false (prevents endpoint hammering, PRD user story 41)', async () => {
      const ctx = await setup();
      flush(ctx.http, SNAPSHOT, { allowAdminActions: false });
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const endpointRow = ctx.nativeElement().querySelector(
        '[data-testid="source-row-wikidata"]',
      );
      expect(buttonByText(endpointRow, 'Test connection')).toBeNull();
    });

    it('never renders Test connection on non-endpoint rows', async () => {
      const ctx = await setup();
      flush(ctx.http, SNAPSHOT, { allowAdminActions: true });
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      for (const id of ['docs', 'projects', 'big']) {
        const row = ctx.nativeElement().querySelector(
          `[data-testid="source-row-${id}"]`,
        );
        expect(
          buttonByText(row, 'Test connection'),
          `expected no Test connection button on ${id}`,
        ).toBeNull();
      }
    });

    it('clicking Test connection POSTs /api/sources/:id/test-connection and renders an ok chip with the latency', async () => {
      const ctx = await setup();
      flush(ctx.http, SNAPSHOT, { allowAdminActions: true });
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const row = ctx.nativeElement().querySelector(
        '[data-testid="source-row-wikidata"]',
      );
      const btn = buttonByText(row, 'Test connection');
      btn!.click();
      ctx.detect();
      await ctx.stable();

      const req = ctx.http.expectOne(
        '/api/sources/wikidata/test-connection',
      );
      expect(req.request.method).toBe('POST');
      req.flush({ ok: true, latencyMs: 123 });
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const chip = row?.querySelector(
        '[data-testid="row-test-connection-chip"]',
      );
      expect(chip).not.toBeNull();
      expect(chip?.getAttribute('data-state')).toBe('ok');
      // The latency rides on the chip so the operator can spot a
      // 30s timeout vs a 2ms refused connection without expanding.
      expect(chip?.textContent).toContain('123');
    });

    it('renders an error chip with the kind class and first-line message when the probe reports !ok', async () => {
      const ctx = await setup();
      flush(ctx.http, SNAPSHOT, { allowAdminActions: true });
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const row = ctx.nativeElement().querySelector(
        '[data-testid="source-row-wikidata"]',
      );
      const btn = buttonByText(row, 'Test connection');
      btn!.click();
      ctx.detect();
      await ctx.stable();

      const req = ctx.http.expectOne(
        '/api/sources/wikidata/test-connection',
      );
      req.flush({
        ok: false,
        latencyMs: 7,
        error: { kind: 'endpoint-fetch', message: 'ECONNREFUSED' },
      });
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const chip = row?.querySelector(
        '[data-testid="row-test-connection-chip"]',
      );
      expect(chip?.getAttribute('data-state')).toBe('error');
      // The chip exposes the kind as a data attribute so style hooks can
      // pick the right warning colour, and renders the message for the
      // operator's diagnostic glance.
      expect(chip?.getAttribute('data-kind')).toBe('endpoint-fetch');
      expect(chip?.textContent).toContain('ECONNREFUSED');
    });
  });

  describe('failure surface — inline error chip + Show details + Retry (#360)', () => {
    /**
     * Snapshot pairs an in-memory `failed` row and a disk-backed `failed` row
     * so each test can assert mirrored behaviour for both modes (the user
     * stories don't differentiate — both surfaces speak the same Layer 5
     * shape and render the same chip + expander).
     */
    const FAILED_SNAPSHOT: SourceRow[] = [
      {
        mode: 'in-memory',
        id: 'broken-glob',
        kind: 'glob',
        state: 'failed',
        error: {
          kind: 'glob-load',
          message: 'Unexpected "ex:" on line 3',
          details:
            'Unexpected "ex:" on line 3\n  at /tmp/data.ttl:3:0\n  while parsing prefix declarations',
        },
      },
      {
        mode: 'disk-backed',
        id: 'broken-index',
        kind: 'glob',
        state: 'failed',
        error: {
          kind: 'index-build-failed',
          message: 'exit code 1',
          // No details — exercises the "Show details absent" path.
        },
        indexDir: '/cfg/.sparqly/index/broken-index',
      },
    ];

    it('renders an inline error chip on a failed in-memory row carrying the kind class and first-line message', async () => {
      const ctx = await setup();
      flush(ctx.http, FAILED_SNAPSHOT, { allowAdminActions: true });
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const row = ctx.nativeElement().querySelector(
        '[data-testid="source-row-broken-glob"]',
      );
      const chip = row?.querySelector('[data-testid="row-error-chip"]');
      expect(chip).not.toBeNull();
      // The kind rides on the chip as a data attribute so a style hook can
      // pick the right warning colour without parsing the chip text. The
      // chip text is collapsed to the first line of `error.message` so a
      // multi-line stack doesn't blow up the row height.
      expect(chip?.getAttribute('data-kind')).toBe('glob-load');
      expect(chip?.textContent).toContain('glob-load');
      expect(chip?.textContent).toContain('Unexpected "ex:" on line 3');
    });

    it('renders an inline error chip on a failed disk-backed row likewise', async () => {
      const ctx = await setup();
      flush(ctx.http, FAILED_SNAPSHOT, { allowAdminActions: true });
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const row = ctx.nativeElement().querySelector(
        '[data-testid="source-row-broken-index"]',
      );
      const chip = row?.querySelector('[data-testid="row-error-chip"]');
      expect(chip).not.toBeNull();
      expect(chip?.getAttribute('data-kind')).toBe('index-build-failed');
      expect(chip?.textContent).toContain('exit code 1');
    });

    it('does not render an error chip on a non-failed row (the projector never ships error then, but the page must still guard the @if)', async () => {
      const ctx = await setup();
      flush(ctx.http, SNAPSHOT, { allowAdminActions: true });
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      // None of the default SNAPSHOT rows are `failed` — no chip anywhere.
      const chips = ctx.nativeElement().querySelectorAll(
        '[data-testid="row-error-chip"]',
      );
      expect(chips.length).toBe(0);
    });

    it('renders a Show details toggle only when error.details is present, and reveals the details body on click', async () => {
      const ctx = await setup();
      flush(ctx.http, FAILED_SNAPSHOT, { allowAdminActions: true });
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      // The disk-backed row has no `details` — its toggle must be absent.
      const diskRow = ctx.nativeElement().querySelector(
        '[data-testid="source-row-broken-index"]',
      );
      expect(buttonByText(diskRow, 'Show details')).toBeNull();
      expect(
        diskRow?.querySelector('[data-testid="row-error-details"]'),
      ).toBeNull();

      // The in-memory row carries a multi-line `details` payload — toggle
      // is present, body is collapsed by default, and click reveals it.
      const memRow = ctx.nativeElement().querySelector(
        '[data-testid="source-row-broken-glob"]',
      );
      const toggle = buttonByText(memRow, 'Show details');
      expect(toggle).not.toBeNull();
      expect(
        memRow?.querySelector('[data-testid="row-error-details"]'),
      ).toBeNull();

      toggle!.click();
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const body = memRow?.querySelector(
        '[data-testid="row-error-details"]',
      );
      expect(body).not.toBeNull();
      expect(body?.textContent).toContain('while parsing prefix declarations');
    });

    it('relabels the in-memory Load button to Retry on a failed row (#360 user story)', async () => {
      const ctx = await setup();
      flush(ctx.http, FAILED_SNAPSHOT, { allowAdminActions: true });
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const row = ctx.nativeElement().querySelector(
        '[data-testid="source-row-broken-glob"]',
      );
      // Same wire verb (`/load`) — only the surface label flips to "Retry"
      // so the operator sees the recovery affordance the failure invites.
      const btn = buttonByText(row, 'Retry');
      expect(btn).not.toBeNull();

      btn!.click();
      ctx.detect();
      await ctx.stable();
      const req = ctx.http.expectOne('/api/sources/broken-glob/load');
      expect(req.request.method).toBe('POST');
      req.flush({ id: 'broken-glob', state: 'loading' });
    });

    it('relabels the disk-backed (Re)build button to Retry on a failed row', async () => {
      const ctx = await setup();
      flush(ctx.http, FAILED_SNAPSHOT, { allowAdminActions: true });
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const row = ctx.nativeElement().querySelector(
        '[data-testid="source-row-broken-index"]',
      );
      const btn = buttonByText(row, 'Retry');
      expect(btn).not.toBeNull();

      btn!.click();
      ctx.detect();
      await ctx.stable();
      const req = ctx.http.expectOne('/api/sources/broken-index/index-build');
      expect(req.request.method).toBe('POST');
      req.flush({ id: 'broken-index', state: 'indexing' });
    });

    it('hides Retry on a failed row when allowAdminActions is false (read-only serve)', async () => {
      const ctx = await setup();
      flush(ctx.http, FAILED_SNAPSHOT, { allowAdminActions: false });
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      // The error chip + Show details still surface (read-only operators
      // still need to see why a source is broken) — only the Retry action
      // disappears.
      const chips = ctx.nativeElement().querySelectorAll(
        '[data-testid="row-error-chip"]',
      );
      expect(chips.length).toBe(2);
      const retries = Array.from(
        ctx.nativeElement().querySelectorAll('button'),
      ).filter((b) => b.textContent?.trim() === 'Retry');
      expect(retries).toEqual([]);
    });
  });

  describe('Split-glob disclosure (#361)', () => {
    const SPLIT_SNAPSHOT: SourceRow[] = [
      {
        mode: 'in-memory',
        id: 'docs',
        kind: 'glob',
        state: 'not-loaded',
        children: [
          {
            mode: 'in-memory',
            id: 'docs/a.ttl',
            kind: 'file',
            parentId: 'docs',
            state: 'not-loaded',
          },
          {
            mode: 'in-memory',
            id: 'docs/b.ttl',
            kind: 'file',
            parentId: 'docs',
            state: 'not-loaded',
          },
        ],
      },
    ];

    it('renders the meta row with a disclosure toggle and hides children by default', async () => {
      // A split-glob with 200 matched files would drown the page; the meta
      // collapses by default and the operator opens it on demand (issue #361).
      const ctx = await setup();
      flush(ctx.http, SPLIT_SNAPSHOT);
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const metaRow = ctx.nativeElement().querySelector(
        '[data-testid="source-row-docs"]',
      );
      expect(metaRow).not.toBeNull();
      // The disclosure control is on the meta row.
      expect(disclosureToggle(metaRow)).not.toBeNull();
      // No child rows are rendered yet.
      expect(
        ctx.nativeElement().querySelector('[data-testid="source-row-docs/a.ttl"]'),
      ).toBeNull();
      expect(
        ctx.nativeElement().querySelector('[data-testid="source-row-docs/b.ttl"]'),
      ).toBeNull();
    });

    it('SSE child-row events update the child inside its meta and re-aggregate the meta state to "mixed"', async () => {
      // Acceptance criterion: child rows carry their own state; per the SSE
      // shape decision, the server emits one event per source-id (meta or
      // child) and the webapp re-applies it inside `meta.children`, then
      // re-aggregates the meta's displayed state. A child event must not
      // surface as a new top-level row.
      const stream = createFakeStream();
      const ctx = await setup('/sources', { stream });
      flush(ctx.http, SPLIT_SNAPSHOT);
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      stream.emitRow({
        mode: 'in-memory',
        id: 'docs/a.ttl',
        kind: 'file',
        parentId: 'docs',
        state: 'loaded',
        quads: 7,
        files: 1,
        loadedAt: LOADED_AT,
        loadMs: 4,
      });
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      // Meta state re-aggregates client-side: one loaded child + one
      // not-loaded child → 'mixed'.
      const metaRow = ctx.nativeElement().querySelector(
        '[data-testid="source-row-docs"]',
      );
      expect(
        metaRow?.querySelector('[data-testid="row-state"]')?.textContent,
      ).toContain('mixed');

      // The child must not appear as a sibling top-level row. With the meta
      // collapsed, only the parent renders — no child cards anywhere.
      expect(renderedRowIds(ctx.nativeElement())).toEqual(['docs']);

      // Expanding the meta now reveals the updated child.
      disclosureToggle(ctx.nativeElement())?.click();
      ctx.detect();
      await ctx.stable();
      ctx.detect();
      const childRow = ctx.nativeElement().querySelector(
        '[data-testid="source-row-docs/a.ttl"]',
      );
      expect(
        childRow?.querySelector('[data-testid="row-state"]')?.textContent,
      ).toContain('loaded');
    });

    it('meta-row "Reload all loaded children" cascades one POST per loaded child client-side, skipping not-loaded siblings (no server fan-out)', async () => {
      // Acceptance criteria: a meta-row cascade fires one HTTP request per
      // qualifying child from the client; siblings already loaded are
      // reloaded; not-loaded siblings are skipped. The server never sees a
      // single fan-out route — proven by the per-child URLs the client hits.
      const snapshot: SourceRow[] = [
        {
          mode: 'in-memory',
          id: 'docs',
          kind: 'glob',
          state: 'mixed',
          children: [
            {
              mode: 'in-memory',
              id: 'docs/a.ttl',
              kind: 'file',
              parentId: 'docs',
              state: 'loaded',
              quads: 5,
              files: 1,
              loadedAt: LOADED_AT,
              loadMs: 3,
            },
            {
              mode: 'in-memory',
              id: 'docs/b.ttl',
              kind: 'file',
              parentId: 'docs',
              state: 'loaded',
              quads: 8,
              files: 1,
              loadedAt: LOADED_AT,
              loadMs: 4,
            },
            {
              mode: 'in-memory',
              id: 'docs/c.ttl',
              kind: 'file',
              parentId: 'docs',
              state: 'not-loaded',
            },
          ],
        },
      ];
      const ctx = await setup();
      flush(ctx.http, snapshot);
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const cascade = buttonByText(ctx.nativeElement(), 'Reload loaded children');
      expect(cascade).not.toBeNull();
      cascade?.click();
      ctx.detect();
      await ctx.stable();

      // One POST per loaded child; the not-loaded sibling is skipped.
      const reqA = ctx.http.expectOne(
        '/api/sources/' + encodeURIComponent('docs/a.ttl') + '/reload',
      );
      const reqB = ctx.http.expectOne(
        '/api/sources/' + encodeURIComponent('docs/b.ttl') + '/reload',
      );
      expect(reqA.request.method).toBe('POST');
      expect(reqB.request.method).toBe('POST');
      reqA.flush({ id: 'docs/a.ttl', state: 'loaded' });
      reqB.flush({ id: 'docs/b.ttl', state: 'loaded' });
      // No request to docs/c.ttl or to the meta itself.
      ctx.http.verify();
    });

    it('one cascaded child failing does not abort siblings — every loaded child sees its POST issued', async () => {
      const snapshot: SourceRow[] = [
        {
          mode: 'in-memory',
          id: 'docs',
          kind: 'glob',
          state: 'loaded',
          children: [
            {
              mode: 'in-memory',
              id: 'docs/a.ttl',
              kind: 'file',
              parentId: 'docs',
              state: 'loaded',
              files: 1,
              loadedAt: LOADED_AT,
              loadMs: 1,
            },
            {
              mode: 'in-memory',
              id: 'docs/b.ttl',
              kind: 'file',
              parentId: 'docs',
              state: 'loaded',
              files: 1,
              loadedAt: LOADED_AT,
              loadMs: 1,
            },
          ],
        },
      ];
      const ctx = await setup();
      flush(ctx.http, snapshot);
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      buttonByText(ctx.nativeElement(), 'Reload loaded children')?.click();
      ctx.detect();
      await ctx.stable();

      const reqA = ctx.http.expectOne(
        '/api/sources/' + encodeURIComponent('docs/a.ttl') + '/reload',
      );
      const reqB = ctx.http.expectOne(
        '/api/sources/' + encodeURIComponent('docs/b.ttl') + '/reload',
      );
      // Sibling A errors — sibling B's request must still have been issued
      // (the cascade does not short-circuit on a failed sibling).
      reqA.flush(
        { error: 'simulated' },
        { status: 500, statusText: 'Server Error' },
      );
      reqB.flush({ id: 'docs/b.ttl', state: 'loaded' });
      ctx.http.verify();
    });

    it('the cascade is hidden when sources.allowAdminActions is false (gated like single-row actions)', async () => {
      const snapshot: SourceRow[] = [
        {
          mode: 'in-memory',
          id: 'docs',
          kind: 'glob',
          state: 'loaded',
          children: [
            {
              mode: 'in-memory',
              id: 'docs/a.ttl',
              kind: 'file',
              parentId: 'docs',
              state: 'loaded',
            },
          ],
        },
      ];
      const ctx = await setup();
      flush(ctx.http, snapshot, { allowAdminActions: false });
      ctx.detect();
      await ctx.stable();
      ctx.detect();
      expect(
        buttonByText(ctx.nativeElement(), 'Reload loaded children'),
      ).toBeNull();
    });

    it('the cascade button is hidden when no child is currently loaded (nothing to reload)', async () => {
      const snapshot: SourceRow[] = [
        {
          mode: 'in-memory',
          id: 'docs',
          kind: 'glob',
          state: 'not-loaded',
          children: [
            {
              mode: 'in-memory',
              id: 'docs/a.ttl',
              kind: 'file',
              parentId: 'docs',
              state: 'not-loaded',
            },
          ],
        },
      ];
      const ctx = await setup();
      flush(ctx.http, snapshot);
      ctx.detect();
      await ctx.stable();
      ctx.detect();
      expect(
        buttonByText(ctx.nativeElement(), 'Reload loaded children'),
      ).toBeNull();
    });

    it('child rows carry their own per-row action menu (Load on not-loaded children, gated by capability)', async () => {
      // Acceptance criterion: "Per-child action menu invokes the same gated
      // routes as a normal in-memory row." A `not-loaded` File child shows
      // a Load button; clicking it must POST to /api/sources/<child-id>/load,
      // not to the meta's id (no server-side fan-out).
      const ctx = await setup();
      flush(ctx.http, SPLIT_SNAPSHOT);
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      disclosureToggle(ctx.nativeElement())?.click();
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const childRow = ctx.nativeElement().querySelector(
        '[data-testid="source-row-docs/a.ttl"]',
      );
      const loadBtn = buttonByText(childRow, 'Load');
      expect(loadBtn).not.toBeNull();
      loadBtn?.click();
      ctx.detect();
      await ctx.stable();

      const req = ctx.http.expectOne(
        '/api/sources/' + encodeURIComponent('docs/a.ttl') + '/load',
      );
      expect(req.request.method).toBe('POST');
      req.flush({ id: 'docs/a.ttl', state: 'loaded' });
    });

    it('clicking the disclosure toggle reveals each child as a row with id, kind, state', async () => {
      const ctx = await setup();
      flush(ctx.http, SPLIT_SNAPSHOT);
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const toggle = disclosureToggle(ctx.nativeElement());
      toggle?.click();
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const childA = ctx.nativeElement().querySelector(
        '[data-testid="source-row-docs/a.ttl"]',
      );
      const childB = ctx.nativeElement().querySelector(
        '[data-testid="source-row-docs/b.ttl"]',
      );
      expect(childA).not.toBeNull();
      expect(childB).not.toBeNull();
      // Each child carries its own state chip — operators debug the failing
      // child independently of its siblings (#361 acceptance criterion).
      expect(
        childA?.querySelector('[data-testid="row-state"]')?.textContent,
      ).toContain('not-loaded');
    });
  });

  it('opening the page issues zero requests to mutating Sources-page routes (ADR-0031 preserved)', async () => {
    const ctx = await setup();
    flush(ctx.http);
    ctx.detect();
    await ctx.stable();
    ctx.detect();

    // No POST/DELETE to any per-entry trigger — opening the snapshot must
    // never kick a Load, Reload, Unload, (Re)build index, Cancel, or Test
    // connection. We assert via HttpTestingController.match(): any matching
    // request is a regression.
    const triggers = ctx.http.match((req) =>
      /^\/api\/sources\/[^/]+(?:\/(load|reload|unload|index-build|test-connection))?$/.test(
        req.url,
      ) && req.method !== 'GET',
    );
    expect(triggers).toEqual([]);
    ctx.http.verify();
  });

  describe('filter bar (search + state chips)', () => {
    const visibleRowIds = renderedRowIds;

    it('renders all snapshot rows by default (no filter active)', async () => {
      const ctx = await setup();
      flush(ctx.http);
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      expect(visibleRowIds(ctx.nativeElement())).toEqual([
        'docs',
        'projects',
        'big',
        'wikidata',
      ]);
    });

    it('typing into the search input narrows the visible rows by id substring', async () => {
      const ctx = await setup();
      flush(ctx.http);
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const input = ctx.nativeElement().querySelector<HTMLInputElement>(
        '[data-testid="sources-filter-query"]',
      );
      expect(input).not.toBeNull();
      input!.value = 'pro';
      input!.dispatchEvent(new Event('input'));
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      expect(visibleRowIds(ctx.nativeElement())).toEqual(['projects']);
    });

    it('clicking a state chip filters to rows in that state and other chips become inactive', async () => {
      const ctx = await setup();
      flush(ctx.http);
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const loadedChip = ctx.nativeElement().querySelector<HTMLButtonElement>(
        '[data-testid="sources-filter-loaded"]',
      );
      loadedChip!.click();
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      expect(visibleRowIds(ctx.nativeElement())).toEqual(['projects']);
      expect(loadedChip!.getAttribute('aria-pressed')).toBe('true');
      const allChip = ctx.nativeElement().querySelector(
        '[data-testid="sources-filter-all"]',
      );
      expect(allChip?.getAttribute('aria-pressed')).toBe('false');
    });

    it('the endpoint chip narrows to endpoint rows only', async () => {
      const ctx = await setup();
      flush(ctx.http);
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      ctx.nativeElement().querySelector<HTMLButtonElement>(
        '[data-testid="sources-filter-endpoint"]',
      )!.click();
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      expect(visibleRowIds(ctx.nativeElement())).toEqual(['wikidata']);
    });

    it('chip count badges reflect the snapshot — including children in split-glob metas', async () => {
      // The chip counts cover the whole registry, not just what's currently
      // visible — they're a "what's in here" signal, not a DOM-render one.
      const SNAPSHOT_WITH_CHILDREN: SourceRow[] = [
        {
          mode: 'in-memory',
          id: 'docs',
          kind: 'glob',
          state: 'not-loaded',
          children: [
            {
              mode: 'in-memory',
              id: 'docs/a.ttl',
              kind: 'file',
              parentId: 'docs',
              state: 'loaded',
            },
            {
              mode: 'in-memory',
              id: 'docs/b.ttl',
              kind: 'file',
              parentId: 'docs',
              state: 'not-loaded',
            },
          ],
        },
        { mode: 'endpoint', id: 'wikidata', kind: 'endpoint' },
      ];
      const ctx = await setup();
      flush(ctx.http, SNAPSHOT_WITH_CHILDREN);
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const chipText = (key: string): string =>
        ctx.nativeElement()
          .querySelector(`[data-testid="sources-filter-${key}"]`)!
          .textContent!.trim();
      // parent meta-row + both children + endpoint = 4 entries
      expect(chipText('all')).toContain('4');
      // parent (not-loaded) + b.ttl child (not-loaded) = 2
      expect(chipText('not-loaded')).toContain('2');
      expect(chipText('loaded')).toContain('1');
      expect(chipText('endpoint')).toContain('1');
    });

    it('when no rows match the active filter, the page shows an empty-state hint instead of the list', async () => {
      const ctx = await setup();
      flush(ctx.http);
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      const input = ctx.nativeElement().querySelector<HTMLInputElement>(
        '[data-testid="sources-filter-query"]',
      );
      input!.value = 'nothing-matches-this';
      input!.dispatchEvent(new Event('input'));
      ctx.detect();
      await ctx.stable();
      ctx.detect();

      expect(
        ctx.nativeElement().querySelector('[data-testid="sources-list"]'),
      ).toBeNull();
      expect(
        ctx.nativeElement().querySelector('[data-testid="sources-filter-empty"]'),
      ).not.toBeNull();
    });
  });
});
