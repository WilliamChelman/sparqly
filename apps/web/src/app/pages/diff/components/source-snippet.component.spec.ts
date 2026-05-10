import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { SourceSnippetComponent } from './source-snippet.component';

function setup() {
  TestBed.configureTestingModule({
    imports: [SourceSnippetComponent],
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return { http: TestBed.inject(HttpTestingController) };
}

function render(inputs: {
  file: string;
  focalStart: number;
  focalEnd?: number;
  context: number;
}) {
  const fixture = TestBed.createComponent(SourceSnippetComponent);
  fixture.componentRef.setInput('file', inputs.file);
  fixture.componentRef.setInput('focalStart', inputs.focalStart);
  fixture.componentRef.setInput('focalEnd', inputs.focalEnd ?? inputs.focalStart);
  fixture.componentRef.setInput('context', inputs.context);
  fixture.detectChanges();
  return fixture;
}

describe('SourceSnippetComponent', () => {
  it('renders a line-numbered <pre> with the focal line highlighted on a 200 snippet payload', () => {
    const { http } = setup();
    const fixture = render({
      file: 'file:///tmp/example.ttl',
      focalStart: 5,
      context: 2,
    });

    const req = http.expectOne(
      (r) => r.url.split('?')[0] === '/api/source-snippet',
    );
    req.flush({
      kind: 'snippet',
      startLine: 3,
      focalStart: 5,
      focalEnd: 5,
      lines: ['line three', 'line four', 'line five', 'line six', 'line seven'],
    });
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const pre = root.querySelector('pre');
    expect(pre).toBeTruthy();

    const rows = Array.from(
      pre?.querySelectorAll('[data-testid=snippet-line]') ?? [],
    ) as HTMLElement[];
    expect(rows.length).toBe(5);

    expect(rows.map((r) => r.getAttribute('data-line-number'))).toEqual([
      '3',
      '4',
      '5',
      '6',
      '7',
    ]);
    expect(rows.map((r) => r.textContent?.includes('line three'))).toContain(
      true,
    );

    const focal = rows.filter((r) => r.getAttribute('data-focal') === 'true');
    expect(focal.length).toBe(1);
    expect(focal[0].getAttribute('data-line-number')).toBe('5');

    http.verify();
  });

  it('forwards file/line/snippetContext as query params on the GET (single-line focal)', () => {
    const { http } = setup();
    render({ file: 'file:///tmp/x.ttl', focalStart: 12, context: 4 });
    const req = http.expectOne(
      (r) => r.url.split('?')[0] === '/api/source-snippet',
    );
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('file')).toBe('file:///tmp/x.ttl');
    expect(req.request.params.get('line')).toBe('12');
    expect(req.request.params.get('endLine')).toBeNull();
    expect(req.request.params.get('snippetContext')).toBe('4');
    req.flush({
      kind: 'snippet',
      startLine: 12,
      focalStart: 12,
      focalEnd: 12,
      lines: ['x'],
    });
    http.verify();
  });

  it('forwards `endLine` query param when focalEnd > focalStart', () => {
    const { http } = setup();
    render({
      file: 'file:///tmp/x.ttl',
      focalStart: 12,
      focalEnd: 15,
      context: 4,
    });
    const req = http.expectOne(
      (r) => r.url.split('?')[0] === '/api/source-snippet',
    );
    expect(req.request.params.get('line')).toBe('12');
    expect(req.request.params.get('endLine')).toBe('15');
    req.flush({
      kind: 'snippet',
      startLine: 8,
      focalStart: 12,
      focalEnd: 15,
      lines: ['L8', 'L9', 'L10', 'L11', 'L12', 'L13', 'L14', 'L15', 'L16', 'L17', 'L18', 'L19'],
    });
    http.verify();
  });

  it('highlights every line in the focal range when focalEnd > focalStart', () => {
    const { http } = setup();
    const fixture = render({
      file: 'file:///tmp/x.ttl',
      focalStart: 4,
      focalEnd: 6,
      context: 1,
    });
    const req = http.expectOne(
      (r) => r.url.split('?')[0] === '/api/source-snippet',
    );
    req.flush({
      kind: 'snippet',
      startLine: 3,
      focalStart: 4,
      focalEnd: 6,
      lines: ['L3', 'L4', 'L5', 'L6', 'L7'],
    });
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const rows = Array.from(
      root.querySelectorAll('[data-testid=snippet-line]'),
    ) as HTMLElement[];
    const focal = rows.filter((r) => r.getAttribute('data-focal') === 'true');
    expect(focal.map((r) => r.getAttribute('data-line-number'))).toEqual([
      '4',
      '5',
      '6',
    ]);

    const fileLabel = root.querySelector('[data-testid=snippet-file]');
    expect(fileLabel?.textContent).toContain('file:///tmp/x.ttl:4-6');
    http.verify();
  });

  it('renders "(source file unavailable)" when the payload is unavailable', () => {
    const { http } = setup();
    const fixture = render({
      file: 'file:///tmp/missing.ttl',
      focalStart: 1,
      context: 2,
    });
    const req = http.expectOne(
      (r) => r.url.split('?')[0] === '/api/source-snippet',
    );
    req.flush({ kind: 'unavailable', reason: 'beyond-eof' });
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('pre')).toBeFalsy();
    expect(
      root.querySelector('[data-testid=snippet-unavailable]')?.textContent,
    ).toContain('(source file unavailable)');
    http.verify();
  });

  it('renders "(source file unavailable)" when the GET returns 404', () => {
    const { http } = setup();
    const fixture = render({
      file: 'file:///tmp/gone.ttl',
      focalStart: 1,
      context: 2,
    });
    const req = http.expectOne(
      (r) => r.url.split('?')[0] === '/api/source-snippet',
    );
    req.flush({ kind: 'unavailable', reason: 'missing' }, {
      status: 404,
      statusText: 'Not Found',
    });
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('pre')).toBeFalsy();
    expect(
      root.querySelector('[data-testid=snippet-unavailable]')?.textContent,
    ).toContain('(source file unavailable)');
    http.verify();
  });
});
