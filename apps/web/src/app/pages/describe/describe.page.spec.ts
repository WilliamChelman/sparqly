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
import { QuadTableComponent } from './components/quad-table.component';
import { MultiSourcesPickerComponent } from '@app/modules/multi-sources-picker';

@Component({
  selector: 'app-quad-table',
  standalone: true,
  template: `<div
    data-testid="stub-quad-table"
    [attr.data-quads-text]="quadsText"
    [attr.data-seed]="seed"
  ></div>`,
})
class QuadTableStub {
  @Input() quadsText = '';
  @Input() seed = '';
}

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
) {
  const payload: ConfigPayload = {
    sources: LISTING.sources,
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
    list: () => of(LISTING),
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
      remove: { imports: [QuadTableComponent, MultiSourcesPickerComponent] },
      add: { imports: [QuadTableStub, MultiSourcesPickerStub] },
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

function quadTableStub(fixture: {
  debugElement: import('@angular/core').DebugElement;
}): QuadTableStub | null {
  const all = fixture.debugElement
    .queryAll((n) => n.componentInstance instanceof QuadTableStub)
    .map((d) => d.componentInstance as QuadTableStub);
  return all[0] ?? null;
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

    const stub = quadTableStub(fixture);
    expect(stub).toBeTruthy();
    expect(stub?.quadsText).toBe(NQUADS_SAMPLE);
    expect(stub?.seed).toBe('http://example.org/alice');
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
    // The successful source's results still render in the quad table above.
    const table = quadTableStub(fixture);
    expect(table?.quadsText).toBe(NQUADS_SAMPLE);
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
});
