import { TestBed } from '@angular/core/testing';
import {
  CommitsPanelComponent,
  type CommitsPanelState,
} from './commits-panel.component';
import type { CommitsResponse } from './refs-api.client';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

const COMMITS: CommitsResponse = {
  commits: [
    {
      sha: SHA_A,
      shortSha: SHA_A.slice(0, 7),
      subject: 'add foaf vocab',
      authorName: 'Alice',
      authorDate: '2026-05-25T10:00:00Z',
      parents: [SHA_B],
    },
    {
      sha: SHA_B,
      shortSha: SHA_B.slice(0, 7),
      subject: 'initial',
      authorName: 'Bob',
      authorDate: '2026-05-20T10:00:00Z',
      parents: [],
    },
  ],
  nextBefore: null,
};

function mount(state: CommitsPanelState, now = new Date('2026-05-27T12:00:00Z')) {
  TestBed.configureTestingModule({});
  const fixture = TestBed.createComponent(CommitsPanelComponent);
  fixture.componentRef.setInput('state', state);
  fixture.componentRef.setInput('now', now);
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance };
}

describe('CommitsPanelComponent', () => {
  it('renders one row per commit, newest first', () => {
    const { fixture } = mount({ kind: 'loaded', commits: COMMITS });
    const root = fixture.nativeElement as HTMLElement;
    const rows = Array.from(root.querySelectorAll('[data-commit-sha]')).map(
      (el) => el.getAttribute('data-commit-sha'),
    );
    expect(rows).toEqual([SHA_A, SHA_B]);
  });

  it('renders row text as [shortSha] subject · author · relative date', () => {
    const { fixture } = mount({ kind: 'loaded', commits: COMMITS });
    const root = fixture.nativeElement as HTMLElement;
    const row = root.querySelector(
      `[data-commit-sha="${SHA_A}"]`,
    ) as HTMLElement;
    const text = row.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(text).toContain(SHA_A.slice(0, 7));
    expect(text).toContain('add foaf vocab');
    expect(text).toContain('Alice');
    expect(text).toContain('2 days ago');
  });

  it('surfaces the absolute timestamp on hover via title=', () => {
    const { fixture } = mount({ kind: 'loaded', commits: COMMITS });
    const root = fixture.nativeElement as HTMLElement;
    const dateEl = root.querySelector(
      `[data-commit-sha="${SHA_A}"] [data-testid="commit-date"]`,
    ) as HTMLElement;
    expect(dateEl.getAttribute('title')).toBe('2026-05-25T10:00:00Z');
  });

  it('emits the full 40-hex SHA when a row is clicked', () => {
    const { fixture, component } = mount({ kind: 'loaded', commits: COMMITS });
    const picks: string[] = [];
    component.commitPicked.subscribe((sha) => picks.push(sha));
    const root = fixture.nativeElement as HTMLElement;
    const row = root.querySelector(
      `[data-commit-sha="${SHA_A}"]`,
    ) as HTMLElement;
    row.click();
    expect(picks).toEqual([SHA_A]);
  });

  it('renders a section header so the panel reads as the Commits section', () => {
    const { fixture } = mount({ kind: 'loaded', commits: COMMITS });
    const root = fixture.nativeElement as HTMLElement;
    const header = root.querySelector('[data-section="commits"]');
    expect(header?.textContent?.toLowerCase()).toContain('commits');
  });

  it('renders a loading placeholder while state is loading', () => {
    const { fixture } = mount({ kind: 'loading' });
    const root = fixture.nativeElement as HTMLElement;
    expect(
      root.querySelector('[data-testid="commits-loading"]'),
    ).toBeTruthy();
  });

  it('renders inline error text when state is bad-ref / git-io', () => {
    const { fixture } = mount({ kind: 'error', kindLabel: 'bad-ref' });
    const root = fixture.nativeElement as HTMLElement;
    const err = root.querySelector('[data-testid="commits-error"]');
    expect(err?.textContent).toMatch(/bad-ref/i);
  });

  it('renders nothing visible when state is idle (no source selected)', () => {
    const { fixture } = mount({ kind: 'idle' });
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-commit-sha]')).toBeNull();
    expect(root.querySelector('[data-testid="commits-loading"]')).toBeNull();
  });
});
