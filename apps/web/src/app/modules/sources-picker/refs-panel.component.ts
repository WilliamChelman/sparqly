import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  EventEmitter,
  input,
  Output,
} from '@angular/core';
import type { RefEntry, RefsResponse } from './refs-api.client';

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
  template: `
    @let s = state();
    @if (s.kind === 'no-git-repo') {
      <p data-testid="refs-panel-no-git">
        No git refs available for this source ({{ s.sourceKind }})
      </p>
    }
    @if (s.kind === 'loaded') {
      <div
        data-testid="refs-panel"
        [tabindex]="-1"
        (keydown.arrowdown)="move(1, $event)"
        (keydown.arrowup)="move(-1, $event)"
      >
        <h3 data-section="head">HEAD</h3>
        <ul class="list-none">
          <ng-container
            *ngTemplateOutlet="row; context: { $implicit: s.refs.head, scope: 'head' }"
          />
        </ul>
        @if (s.refs.branches.length > 0) {
          <h3 data-section="branches">Branches</h3>
          <ul class="list-none">
            @for (b of s.refs.branches; track b.ref) {
              <ng-container
                *ngTemplateOutlet="row; context: { $implicit: b, scope: 'local' }"
              />
            }
          </ul>
        }
        @for (group of remoteSections(); track group.remote) {
          <h3 [attr.data-section]="'remote:' + group.remote">
            Remote ({{ group.remote }})
          </h3>
          <ul class="list-none">
            @for (rb of group.entries; track rb.ref) {
              <ng-container
                *ngTemplateOutlet="row; context: { $implicit: rb, scope: 'remote' }"
              />
            }
          </ul>
        }
        @if (s.refs.tags.length > 0) {
          <h3 data-section="tags">Tags</h3>
          <ul class="list-none">
            @for (t of s.refs.tags; track t.ref) {
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
          (click)="onPick(entry.ref)"
        >
          <span>{{ entry.ref }}</span>
          @if (isReproducible(entry)) {
            <span data-testid="reproducible-mark" aria-hidden="true">★</span>
          } @else {
            <span data-testid="ref-sha" class="text-foreground-faint">{{
              shortSha(entry.sha)
            }}</span>
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

  readonly remoteSections = computed<ReadonlyArray<RemoteSection>>(() => {
    const s = this.state();
    return s.kind === 'loaded' ? groupRemotes(s.refs) : [];
  });

  readonly flatRefs = computed<ReadonlyArray<string>>(() => {
    const s = this.state();
    if (s.kind !== 'loaded') return [];
    return [
      s.refs.head.ref,
      ...s.refs.branches.map((b) => b.ref),
      ...this.remoteSections().flatMap((g) => g.entries.map((e) => e.ref)),
      ...s.refs.tags.map((t) => t.ref),
    ];
  });

  @Output() readonly stagedRefChange = new EventEmitter<string>();

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
}
