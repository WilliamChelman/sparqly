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

const SNAPSHOT: SourceRow[] = [
  { mode: 'in-memory', id: 'docs', kind: 'glob', state: 'not-loaded' },
  {
    mode: 'in-memory',
    id: 'projects',
    kind: 'glob',
    state: 'loaded',
    default: true,
  },
  { mode: 'disk-backed', id: 'big', kind: 'glob', state: 'ready' },
  { mode: 'endpoint', id: 'wikidata', kind: 'endpoint' },
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

function flush(http: HttpTestingController, rows = SNAPSHOT): void {
  const req = http.expectOne('/api/sources');
  expect(req.request.method).toBe('GET');
  req.flush(rows);
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

    const rows = Array.from(
      ctx.nativeElement().querySelectorAll('[data-testid^="source-row-"]'),
    );
    expect(rows.map((r) => r.getAttribute('data-source-id'))).toEqual([
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
    expect(defaultRow?.getAttribute('data-default')).toBe('true');
    const nonDefault = ctx.nativeElement().querySelector(
      '[data-testid="source-row-docs"]',
    );
    expect(nonDefault?.getAttribute('data-default')).not.toBe('true');
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
    const refetched: SourceRow[] = [
      { mode: 'in-memory', id: 'docs', kind: 'glob', state: 'loaded' },
      { mode: 'in-memory', id: 'projects', kind: 'glob', state: 'loaded' },
      { mode: 'disk-backed', id: 'big', kind: 'glob', state: 'ready' },
      { mode: 'endpoint', id: 'wikidata', kind: 'endpoint' },
    ];
    flush(ctx.http, refetched);
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
});
