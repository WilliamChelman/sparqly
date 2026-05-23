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

async function setup(initialUrl = '/sources') {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'sources', component: SourcesPage }]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(initialUrl, SourcesPage);
  const http = TestBed.inject(HttpTestingController);
  return {
    harness,
    http,
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
