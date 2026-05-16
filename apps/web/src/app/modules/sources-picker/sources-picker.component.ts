import {
  ChangeDetectionStrategy,
  Component,
  computed,
  EventEmitter,
  inject,
  Input,
  OnInit,
  Output,
  signal,
} from '@angular/core';
import { ConfigService, type SourceListingEntry } from '@app/core';
import { EyebrowComponent } from '@app/modules/eyebrow';
import { SourcesPickerOverlayComponent } from './sources-picker-overlay.component';

function splitPinnedAddress(value: string): { id: string; ref?: string } {
  if (!value.startsWith('@')) return { id: value };
  const body = value.slice(1);
  const lastColon = body.lastIndexOf(':');
  if (lastColon === -1) return { id: body };
  const id = body.slice(0, lastColon);
  const ref = body.slice(lastColon + 1);
  if (id.length === 0 || ref.length === 0) return { id: body };
  return { id, ref };
}

@Component({
  selector: 'app-sources-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EyebrowComponent, SourcesPickerOverlayComponent],
  host: { class: 'relative inline-block' },
  template: `
    @if (sources() === null) {
      <span class="text-sm text-foreground-faint">loading sources…</span>
    } @else {
      <button
        type="button"
        data-testid="sources-picker-trigger"
        class="inline-flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-surface py-2 pl-3 pr-3.5 text-[13px] text-foreground shadow-sm transition-[border-color,box-shadow,transform] duration-200 hover:border-foreground-faint active:translate-y-[0.5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        [attr.aria-haspopup]="'dialog'"
        [attr.aria-expanded]="open()"
        (click)="toggle()"
      >
        <span app-eyebrow>{{ label }}</span>
        <span class="h-3.5 w-px bg-border" aria-hidden="true"></span>
        <span
          class="font-sans font-medium"
          [class.text-foreground-faint]="selectedId() === ''"
          >{{ triggerLabel() }}</span
        >
        @if (parsedValue().ref; as ref) {
          <span
            data-testid="pinned-ref-chip"
            class="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[10px] text-foreground-muted"
            >@{{ ref }}</span
          >
        }
        <svg
          class="h-2.5 w-2.5 text-foreground-muted transition-transform duration-200"
          [class.rotate-180]="open()"
          viewBox="0 0 10 10"
          aria-hidden="true"
        >
          <path
            d="M2 4 L5 7 L8 4"
            stroke="currentColor"
            stroke-width="1.4"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      @if (allowEmpty && selectedId() !== '') {
        <button
          type="button"
          data-testid="sources-picker-clear"
          [attr.aria-label]="'Clear ' + label"
          class="ml-1 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-border bg-surface text-foreground-muted hover:border-foreground-faint hover:text-foreground"
          (click)="clear($event)"
        >
          <svg class="h-2.5 w-2.5" viewBox="0 0 10 10" aria-hidden="true">
            <path
              d="M2 2 L8 8 M8 2 L2 8"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
            />
          </svg>
        </button>
      }
      @if (parsedValue().ref; as ref) {
        @if (isFloatingRefShape(ref)) {
          <p
            data-testid="floating-ref-note"
            class="mt-1 text-[11px] text-foreground-faint"
          >
            <code class="font-mono">@{{ ref }}</code> is a moving ref — click
            Refresh Remotes to pick up a new tip.
          </p>
        }
      }
      @if (open()) {
        <app-sources-picker-overlay
          [sources]="sources() ?? []"
          [initialSelectedId]="parsedValue().id"
          [initialRef]="parsedValue().ref ?? ''"
          (applied)="onApplied($event)"
          (canceled)="close()"
        />
      }
    }
  `,
})
export class SourcesPickerComponent implements OnInit {
  @Input() label = 'source';
  /**
   * Opt-in clearable mode (ADR-0033). When `true`, the picker skips its
   * default-source auto-selection on init, accepts `value=''` as a valid
   * cleared state, and renders a clear (×) button next to the trigger.
   * Callers wire the cleared state to a domain-specific "no selection"
   * meaning (e.g. describe page: "all sources").
   */
  @Input() allowEmpty = false;
  /** Trigger-label text when `selectedId` is empty (only meaningful with `allowEmpty`). */
  @Input() placeholder = '';
  @Output() valueChange = new EventEmitter<string>();

  private readonly configService = inject(ConfigService);
  readonly sources = signal<SourceListingEntry[] | null>(null);
  readonly selectedId = signal<string>('');
  readonly open = signal<boolean>(false);
  readonly parsedValue = computed<{ id: string; ref?: string }>(() =>
    splitPinnedAddress(this.selectedId()),
  );
  readonly triggerLabel = computed(() => {
    const id = this.parsedValue().id;
    if (id === '') return this.placeholder;
    const entry = (this.sources() ?? []).find((s) => s.id === id);
    return entry?.label ?? '';
  });

  @Input() set value(v: string | null | undefined) {
    if (v === null || v === undefined) return;
    if (v === '' && !this.allowEmpty) return;
    this.selectedId.set(v);
  }

  toggle(): void {
    this.open.update((v) => !v);
  }

  close(): void {
    this.open.set(false);
  }

  onApplied(value: string): void {
    if (value !== '' && value !== this.selectedId()) {
      this.selectedId.set(value);
      this.valueChange.emit(value);
    }
    this.close();
  }

  clear(ev: Event): void {
    ev.stopPropagation();
    if (this.selectedId() === '') return;
    this.selectedId.set('');
    this.valueChange.emit('');
  }

  isFloatingRefShape(ref: string): boolean {
    return !/^[0-9a-f]{40}$/i.test(ref);
  }

  ngOnInit(): void {
    this.configService.list().subscribe((listing) => {
      this.sources.set(listing.sources);
      if (this.allowEmpty) return;
      if (this.selectedId() === '') {
        const def = listing.sources.find((s) => s.default === true);
        const initial = def?.id ?? listing.sources[0]?.id ?? '';
        if (initial !== '') {
          this.selectedId.set(initial);
          this.valueChange.emit(initial);
        }
      }
    });
  }
}
