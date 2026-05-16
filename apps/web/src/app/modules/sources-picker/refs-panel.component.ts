import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  EventEmitter,
  inject,
  input,
  Output,
} from '@angular/core';
import type { RefEntry, RefsResponse } from './refs-api.client';
import { searchRefs } from './ref-search';

interface RemoteSection {
  readonly remote: string;
  readonly entries: ReadonlyArray<RefEntry>;
}

const FULL_SHA = /^[0-9a-f]{40}$/i;

export function isReproducibleEntry(entry: RefEntry): boolean {
  return entry.kind === 'tag-annotated' || FULL_SHA.test(entry.ref);
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function groupRemotes(refs: RefsResponse): ReadonlyArray<RemoteSection> {
  const order: string[] = [];
  const groups = new Map<string, RefEntry[]>();
  for (const entry of refs.remoteBranches) {
    const remote = entry.remote ?? 'origin';
    if (!groups.has(remote)) {
      order.push(remote);
      groups.set(remote, []);
    }
    groups.get(remote)!.push(entry);
  }
  return order.map((remote) => ({ remote, entries: groups.get(remote)! }));
}

export type RefsPanelState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; refs: RefsResponse }
  | { kind: 'no-git-repo'; sourceKind: string };

@Component({
  selector: 'app-refs-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full flex-col overflow-hidden' },
  template: `
    @let s = state();
    @if (s.kind !== 'no-git-repo') {
      <div class="flex flex-col gap-1.5 border-b border-border p-3">
        <div class="flex items-center gap-2">
          <input
            data-testid="refs-search"
            type="text"
            placeholder="Search refs…"
            class="min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-foreground-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            [value]="refSearch()"
            (input)="onSearchInput($event)"
            (keydown.enter)="onEnter($event)"
          />
          @if (stagedRef() !== '') {
            <button
              type="button"
              data-testid="refs-clear"
              title="Clear selected ref"
              class="shrink-0 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-foreground-muted hover:border-foreground-faint hover:text-foreground"
              (click)="onClear()"
            >Clear</button>
          }
          <button
            type="button"
            data-testid="refs-refresh"
            class="shrink-0 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-foreground hover:border-foreground-faint"
            (click)="refresh.emit()"
          >⟳ Refresh remotes</button>
        </div>
        <p class="text-[11px] text-foreground-faint">
          Press <kbd class="rounded border border-border bg-surface-sunken px-1 font-mono text-[10px]">Enter</kbd>
          to use a custom ref (e.g. <code class="font-mono">HEAD~3</code> or a SHA).
        </p>
      </div>
      @if (refreshError(); as kind) {
        <p
          data-testid="refs-refresh-error"
          class="border-b border-border bg-surface-sunken px-3 py-2 text-[12px] text-foreground-muted"
        >Refresh failed ({{ kind }})</p>
      }
    }
    @if (s.kind === 'no-git-repo') {
      <p
        data-testid="refs-panel-no-git"
        class="p-4 text-[13px] text-foreground-muted"
      >
        No git refs available for this source ({{ s.sourceKind }})
      </p>
    }
    @if (s.kind === 'loaded') {
      @let view = filtered();
      <div
        data-testid="refs-panel"
        class="flex-1 overflow-y-auto p-1.5"
        [tabindex]="-1"
        (keydown.arrowdown)="move(1, $event)"
        (keydown.arrowup)="move(-1, $event)"
      >
        @if (view.head; as headRef) {
          <h3
            data-section="head"
            class="px-2.5 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground-faint"
          >HEAD</h3>
          <ul class="list-none">
            <ng-container
              *ngTemplateOutlet="row; context: { $implicit: headRef, scope: 'head' }"
            />
          </ul>
        }
        @if (view.branches.length > 0) {
          <h3
            data-section="branches"
            class="px-2.5 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground-faint"
          >Branches</h3>
          <ul class="list-none">
            @for (b of view.branches; track b.ref) {
              <ng-container
                *ngTemplateOutlet="row; context: { $implicit: b, scope: 'local' }"
              />
            }
          </ul>
        }
        @for (group of remoteSections(); track group.remote) {
          <h3
            [attr.data-section]="'remote:' + group.remote"
            class="px-2.5 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground-faint"
          >Remote ({{ group.remote }})</h3>
          <ul class="list-none">
            @for (rb of group.entries; track rb.ref) {
              <ng-container
                *ngTemplateOutlet="row; context: { $implicit: rb, scope: 'remote' }"
              />
            }
          </ul>
        }
        @if (view.tags.length > 0) {
          <h3
            data-section="tags"
            class="px-2.5 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-foreground-faint"
          >Tags</h3>
          <ul class="list-none">
            @for (t of view.tags; track t.ref) {
              <ng-container
                *ngTemplateOutlet="row; context: { $implicit: t, scope: 'tag' }"
              />
            }
          </ul>
        }
      </div>
    }

    <ng-template #row let-entry let-scope="scope">
      <li>
        <button
          type="button"
          [attr.data-ref]="entry.ref"
          [attr.data-scope]="scope"
          [attr.data-reproducible]="isReproducible(entry) ? 'true' : null"
          [attr.aria-selected]="stagedRef() === entry.ref ? 'true' : null"
          [attr.tabindex]="stagedRef() === entry.ref ? 0 : -1"
          class="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-foreground-muted hover:bg-surface-sunken hover:text-foreground aria-selected:bg-surface-sunken aria-selected:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
          (click)="onPick(entry.ref)"
        >
          <span class="min-w-0 truncate font-mono">{{ entry.ref }}</span>
          @if (isReproducible(entry)) {
            <span
              data-testid="reproducible-mark"
              aria-hidden="true"
              class="shrink-0 text-foreground-faint"
            >★</span>
          } @else {
            <span
              data-testid="ref-sha"
              class="shrink-0 font-mono text-[11px] text-foreground-faint"
            >{{ shortSha(entry.sha) }}</span>
          }
        </button>
      </li>
    </ng-template>
  `,
  imports: [NgTemplateOutlet],
})
export class RefsPanelComponent {
  readonly state = input.required<RefsPanelState>();
  readonly stagedRef = input<string>('');
  readonly refSearch = input<string>('');
  readonly refreshError = input<string | null>(null);

  readonly filtered = computed<RefsResponse>(() => {
    const s = this.state();
    if (s.kind !== 'loaded') {
      return { branches: [], remoteBranches: [], tags: [] };
    }
    return searchRefs(s.refs, this.refSearch());
  });

  readonly remoteSections = computed<ReadonlyArray<RemoteSection>>(() =>
    groupRemotes(this.filtered()),
  );

  readonly flatRefs = computed<ReadonlyArray<string>>(() => {
    const view = this.filtered();
    return [
      ...(view.head !== undefined ? [view.head.ref] : []),
      ...view.branches.map((b) => b.ref),
      ...this.remoteSections().flatMap((g) => g.entries.map((e) => e.ref)),
      ...view.tags.map((t) => t.ref),
    ];
  });

  @Output() readonly stagedRefChange = new EventEmitter<string>();
  @Output() readonly refSearchChange = new EventEmitter<string>();
  @Output() readonly appliedRef = new EventEmitter<string>();
  @Output() readonly refresh = new EventEmitter<void>();

  private readonly host = inject(ElementRef<HTMLElement>);
  private lastScrolledRef = '';

  constructor() {
    afterNextRender(() => this.scrollStagedIntoView('auto'));
    effect(() => {
      const ref = this.stagedRef();
      const loaded = this.state().kind === 'loaded';
      if (!loaded || ref === '') return;
      if (ref === this.lastScrolledRef) return;
      queueMicrotask(() => this.scrollStagedIntoView('smooth'));
    });
  }

  private scrollStagedIntoView(behavior: ScrollBehavior): void {
    const ref = this.stagedRef();
    if (ref === '') return;
    const root = this.host.nativeElement as HTMLElement;
    const el = Array.from(root.querySelectorAll<HTMLElement>('[data-ref]')).find(
      (node) => node.getAttribute('data-ref') === ref,
    );
    if (el === undefined) return;
    if (typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', behavior });
    }
    this.lastScrolledRef = ref;
  }

  move(delta: number, ev: Event): void {
    ev.preventDefault();
    ev.stopPropagation();
    const refs = this.flatRefs();
    if (refs.length === 0) return;
    const current = refs.indexOf(this.stagedRef());
    const nextIdx =
      current === -1
        ? delta > 0
          ? 0
          : refs.length - 1
        : (current + delta + refs.length) % refs.length;
    this.stagedRefChange.emit(refs[nextIdx]);
  }

  isReproducible(entry: RefEntry): boolean {
    return isReproducibleEntry(entry);
  }

  shortSha(sha: string): string {
    return shortSha(sha);
  }

  onPick(ref: string): void {
    this.stagedRefChange.emit(ref);
  }

  onSearchInput(ev: Event): void {
    const target = ev.target as HTMLInputElement;
    this.refSearchChange.emit(target.value);
  }

  onClear(): void {
    this.stagedRefChange.emit('');
  }

  onEnter(ev: Event): void {
    ev.preventDefault();
    const staged = this.stagedRef();
    if (staged !== '') {
      this.appliedRef.emit(staged);
      return;
    }
    const typed = this.refSearch();
    if (typed !== '') {
      this.appliedRef.emit(typed);
    }
  }
}
