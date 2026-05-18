import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { SourceSnippetComponent } from './source-snippet.component';
import {
  SnippetService,
  type SnippetReadResult,
} from '../services/snippet.service';

function setup(result: SnippetReadResult | Subject<SnippetReadResult>) {
  const fetch = vi.fn().mockReturnValue(result instanceof Subject ? result : of(result));
  TestBed.configureTestingModule({
    imports: [SourceSnippetComponent],
    providers: [{ provide: SnippetService, useValue: { fetch } }],
  });
  return { fetch };
}

function render(inputs: {
  file: string;
  focalStart: number;
  focalEnd?: number;
  context: number;
  records?: { file: string; line: number; endLine?: number }[];
}) {
  const fixture = TestBed.createComponent(SourceSnippetComponent);
  fixture.componentRef.setInput('file', inputs.file);
  fixture.componentRef.setInput('focalStart', inputs.focalStart);
  fixture.componentRef.setInput('focalEnd', inputs.focalEnd ?? inputs.focalStart);
  fixture.componentRef.setInput('context', inputs.context);
  fixture.componentRef.setInput(
    'records',
    inputs.records ?? [
      {
        file: inputs.file,
        line: inputs.focalStart,
        endLine: inputs.focalEnd ?? inputs.focalStart,
      },
    ],
  );
  fixture.detectChanges();
  return fixture;
}

describe('SourceSnippetComponent', () => {
  it('asks SnippetService for its focal range and renders a line-numbered <pre> with the focal line highlighted', () => {
    const { fetch } = setup({
      kind: 'snippet',
      startLine: 3,
      focalStart: 5,
      focalEnd: 5,
      lines: ['line three', 'line four', 'line five', 'line six', 'line seven'],
    });
    const fixture = render({ file: 'file:///tmp/example.ttl', focalStart: 5, context: 2 });

    expect(fetch).toHaveBeenCalledWith(
      'file:///tmp/example.ttl',
      { focalStart: 5, focalEnd: 5 },
      2,
    );

    const root = fixture.nativeElement as HTMLElement;
    const pre = root.querySelector('pre');
    expect(pre).toBeTruthy();
    const rows = Array.from(
      pre?.querySelectorAll('[data-testid=snippet-line]') ?? [],
    ) as HTMLElement[];
    expect(rows.map((r) => r.getAttribute('data-line-number'))).toEqual(['3', '4', '5', '6', '7']);
    expect(rows.map((r) => r.textContent?.includes('line three'))).toContain(true);

    const focal = rows.filter((r) => r.getAttribute('data-focal') === 'true');
    expect(focal.length).toBe(1);
    expect(focal[0].getAttribute('data-line-number')).toBe('5');
  });

  it('passes focalEnd through to SnippetService for a multi-line focal range and highlights every focal line', () => {
    const { fetch } = setup({
      kind: 'snippet',
      startLine: 3,
      focalStart: 4,
      focalEnd: 6,
      lines: ['L3', 'L4', 'L5', 'L6', 'L7'],
    });
    const fixture = render({ file: 'file:///tmp/x.ttl', focalStart: 4, focalEnd: 6, context: 1 });

    expect(fetch).toHaveBeenCalledWith('file:///tmp/x.ttl', { focalStart: 4, focalEnd: 6 }, 1);

    const root = fixture.nativeElement as HTMLElement;
    const rows = Array.from(
      root.querySelectorAll('[data-testid=snippet-line]'),
    ) as HTMLElement[];
    const focal = rows.filter((r) => r.getAttribute('data-focal') === 'true');
    expect(focal.map((r) => r.getAttribute('data-line-number'))).toEqual(['4', '5', '6']);

    const fileLabel = root.querySelector('[data-testid=snippet-file]');
    expect(fileLabel?.textContent).toContain('file:///tmp/x.ttl:4-6');
  });

  it('lays out content lines so the focal highlight extends across the full scrollable width', () => {
    setup({
      kind: 'snippet',
      startLine: 3,
      focalStart: 4,
      focalEnd: 4,
      lines: ['L3', 'L4 ' + 'x'.repeat(500), 'L5'],
    });
    const fixture = render({ file: 'file:///tmp/x.ttl', focalStart: 4, context: 1 });

    const root = fixture.nativeElement as HTMLElement;
    const rows = Array.from(
      root.querySelectorAll('pre [data-testid=snippet-line]'),
    ) as HTMLElement[];
    for (const row of rows) {
      expect(row.classList.contains('w-max')).toBe(true);
      expect(row.classList.contains('min-w-full')).toBe(true);
    }
  });

  it('renders "(source file unavailable)" when the snippet result is the fallback unavailable variant', () => {
    setup({ kind: 'unavailable', reason: 'missing' });
    const fixture = render({ file: 'file:///tmp/missing.ttl', focalStart: 1, context: 2 });

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('pre')).toBeFalsy();
    expect(
      root.querySelector('[data-testid=snippet-unavailable]')?.textContent,
    ).toContain('(source file unavailable)');
  });

  it('renders a structured file-read failure showing the path and reason (user story 7)', () => {
    setup({ kind: 'file-read', file: '/abs/path/gone.ttl', reason: 'missing' });
    const fixture = render({ file: 'file:///abs/path/gone.ttl', focalStart: 1, context: 0 });

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('pre')).toBeFalsy();
    const fileRead = root.querySelector('[data-testid=snippet-file-read]');
    expect(fileRead).toBeTruthy();
    expect(fileRead?.textContent).toContain('/abs/path/gone.ttl');
    expect(fileRead?.textContent).toContain('missing');
  });

  it('renders a structured range-out-of-bounds failure quoting the offending spec', () => {
    setup({ kind: 'range-out-of-bounds', spec: '999' });
    const fixture = render({ file: 'file:///tmp/x.ttl', focalStart: 999, context: 0 });

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('pre')).toBeFalsy();
    const oob = root.querySelector('[data-testid=snippet-range-out-of-bounds]');
    expect(oob).toBeTruthy();
    expect(oob?.textContent).toContain('999');
  });

  it('does not mark gap lines between disjoint contributing records as focal', () => {
    // Two records cover lines 10 and 14 with no record on 11/12/13. The
    // outer focal pair (10..14) is the read window the server fetched, but
    // the renderer must paint only lines covered by some contributing
    // record — gap lines render as plain context.
    setup({
      kind: 'snippet',
      startLine: 8,
      focalStart: 10,
      focalEnd: 14,
      lines: ['L8', 'L9', 'L10', 'L11', 'L12', 'L13', 'L14', 'L15', 'L16'],
    });
    const fixture = render({
      file: 'file:///tmp/x.ttl',
      focalStart: 10,
      focalEnd: 14,
      context: 2,
      records: [
        { file: 'file:///tmp/x.ttl', line: 10 },
        { file: 'file:///tmp/x.ttl', line: 14 },
      ],
    });

    const root = fixture.nativeElement as HTMLElement;
    const rows = Array.from(
      root.querySelectorAll('[data-testid=snippet-line]'),
    ) as HTMLElement[];
    const focal = rows.filter((r) => r.getAttribute('data-focal') === 'true');
    expect(focal.map((r) => r.getAttribute('data-line-number'))).toEqual(['10', '14']);
    const gap = rows.filter((r) => {
      const n = Number(r.getAttribute('data-line-number'));
      return n >= 11 && n <= 13;
    });
    for (const row of gap) {
      expect(row.getAttribute('data-focal')).toBeNull();
    }
  });

  it('shows neither the <pre> nor the unavailable note until the result arrives', () => {
    const pending = new Subject<SnippetReadResult>();
    setup(pending);
    const fixture = render({ file: 'file:///tmp/x.ttl', focalStart: 1, context: 1 });

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('pre')).toBeFalsy();
    expect(root.querySelector('[data-testid=snippet-unavailable]')).toBeFalsy();

    pending.next({ kind: 'snippet', startLine: 1, focalStart: 1, focalEnd: 1, lines: ['L1'] });
    fixture.detectChanges();
    expect(root.querySelector('pre')).toBeTruthy();
  });
});
