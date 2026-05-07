import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { SourceSnippet } from './source-snippet';

function setup() {
  TestBed.configureTestingModule({
    imports: [SourceSnippet],
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return { http: TestBed.inject(HttpTestingController) };
}

function render(inputs: { file: string; line: number; context: number }) {
  const fixture = TestBed.createComponent(SourceSnippet);
  fixture.componentRef.setInput('file', inputs.file);
  fixture.componentRef.setInput('line', inputs.line);
  fixture.componentRef.setInput('context', inputs.context);
  fixture.detectChanges();
  return fixture;
}

describe('SourceSnippet', () => {
  it('renders a line-numbered <pre> with the focal line highlighted on a 200 snippet payload', () => {
    const { http } = setup();
    const fixture = render({
      file: 'file:///tmp/example.ttl',
      line: 5,
      context: 2,
    });

    const req = http.expectOne(
      (r) => r.url.split('?')[0] === '/api/source-snippet',
    );
    req.flush({
      kind: 'snippet',
      startLine: 3,
      focalLine: 5,
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

  it('forwards file/line/context as query params on the GET', () => {
    const { http } = setup();
    render({ file: 'file:///tmp/x.ttl', line: 12, context: 4 });
    const req = http.expectOne(
      (r) => r.url.split('?')[0] === '/api/source-snippet',
    );
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('file')).toBe('file:///tmp/x.ttl');
    expect(req.request.params.get('line')).toBe('12');
    expect(req.request.params.get('context')).toBe('4');
    req.flush({
      kind: 'snippet',
      startLine: 12,
      focalLine: 12,
      lines: ['x'],
    });
    http.verify();
  });

  it('renders "(source file unavailable)" when the payload is unavailable', () => {
    const { http } = setup();
    const fixture = render({
      file: 'file:///tmp/missing.ttl',
      line: 1,
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
      line: 1,
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
