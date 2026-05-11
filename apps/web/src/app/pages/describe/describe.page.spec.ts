import { Component, Input } from '@angular/core';
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

const LISTING: SourceListing = {
  sources: [{ id: 'alpha', kind: 'glob', label: 'A (glob)', default: true }],
};

async function setup(initialUrl = '/describe') {
  const payload: ConfigPayload = {
    sources: LISTING.sources,
    context: { prefixes: {} },
  };
  const configStub: Pick<ConfigService, 'list' | 'config' | 'context'> = {
    list: () => of(LISTING),
    config: () => of(payload),
    context: () => of(payload.context),
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
      remove: { imports: [QuadTableComponent] },
      add: { imports: [QuadTableStub] },
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
    const { fixture } = await setup(
      '/describe?iri=' + encodeURIComponent('http://example.org/alice'),
    );
    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector('input[data-testid=seed-input]') as HTMLInputElement;
    expect(input.value).toBe('http://example.org/alice');
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
    expect(req.request.body).toEqual({ iri: 'http://example.org/alice' });

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
});
