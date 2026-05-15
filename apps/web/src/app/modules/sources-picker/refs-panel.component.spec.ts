import { TestBed } from '@angular/core/testing';
import { RefsPanelComponent, type RefsPanelState } from './refs-panel.component';
import type { RefsResponse } from './refs-api.client';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);

const REFS: RefsResponse = {
  head: { ref: 'HEAD', sha: SHA_A, kind: 'head' },
  branches: [{ ref: 'main', sha: SHA_A, kind: 'branch' }],
  remoteBranches: [
    {
      ref: 'origin/main',
      sha: SHA_B,
      kind: 'remote-branch',
      remote: 'origin',
    },
  ],
  tags: [{ ref: 'v1.0.0', sha: SHA_C, kind: 'tag-annotated' }],
};

function mount(state: RefsPanelState, stagedRef = '') {
  TestBed.configureTestingModule({});
  const fixture = TestBed.createComponent(RefsPanelComponent);
  fixture.componentRef.setInput('state', state);
  fixture.componentRef.setInput('stagedRef', stagedRef);
  fixture.detectChanges();
  return { fixture };
}

describe('RefsPanelComponent', () => {
  it('renders one row per ref across head/branches/remoteBranches/tags', () => {
    const { fixture } = mount({ kind: 'loaded', refs: REFS });
    const root = fixture.nativeElement as HTMLElement;
    const refs = Array.from(root.querySelectorAll('[data-ref]')).map((el) =>
      el.getAttribute('data-ref'),
    );
    expect(refs).toEqual(['HEAD', 'main', 'origin/main', 'v1.0.0']);
  });

  it('renders section headers in order: HEAD → Branches → Remote (<remote>) → Tags', () => {
    const { fixture } = mount({ kind: 'loaded', refs: REFS });
    const root = fixture.nativeElement as HTMLElement;
    const headers = Array.from(root.querySelectorAll('[data-section]')).map(
      (el) => el.getAttribute('data-section'),
    );
    expect(headers).toEqual(['head', 'branches', 'remote:origin', 'tags']);
  });

  it('marks tag-annotated rows as reproducible (★) and leaves floating rows unmarked', () => {
    const refs: RefsResponse = {
      head: REFS.head,
      branches: [{ ref: 'main', sha: SHA_A, kind: 'branch' }],
      remoteBranches: [],
      tags: [
        { ref: 'v1.0.0', sha: SHA_C, kind: 'tag-annotated' },
        { ref: 'light-1.0', sha: SHA_C, kind: 'tag-lightweight' },
      ],
    };
    const { fixture } = mount({ kind: 'loaded', refs });
    const root = fixture.nativeElement as HTMLElement;
    const annotated = root.querySelector('[data-ref="v1.0.0"]') as HTMLElement;
    const light = root.querySelector('[data-ref="light-1.0"]') as HTMLElement;
    const branch = root.querySelector('[data-ref="main"]') as HTMLElement;
    expect(annotated.getAttribute('data-reproducible')).toBe('true');
    expect(light.getAttribute('data-reproducible')).toBeNull();
    expect(branch.getAttribute('data-reproducible')).toBeNull();
    expect(annotated.querySelector('[data-testid="reproducible-mark"]')).toBeTruthy();
    expect(light.querySelector('[data-testid="reproducible-mark"]')).toBeNull();
  });

  it('renders the resolved SHA (abbreviated) next to floating refs (branches, lightweight tags, remote-branches)', () => {
    const refs: RefsResponse = {
      head: { ref: 'HEAD', sha: SHA_A, kind: 'head' },
      branches: [{ ref: 'main', sha: SHA_A, kind: 'branch' }],
      remoteBranches: [
        {
          ref: 'origin/main',
          sha: SHA_B,
          kind: 'remote-branch',
          remote: 'origin',
        },
      ],
      tags: [
        { ref: 'light-1.0', sha: SHA_C, kind: 'tag-lightweight' },
        { ref: 'v1.0.0', sha: SHA_C, kind: 'tag-annotated' },
      ],
    };
    const { fixture } = mount({ kind: 'loaded', refs });
    const root = fixture.nativeElement as HTMLElement;
    const sha = (refSel: string) =>
      (root.querySelector(`[data-ref="${refSel}"] [data-testid="ref-sha"]`)
        ?.textContent ?? '').trim();
    expect(sha('main')).toBe(SHA_A.slice(0, 7));
    expect(sha('origin/main')).toBe(SHA_B.slice(0, 7));
    expect(sha('light-1.0')).toBe(SHA_C.slice(0, 7));
    // Annotated tag is reproducible — no SHA crutch needed.
    expect(
      root.querySelector(`[data-ref="v1.0.0"] [data-testid="ref-sha"]`),
    ).toBeNull();
  });

  it('distinguishes local branch rows from remote-tracking branch rows via data-scope', () => {
    const refs: RefsResponse = {
      head: REFS.head,
      branches: [{ ref: 'main', sha: SHA_A, kind: 'branch' }],
      remoteBranches: [
        {
          ref: 'origin/main',
          sha: SHA_B,
          kind: 'remote-branch',
          remote: 'origin',
        },
      ],
      tags: [],
    };
    const { fixture } = mount({ kind: 'loaded', refs });
    const root = fixture.nativeElement as HTMLElement;
    const local = root.querySelector('[data-ref="main"]') as HTMLElement;
    const remote = root.querySelector('[data-ref="origin/main"]') as HTMLElement;
    expect(local.getAttribute('data-scope')).toBe('local');
    expect(remote.getAttribute('data-scope')).toBe('remote');
  });

  it('clicking a ref row emits stagedRefChange with that ref name', () => {
    const { fixture } = mount({ kind: 'loaded', refs: REFS });
    const root = fixture.nativeElement as HTMLElement;
    const emitted: string[] = [];
    fixture.componentInstance.stagedRefChange.subscribe((v: string) =>
      emitted.push(v),
    );
    (root.querySelector('[data-ref="main"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(emitted).toEqual(['main']);
  });

  it('marks the row whose ref matches stagedRef with aria-selected="true"', () => {
    const { fixture } = mount({ kind: 'loaded', refs: REFS }, 'origin/main');
    const root = fixture.nativeElement as HTMLElement;
    const remote = root.querySelector('[data-ref="origin/main"]') as HTMLElement;
    const branch = root.querySelector('[data-ref="main"]') as HTMLElement;
    expect(remote.getAttribute('aria-selected')).toBe('true');
    expect(branch.getAttribute('aria-selected')).toBeNull();
  });

  it('renders "No git refs available for this source (<kind>)" naming the kind when state is no-git-repo', () => {
    const { fixture } = mount({ kind: 'no-git-repo', sourceKind: 'endpoint' });
    const root = fixture.nativeElement as HTMLElement;
    const msg = root.querySelector('[data-testid="refs-panel-no-git"]');
    expect(msg).toBeTruthy();
    expect(msg?.textContent ?? '').toContain(
      'No git refs available for this source (endpoint)',
    );
    expect(root.querySelector('[data-section]')).toBeNull();
  });

  it('renders one Remote (<remote>) section per distinct remote when the repo has multiple remotes', () => {
    const multiRemote: RefsResponse = {
      ...REFS,
      remoteBranches: [
        {
          ref: 'origin/main',
          sha: SHA_B,
          kind: 'remote-branch',
          remote: 'origin',
        },
        {
          ref: 'upstream/main',
          sha: SHA_C,
          kind: 'remote-branch',
          remote: 'upstream',
        },
      ],
    };
    const { fixture } = mount({ kind: 'loaded', refs: multiRemote });
    const root = fixture.nativeElement as HTMLElement;
    const headers = Array.from(root.querySelectorAll('[data-section]'))
      .map((el) => el.getAttribute('data-section'))
      .filter((s) => s !== null && s.startsWith('remote:'));
    expect(headers).toEqual(['remote:origin', 'remote:upstream']);
    const upstreamHeader = root.querySelector(
      '[data-section="remote:upstream"]',
    );
    expect(upstreamHeader?.textContent).toContain('upstream');
  });
});
