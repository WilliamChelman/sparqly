import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import {
  ConfigService,
  type ConfigPayload,
  type SourceListing,
} from '@app/core';
import { DescribePage } from './describe.page';
import { DescribeSectionsComponent } from './components/describe-sections.component';
import { MultiSourcesPickerComponent } from '@app/modules/multi-sources-picker';

@Component({
  selector: 'app-multi-sources-picker',
  standalone: true,
  template: `<div
    data-testid="stub-multi-picker"
    [attr.data-value]="(value ?? []).join(',')"
  ></div>`,
})
class MultiSourcesPickerStub {
  @Input() value: string[] | undefined = undefined;
  @Input() label = 'sources';
  @Input() excludeKinds: ReadonlyArray<string> = [];
  @Output() valueChange = new EventEmitter<string[]>();

  emit(value: string[]): void {
    this.value = value;
    this.valueChange.emit(value);
  }
}

const LISTING: SourceListing = {
  sources: [
    { id: 'alpha', kind: 'glob', label: 'A (glob)', default: true },
    { id: 'beta', kind: 'glob', label: 'B (glob)' },
  ],
};

async function setup(
  initialUrl = '/describe',
  prefixes: Record<string, string> = {},
  sources: SourceListing['sources'] = LISTING.sources,
) {
  const payload: ConfigPayload = {
    sources,
    context: { prefixes },
    describe: {
      perSourceSoftLimit: 10000,
      perSourceHardLimit: 100000,
      fromSourcePredicate: 'urn:sparqly:fromSource',
    },
  };
  const configStub: Pick<
    ConfigService,
    'list' | 'config' | 'context' | 'describe'
  > = {
    list: () => of({ sources }),
    config: () => of(payload),
    context: () => of(payload.context),
    describe: () => of(payload.describe),
  };

  TestBed.configureTestingModule({
    imports: [DescribePage],
    providers: [
      provideRouter([{ path: 'describe', component: DescribePage }]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ConfigService, useValue: configStub },
    ],
  })
    .overrideComponent(DescribePage, {
      remove: { imports: [MultiSourcesPickerComponent] },
      add: { imports: [MultiSourcesPickerStub] },
    })
    .compileComponents();

  const router = TestBed.inject(Router);
  await router.navigateByUrl(initialUrl);
  const fixture = TestBed.createComponent(DescribePage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const http = TestBed.inject(HttpTestingController);
  return { fixture, router, http };
}

function describeSections(fixture: {
  debugElement: import('@angular/core').DebugElement;
}): DescribeSectionsComponent | null {
  const all = fixture.debugElement
    .queryAll((n) => n.componentInstance instanceof DescribeSectionsComponent)
    .map((d) => d.componentInstance as DescribeSectionsComponent);
  return all[0] ?? null;
}

function requireDescribeSections(fixture: {
  debugElement: import('@angular/core').DebugElement;
}): DescribeSectionsComponent {
  const cmp = describeSections(fixture);
  if (!cmp) throw new Error('describe-sections component not found');
  return cmp;
}

function pickerStub(fixture: {
  debugElement: import('@angular/core').DebugElement;
}): MultiSourcesPickerStub | null {
  const all = fixture.debugElement
    .queryAll((n) => n.componentInstance instanceof MultiSourcesPickerStub)
    .map((d) => d.componentInstance as MultiSourcesPickerStub);
  return all[0] ?? null;
}

const NQUADS_SAMPLE =
  '<http://example.org/alice> <http://example.org/knows> <http://example.org/bob> .\n' +
  '<http://example.org/alice> <http://example.org/age> "30" .\n' +
  '<http://example.org/carol> <http://example.org/knows> <http://example.org/alice> .\n';

describe('DescribePage', () => {
  it('renders a seed input field and a Describe button', async () => {
    const { fixture } = await setup();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('input[data-testid=seed-input]')).toBeTruthy();
    expect(root.querySelector('button[data-testid=run-describe]')).toBeTruthy();
  });

  it('seeds the input from the ?iri URL query param', async () => {
    const { fixture, http } = await setup(
      '/describe?iri=' + encodeURIComponent('http://example.org/alice'),
    );
    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector('input[data-testid=seed-input]') as HTMLInputElement;
    expect(input.value).toBe('http://example.org/alice');
    // Loading from a URL with ?iri auto-runs the describe.
    http.expectOne('/api/describe').flush({
      iri: 'http://example.org/alice',
      quads: '',
      total: 0,
      perSource: {},
    });
    http.verify();
  });

  it('shows a spinner while a describe request is in flight and clears it on response', async () => {
    const { fixture, http } = await setup();
    const root = fixture.nativeElement as HTMLElement;

    const input = root.querySelector('input[data-testid=seed-input]') as HTMLInputElement;
    input.value = 'http://example.org/alice';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (root.querySelector('button[data-testid=run-describe]') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(root.querySelector('[data-testid=spinner]')).toBeTruthy();

    const req = http.expectOne('/api/describe');
    expect(req.request.method).toBe('POST');
    expect(req.request.body.iri).toBe('http://example.org/alice');

    req.flush({
      iri: 'http://example.org/alice',
      quads: NQUADS_SAMPLE,
      total: 3,
      perSource: { alpha: { count: 3, truncated: false } },
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(root.querySelector('[data-testid=spinner]')).toBeFalsy();
    http.verify();
  });

  it('renders the quad table with the response body once it lands', async () => {
    const { fixture, http } = await setup();
    const root = fixture.nativeElement as HTMLElement;

    const input = root.querySelector('input[data-testid=seed-input]') as HTMLInputElement;
    input.value = 'http://example.org/alice';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (root.querySelector('button[data-testid=run-describe]') as HTMLButtonElement).click();
    fixture.detectChanges();

    http.expectOne('/api/describe').flush({
      iri: 'http://example.org/alice',
      quads: NQUADS_SAMPLE,
      total: 3,
      perSource: { alpha: { count: 3, truncated: false } },
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // NQUADS_SAMPLE has 2 outbound quads and 1 inbound quad off the seed.
    const sections = root.querySelectorAll('[data-testid=describe-section]');
    expect(sections.length).toBe(2);
    expect(root.querySelector('[data-direction=outbound]')).toBeTruthy();
    expect(root.querySelector('[data-direction=inbound]')).toBeTruthy();
    expect(root.querySelectorAll('[data-testid=describe-row]').length).toBe(3);
    expect(requireDescribeSections(fixture).seed()).toBe('http://example.org/alice');
    http.verify();
  });

  it('mirrors the submitted seed IRI into the ?iri URL query param', async () => {
    const { fixture, http, router } = await setup();
    const root = fixture.nativeElement as HTMLElement;

    const input = root.querySelector('input[data-testid=seed-input]') as HTMLInputElement;
    input.value = 'http://example.org/alice';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (root.querySelector('button[data-testid=run-describe]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    const tree = router.parseUrl(router.url);
    expect(tree.queryParamMap.get('iri')).toBe('http://example.org/alice');

    http.expectOne('/api/describe').flush({
      iri: 'http://example.org/alice',
      quads: '',
      total: 0,
      perSource: { alpha: { count: 0, truncated: false } },
    });
    http.verify();
  });

  it('renders the multi-sources picker', async () => {
    const { fixture } = await setup();
    expect(pickerStub(fixture)).toBeTruthy();
  });

  it('omits `sources` from the request body when the picker is at its default (all selected)', async () => {
    const { fixture, http } = await setup();
    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector('input[data-testid=seed-input]') as HTMLInputElement;
    input.value = 'http://example.org/alice';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // No explicit picker change → no `sources` in body.
    (root.querySelector('button[data-testid=run-describe]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const req = http.expectOne('/api/describe');
    expect(req.request.body).toEqual({ iri: 'http://example.org/alice' });
    req.flush({
      iri: 'http://example.org/alice',
      quads: '',
      total: 0,
      perSource: {},
    });
    http.verify();
  });

  it('sends `sources` in the request body when the picker emits a subset', async () => {
    const { fixture, http } = await setup();
    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector('input[data-testid=seed-input]') as HTMLInputElement;
    input.value = 'http://example.org/alice';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const picker = pickerStub(fixture);
    if (!picker) throw new Error('picker stub not found');
    picker.emit(['beta']);
    fixture.detectChanges();

    (root.querySelector('button[data-testid=run-describe]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const req = http.expectOne('/api/describe');
    expect(req.request.body).toEqual({
      iri: 'http://example.org/alice',
      sources: ['beta'],
    });
    req.flush({
      iri: 'http://example.org/alice',
      quads: '',
      total: 0,
      perSource: { beta: { count: 0, truncated: false } },
    });
    http.verify();
  });

  it('mirrors picker selection into the ?sources URL query param on submit', async () => {
    const { fixture, http, router } = await setup();
    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector('input[data-testid=seed-input]') as HTMLInputElement;
    input.value = 'http://example.org/alice';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const picker = pickerStub(fixture);
    if (!picker) throw new Error('picker stub not found');
    picker.emit(['alpha', 'beta']);
    fixture.detectChanges();

    (root.querySelector('button[data-testid=run-describe]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    const tree = router.parseUrl(router.url);
    expect(tree.queryParamMap.get('sources')).toBe('alpha,beta');

    http.expectOne('/api/describe').flush({
      iri: 'http://example.org/alice',
      quads: '',
      total: 0,
      perSource: {},
    });
    http.verify();
  });

  it('seeds the picker from the ?sources URL query param', async () => {
    const { fixture } = await setup('/describe?sources=beta');
    const picker = pickerStub(fixture);
    expect(picker?.value).toEqual(['beta']);
  });

  async function runAndFlush(
    body: object,
    opts?: { status: number; statusText: string },
  ): Promise<{ root: HTMLElement; fixture: Awaited<ReturnType<typeof setup>>['fixture'] }> {
    const { fixture, http } = await setup();
    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector('input[data-testid=seed-input]') as HTMLInputElement;
    input.value = 'http://example.org/alice';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (root.querySelector('button[data-testid=run-describe]') as HTMLButtonElement).click();
    fixture.detectChanges();
    http.expectOne('/api/describe').flush(body, opts);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    http.verify();
    return { root, fixture };
  }

  it('renders per-source error rows under the picker when the response carries failures', async () => {
    const { root, fixture } = await runAndFlush({
      iri: 'http://example.org/alice',
      quads: NQUADS_SAMPLE,
      total: 3,
      perSource: {
        alpha: { count: 3, truncated: false },
        beta: { count: 0, truncated: false, error: 'No files matched: beta/*.ttl' },
      },
    });
    const errors = root.querySelector('[data-testid=source-errors]');
    expect(errors).toBeTruthy();
    const rows = root.querySelectorAll('[data-testid=source-error-row]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('beta');
    expect(rows[0].textContent).toContain('No files matched');
    // The successful source's quads still render in the sectioned view above.
    expect(root.querySelectorAll('[data-testid=describe-row]').length).toBe(3);
    void fixture;
  });

  it('does not render the error list when every source succeeded', async () => {
    const { root } = await runAndFlush({
      iri: 'http://example.org/alice',
      quads: NQUADS_SAMPLE,
      total: 3,
      perSource: { alpha: { count: 3, truncated: false } },
    });
    expect(root.querySelector('[data-testid=source-errors]')).toBeFalsy();
  });

  it('expands a prefixed seed against the config prefix map before submitting', async () => {
    const { fixture, http } = await setup('/describe', {
      ex: 'http://example.org/',
    });
    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector('input[data-testid=seed-input]') as HTMLInputElement;
    input.value = 'ex:alice';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (root.querySelector('button[data-testid=run-describe]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const req = http.expectOne('/api/describe');
    expect(req.request.body.iri).toBe('http://example.org/alice');
    req.flush({
      iri: 'http://example.org/alice',
      quads: '',
      total: 0,
      perSource: {},
    });
    http.verify();
  });

  it('writes the fully-expanded IRI (not the prefixed form) into the ?iri URL param', async () => {
    const { fixture, http, router } = await setup('/describe', {
      ex: 'http://example.org/',
    });
    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector('input[data-testid=seed-input]') as HTMLInputElement;
    input.value = 'ex:alice';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (root.querySelector('button[data-testid=run-describe]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    const tree = router.parseUrl(router.url);
    expect(tree.queryParamMap.get('iri')).toBe('http://example.org/alice');

    http.expectOne('/api/describe').flush({
      iri: 'http://example.org/alice',
      quads: '',
      total: 0,
      perSource: {},
    });
    http.verify();
  });

  it('shows a validation error and issues no request when the prefix is unknown', async () => {
    const { fixture, http } = await setup('/describe', {
      ex: 'http://example.org/',
    });
    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector('input[data-testid=seed-input]') as HTMLInputElement;
    input.value = 'bogus:alice';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (root.querySelector('button[data-testid=run-describe]') as HTMLButtonElement).click();
    fixture.detectChanges();

    const err = root.querySelector('[data-testid=iri-error]');
    expect(err).toBeTruthy();
    expect(err?.textContent).toContain('bogus');
    http.expectNone('/api/describe');
  });

  it('auto-runs a describe when loaded from a URL carrying ?iri', async () => {
    const { http } = await setup(
      '/describe?iri=' + encodeURIComponent('http://example.org/alice'),
    );
    const req = http.expectOne('/api/describe');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ iri: 'http://example.org/alice' });
    req.flush({
      iri: 'http://example.org/alice',
      quads: '',
      total: 0,
      perSource: { alpha: { count: 0, truncated: false } },
    });
    http.verify();
  });

  it('auto-runs with the ?sources subset when the URL carries iri and sources', async () => {
    const { http } = await setup(
      '/describe?iri=' +
        encodeURIComponent('http://example.org/alice') +
        '&sources=beta',
    );
    const req = http.expectOne('/api/describe');
    expect(req.request.body).toEqual({
      iri: 'http://example.org/alice',
      sources: ['beta'],
    });
    req.flush({
      iri: 'http://example.org/alice',
      quads: '',
      total: 0,
      perSource: { beta: { count: 0, truncated: false } },
    });
    http.verify();
  });

  it('renders the error rows when the request fails with 502 (all sources failed)', async () => {
    const { root } = await runAndFlush(
      {
        iri: 'http://example.org/alice',
        quads: '',
        total: 0,
        perSource: {
          alpha: { count: 0, truncated: false, error: 'boom-alpha' },
          beta: { count: 0, truncated: false, error: 'boom-beta' },
        },
      },
      { status: 502, statusText: 'Bad Gateway' },
    );
    const rows = root.querySelectorAll('[data-testid=source-error-row]');
    expect(rows.length).toBe(2);
    expect(root.querySelector('[data-testid=source-errors]')?.textContent).toContain(
      'boom-alpha',
    );
  });

  describe('inline blank-node nesting + rdf:list collapse (#223)', () => {
    const ALICE = 'http://example.org/alice';

    it('renders a single-use bnode object inline with its nested predicate group', async () => {
      const wire =
        `<${ALICE}> <http://example.org/address> _:b0 .\n` +
        `_:b0 <http://example.org/city> "Paris" .\n`;
      const { root } = await runAndFlush({
        iri: ALICE,
        quads: wire,
        total: 2,
        perSource: { alpha: { count: 2, truncated: false } },
      });
      // One nested bnode block exists somewhere in the rendered sections.
      expect(root.querySelector('[data-testid=nested-bnode]')).toBeTruthy();
      // Outer row + one inner row from the nested predicate group.
      const rows = root.querySelectorAll('[data-testid=describe-row]');
      expect(rows.length).toBe(2);
      // The nested row carries the city literal.
      expect(root.textContent).toContain('Paris');
    });

    it('renders an rdf:list chain as a nested collection block', async () => {
      const RDF_FIRST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first';
      const RDF_REST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest';
      const RDF_NIL = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil';
      const wire =
        `<${ALICE}> <http://example.org/items> _:h0 .\n` +
        `_:h0 <${RDF_FIRST}> <http://example.org/a> .\n` +
        `_:h0 <${RDF_REST}> <${RDF_NIL}> .\n`;
      const { root } = await runAndFlush({
        iri: ALICE,
        quads: wire,
        total: 3,
        perSource: { alpha: { count: 3, truncated: false } },
      });
      expect(root.querySelector('[data-testid=nested-collection]')).toBeTruthy();
      // The collapsed `( … )` body should contain the single item's IRI.
      expect(root.querySelector('[data-testid=nested-collection]')?.textContent)
        .toContain('http://example.org/a');
    });
  });

  describe('blank-node expansion (ADR-0019)', () => {
    const ALICE = 'http://example.org/alice';
    const KNOWS = 'http://example.org/knows';
    const SOURCES_WITH_ENDPOINT: SourceListing['sources'] = [
      { id: 'remote', kind: 'endpoint', label: 'R (endpoint)', default: true },
    ];
    const FS = 'urn:sparqly:fromSource';

    function provQuad(s: string, p: string, oNquad: string, origin: string): string {
      return `<<${s} ${p} ${oNquad}>> <${FS}> "${origin}" .\n`;
    }

    async function setupWithInitialResponse(
      sources: SourceListing['sources'],
      body: object,
    ) {
      const ctx = await setup(
        '/describe?iri=' + encodeURIComponent(ALICE),
        {},
        sources,
      );
      ctx.http.expectOne('/api/describe').flush(body);
      ctx.fixture.detectChanges();
      await ctx.fixture.whenStable();
      ctx.fixture.detectChanges();
      return ctx;
    }

    it('passes endpoint source ids to the sectioned view', async () => {
      const { fixture, http } = await setupWithInitialResponse(
        [
          { id: 'alpha', kind: 'glob', label: 'A (glob)', default: true },
          { id: 'remote', kind: 'endpoint', label: 'R (endpoint)' },
        ],
        { iri: ALICE, quads: NQUADS_SAMPLE, total: 3, perSource: { alpha: { count: 3, truncated: false } } },
      );
      expect(requireDescribeSections(fixture).endpointSourceIds()).toEqual(['remote']);
      http.verify();
    });

    it('re-issues POST /api/describe with the path appended to expandedPaths for that source only', async () => {
      const wire0 =
        `<${ALICE}> <${KNOWS}> _:remote__b0 .\n` +
        provQuad(`<${ALICE}>`, `<${KNOWS}>`, '_:remote__b0', 'remote');
      const { fixture, http } = await setupWithInitialResponse(SOURCES_WITH_ENDPOINT, {
        iri: ALICE,
        quads: wire0,
        total: 1,
        perSource: { remote: { count: 1, truncated: true } },
      });

      requireDescribeSections(fixture).expand.emit({
        sourceId: 'remote',
        path: [{ predicate: KNOWS, inverse: false }],
      });
      fixture.detectChanges();

      const req = http.expectOne('/api/describe');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        iri: ALICE,
        sources: ['remote'],
        expandedPaths: { remote: [[{ predicate: KNOWS, inverse: false }]] },
      });
      req.flush({
        iri: ALICE,
        quads:
          `<${ALICE}> <${KNOWS}> _:remote__b0 .\n` +
          provQuad(`<${ALICE}>`, `<${KNOWS}>`, '_:remote__b0', 'remote') +
          `_:remote__b0 <http://example.org/since> "2021" .\n` +
          provQuad('_:remote__b0', '<http://example.org/since>', '"2021"', 'remote'),
        total: 2,
        perSource: { remote: { count: 2, truncated: false } },
      });
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      // The fresh `_:remote__b0 :since "2021"` quad is not anchored to the seed
      // in subject/object position — flat slice doesn't render bnode subtrees
      // (follow-up slice does), but it must be present in the merged quads.
      const merged = requireDescribeSections(fixture).quads();
      expect(merged.some((q) => q.predicate.value === 'http://example.org/since')).toBe(true);
      http.verify();
    });

    it('replaces only the expanded source’s slice, preserving other sources’ quads', async () => {
      const sources: SourceListing['sources'] = [
        { id: 'remote', kind: 'endpoint', label: 'R', default: true },
        { id: 'other', kind: 'endpoint', label: 'O' },
      ];
      const initial =
        `<${ALICE}> <${KNOWS}> _:remote__b0 .\n` +
        provQuad(`<${ALICE}>`, `<${KNOWS}>`, '_:remote__b0', 'remote') +
        `<${ALICE}> <http://example.org/name> "Alice" .\n` +
        provQuad(`<${ALICE}>`, '<http://example.org/name>', '"Alice"', 'other');
      const { fixture, http } = await setupWithInitialResponse(sources, {
        iri: ALICE,
        quads: initial,
        total: 2,
        perSource: {
          remote: { count: 1, truncated: true },
          other: { count: 1, truncated: false },
        },
      });

      requireDescribeSections(fixture).expand.emit({
        sourceId: 'remote',
        path: [{ predicate: KNOWS, inverse: false }],
      });
      fixture.detectChanges();

      const req = http.expectOne('/api/describe');
      expect(req.request.body.sources).toEqual(['remote']);
      req.flush({
        iri: ALICE,
        quads:
          `<${ALICE}> <${KNOWS}> _:remote__b0 .\n` +
          provQuad(`<${ALICE}>`, `<${KNOWS}>`, '_:remote__b0', 'remote') +
          `_:remote__b0 <http://example.org/since> "2021" .\n` +
          provQuad('_:remote__b0', '<http://example.org/since>', '"2021"', 'remote'),
        total: 2,
        perSource: { remote: { count: 2, truncated: false } },
      });
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const merged = requireDescribeSections(fixture).quads();
      // fresh remote hop spliced in
      expect(merged.some((q) => q.predicate.value === 'http://example.org/since')).toBe(true);
      // the `other` source's quad is preserved
      expect(
        merged.some(
          (q) =>
            q.predicate.value === 'http://example.org/name' &&
            q.object.termType === 'Literal' &&
            q.object.value === 'Alice',
        ),
      ).toBe(true);
      http.verify();
    });

    it('accumulates multiple expansions for the same source in expandedPaths', async () => {
      const wire0 =
        `<${ALICE}> <${KNOWS}> _:remote__b0 .\n` +
        provQuad(`<${ALICE}>`, `<${KNOWS}>`, '_:remote__b0', 'remote') +
        `<${ALICE}> <http://example.org/likes> _:remote__b1 .\n` +
        provQuad(`<${ALICE}>`, '<http://example.org/likes>', '_:remote__b1', 'remote');
      const { fixture, http } = await setupWithInitialResponse(SOURCES_WITH_ENDPOINT, {
        iri: ALICE,
        quads: wire0,
        total: 2,
        perSource: { remote: { count: 2, truncated: true } },
      });

      requireDescribeSections(fixture).expand.emit({
        sourceId: 'remote',
        path: [{ predicate: KNOWS, inverse: false }],
      });
      fixture.detectChanges();
      http.expectOne('/api/describe').flush({
        iri: ALICE,
        quads: wire0,
        total: 2,
        perSource: { remote: { count: 2, truncated: true } },
      });
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      requireDescribeSections(fixture).expand.emit({
        sourceId: 'remote',
        path: [{ predicate: 'http://example.org/likes', inverse: false }],
      });
      fixture.detectChanges();
      const req = http.expectOne('/api/describe');
      expect(req.request.body.expandedPaths).toEqual({
        remote: [
          [{ predicate: KNOWS, inverse: false }],
          [{ predicate: 'http://example.org/likes', inverse: false }],
        ],
      });
      req.flush({ iri: ALICE, quads: wire0, total: 2, perSource: { remote: { count: 2, truncated: true } } });
      http.verify();
    });

    it('clicking the rendered expand-bnode button re-issues describe and splices the slice in', async () => {
      const wire0 =
        `<${ALICE}> <${KNOWS}> _:remote__b0 .\n` +
        provQuad(`<${ALICE}>`, `<${KNOWS}>`, '_:remote__b0', 'remote');
      const { fixture, http } = await setupWithInitialResponse(SOURCES_WITH_ENDPOINT, {
        iri: ALICE,
        quads: wire0,
        total: 1,
        perSource: { remote: { count: 1, truncated: true } },
      });
      const root = fixture.nativeElement as HTMLElement;
      const button = root.querySelector(
        '[data-testid=expand-bnode]',
      ) as HTMLButtonElement | null;
      expect(button).toBeTruthy();
      button!.click();
      fixture.detectChanges();

      const req = http.expectOne('/api/describe');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        iri: ALICE,
        sources: ['remote'],
        expandedPaths: { remote: [[{ predicate: KNOWS, inverse: false }]] },
      });
      req.flush({
        iri: ALICE,
        quads:
          `<${ALICE}> <${KNOWS}> _:remote__b0 .\n` +
          provQuad(`<${ALICE}>`, `<${KNOWS}>`, '_:remote__b0', 'remote') +
          `_:remote__b0 <http://example.org/since> "2021" .\n` +
          provQuad('_:remote__b0', '<http://example.org/since>', '"2021"', 'remote'),
        total: 2,
        perSource: { remote: { count: 2, truncated: false } },
      });
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const merged = requireDescribeSections(fixture).quads();
      expect(merged.some((q) => q.predicate.value === 'http://example.org/since')).toBe(true);
      // After the bnode is expanded, it's no longer dangling — the expand
      // button must disappear from the rendered sections.
      expect(root.querySelector('[data-testid=expand-bnode]')).toBeFalsy();
      http.verify();
    });

    it('does not render an expand button on a glob-source bnode (only endpoint origins qualify)', async () => {
      const sources: SourceListing['sources'] = [
        { id: 'alpha', kind: 'glob', label: 'A (glob)', default: true },
      ];
      const wire =
        `<${ALICE}> <${KNOWS}> _:alpha__b0 .\n` +
        provQuad(`<${ALICE}>`, `<${KNOWS}>`, '_:alpha__b0', 'alpha');
      const { fixture, http } = await setupWithInitialResponse(sources, {
        iri: ALICE,
        quads: wire,
        total: 1,
        perSource: { alpha: { count: 1, truncated: false } },
      });
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('[data-testid=expand-bnode]')).toBeFalsy();
      http.verify();
      void fixture;
    });

    it('does not touch the URL params on expand', async () => {
      const wire0 =
        `<${ALICE}> <${KNOWS}> _:remote__b0 .\n` +
        provQuad(`<${ALICE}>`, `<${KNOWS}>`, '_:remote__b0', 'remote');
      const { fixture, http, router } = await setupWithInitialResponse(SOURCES_WITH_ENDPOINT, {
        iri: ALICE,
        quads: wire0,
        total: 1,
        perSource: { remote: { count: 1, truncated: true } },
      });
      const urlBefore = router.url;
      requireDescribeSections(fixture).expand.emit({
        sourceId: 'remote',
        path: [{ predicate: KNOWS, inverse: false }],
      });
      fixture.detectChanges();
      http.expectOne('/api/describe').flush({ iri: ALICE, quads: wire0, total: 1, perSource: { remote: { count: 1, truncated: true } } });
      fixture.detectChanges();
      await fixture.whenStable();
      expect(router.url).toBe(urlBefore);
      const tree = router.parseUrl(router.url);
      expect([...tree.queryParamMap.keys].sort()).toEqual(['iri']);
      http.verify();
    });
  });

  describe('Turtle/TriG tab', () => {
    function tabIds(root: HTMLElement): (string | null)[] {
      return Array.from(root.querySelectorAll('[data-testid^="tab-"]')).map((el) =>
        el.getAttribute('data-testid'),
      );
    }

    it('shows a table tab and a turtle tab once a default-graph result has loaded; the table is shown by default', async () => {
      const { root } = await runAndFlush({
        iri: 'http://example.org/alice',
        quads: NQUADS_SAMPLE,
        total: 3,
        perSource: { alpha: { count: 3, truncated: false } },
      });
      expect(tabIds(root)).toEqual(['tab-table', 'tab-turtle']);
      expect(root.querySelector('[data-testid=describe-section]')).toBeTruthy();
      expect(root.querySelector('[data-testid="result-formatted-body"]')).toBeFalsy();
    });

    it('labels the tab `trig` when any quad carries a named graph', async () => {
      const { root } = await runAndFlush({
        iri: 'http://example.org/alice',
        quads:
          '<http://example.org/alice> <http://example.org/knows> <http://example.org/bob> <http://example.org/g1> .\n',
        total: 1,
        perSource: { alpha: { count: 1, truncated: false } },
      });
      expect(tabIds(root)).toEqual(['tab-table', 'tab-trig']);
    });

    it('renders the formatted Turtle body when the turtle tab is clicked, hiding the table', async () => {
      const { root, fixture } = await runAndFlush({
        iri: 'http://example.org/alice',
        quads: NQUADS_SAMPLE,
        total: 3,
        perSource: { alpha: { count: 3, truncated: false } },
      });
      (root.querySelector('[data-testid=tab-turtle]') as HTMLButtonElement).click();
      fixture.detectChanges();
      const body = root.querySelector('[data-testid="result-formatted-body"]');
      expect(body).toBeTruthy();
      expect(body?.textContent).toContain('http://example.org/alice');
      expect(body?.textContent).toContain('http://example.org/knows');
      expect(root.querySelector('[data-testid=describe-section]')).toBeFalsy();
    });

    it('strips describe provenance annotations from the displayed Turtle', async () => {
      const wire =
        '<http://example.org/alice> <http://example.org/knows> <http://example.org/bob> .\n' +
        '<<<http://example.org/alice> <http://example.org/knows> <http://example.org/bob>>> <urn:sparqly:fromSource> "alpha" .\n';
      const { root, fixture } = await runAndFlush({
        iri: 'http://example.org/alice',
        quads: wire,
        total: 1,
        perSource: { alpha: { count: 1, truncated: false } },
      });
      (root.querySelector('[data-testid=tab-turtle]') as HTMLButtonElement).click();
      fixture.detectChanges();
      const body =
        root.querySelector('[data-testid="result-formatted-body"]')?.textContent ?? '';
      expect(body).toContain('http://example.org/knows');
      expect(body).not.toContain('fromSource');
    });

    it('does not re-fetch when switching between the table and turtle tabs', async () => {
      const { fixture, http } = await setup();
      const root = fixture.nativeElement as HTMLElement;
      const input = root.querySelector('input[data-testid=seed-input]') as HTMLInputElement;
      input.value = 'http://example.org/alice';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      (root.querySelector('button[data-testid=run-describe]') as HTMLButtonElement).click();
      fixture.detectChanges();
      http.expectOne('/api/describe').flush({
        iri: 'http://example.org/alice',
        quads: NQUADS_SAMPLE,
        total: 3,
        perSource: { alpha: { count: 3, truncated: false } },
      });
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      (root.querySelector('[data-testid=tab-turtle]') as HTMLButtonElement).click();
      fixture.detectChanges();
      (root.querySelector('[data-testid=tab-table]') as HTMLButtonElement).click();
      fixture.detectChanges();

      http.expectNone('/api/describe');
      expect(requireDescribeSections(fixture).quads().length).toBe(3);
      http.verify();
    });

    it('does not show a turtle/trig tab when the result is empty', async () => {
      const { root } = await runAndFlush({
        iri: 'http://example.org/alice',
        quads: '',
        total: 0,
        perSource: { alpha: { count: 0, truncated: false } },
      });
      expect(root.querySelector('[data-testid=tab-table]')).toBeTruthy();
      expect(root.querySelector('[data-testid=tab-turtle]')).toBeFalsy();
      expect(root.querySelector('[data-testid=tab-trig]')).toBeFalsy();
    });
  });
});
