import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { SavedQuerySummary } from '@app/core';
import { QueriesPage } from './queries.page';

const LIBRARY: SavedQuerySummary[] = [
  { slug: 'zebra', hasParameters: false },
  { slug: 'alpha', hasParameters: false },
  { slug: 'beta', description: 'B', hasParameters: false },
];

async function setup(initialUrl = '/queries') {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'queries', component: QueriesPage },
        { path: 'queries/:slug', component: QueriesPage },
      ]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(initialUrl, QueriesPage);
  const router = TestBed.inject(Router);
  const http = TestBed.inject(HttpTestingController);
  const fixture = {
    get nativeElement(): HTMLElement {
      return harness.routeNativeElement as HTMLElement;
    },
    detectChanges: () => harness.detectChanges(),
    whenStable: () => harness.fixture.whenStable(),
  };
  return { fixture, harness, router, http };
}

function flushList(
  http: HttpTestingController,
  entries: readonly SavedQuerySummary[] = LIBRARY,
): void {
  const req = http.expectOne('/api/saved-queries');
  expect(req.request.method).toBe('GET');
  req.flush(entries);
}

describe('QueriesPage', () => {
  it('renders all saved-query slugs in the left rail, sorted alphabetically', async () => {
    const { fixture, http } = await setup();
    flushList(http);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const slugs = Array.from(
      root.querySelectorAll('[data-testid=queries-entry]'),
    ).map((b) => b.getAttribute('data-slug'));
    expect(slugs).toEqual(['alpha', 'beta', 'zebra']);
    http.verify();
  });

  it('filters the visible list as the user types into the filter input', async () => {
    const { fixture, http } = await setup();
    flushList(http);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector(
      '[data-testid=queries-filter]',
    ) as HTMLInputElement;
    input.value = 'bet';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const slugs = Array.from(
      root.querySelectorAll('[data-testid=queries-entry]'),
    ).map((b) => b.getAttribute('data-slug'));
    expect(slugs).toEqual(['beta']);
    http.verify();
  });

  it('navigates to /queries/:slug on selection and renders the body in the right pane', async () => {
    const { fixture, http, router } = await setup();
    flushList(http);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const entry = Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid=queries-entry]'),
    ).find((b) => b.getAttribute('data-slug') === 'beta') as HTMLButtonElement;
    entry.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(router.url).toBe('/queries/beta');

    // Navigation re-mounts QueriesPage; the new instance fetches the list again
    // before loading the selected slug.
    flushList(http);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const req = http.expectOne('/api/saved-queries/beta');
    expect(req.request.method).toBe('GET');
    req.flush(
      { slug: 'beta', body: 'SELECT * WHERE { ?b a :Bee }' },
      { headers: { ETag: '"e-beta"' } },
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const body = fixture.nativeElement.querySelector(
      '[data-testid=queries-detail-body]',
    );
    expect(body?.textContent).toContain('SELECT * WHERE { ?b a :Bee }');
    http.verify();
  });

  it('auto-selects the entry from /queries/:slug on a fresh boot', async () => {
    const { fixture, http } = await setup('/queries/alpha');
    flushList(http);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const req = http.expectOne('/api/saved-queries/alpha');
    req.flush(
      { slug: 'alpha', body: 'ASK { ?s ?p ?o }' },
      { headers: { ETag: '"e-alpha"' } },
    );
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const current = root.querySelector(
      '[data-testid=queries-entry][aria-current="true"]',
    );
    expect(current?.getAttribute('data-slug')).toBe('alpha');
    expect(
      root.querySelector('[data-testid=queries-detail-body]')?.textContent,
    ).toContain('ASK { ?s ?p ?o }');
    http.verify();
  });

  it('renders an inline not-found state in the right pane for an unknown slug', async () => {
    const { fixture, http } = await setup('/queries/ghost');
    flushList(http);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const notFound = root.querySelector('[data-testid=queries-detail-not-found]');
    expect(notFound).toBeTruthy();
    expect(notFound?.textContent).toContain('ghost');
    expect(
      root.querySelector('[data-testid=queries-detail-body]'),
    ).toBeFalsy();
    // No GET for the entry should be issued when the slug isn't in the list.
    http.expectNone('/api/saved-queries/ghost');
    http.verify();
  });
});
