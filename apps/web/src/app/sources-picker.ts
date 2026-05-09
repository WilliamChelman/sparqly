import { CdkListboxModule } from '@angular/cdk/listbox';
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
import {
  ConfigService,
  type SourceListingEntry,
} from './config.service';

export type {
  SourceKind,
  SourceListing,
  SourceListingEntry,
} from './config.service';

@Component({
  selector: 'app-sources-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkListboxModule],
  styles: [
    `
      :host {
        position: relative;
        display: inline-block;
      }

      .my-picker {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 8px 14px 8px 12px;
        background: var(--bg-elevated);
        border: 1px solid var(--line);
        border-radius: 8px;
        font-size: 13px;
        color: var(--ink);
        cursor: pointer;
        box-shadow: var(--shadow-sm);
        transition:
          border-color 0.2s,
          box-shadow 0.2s,
          transform 0.1s;
      }
      .my-picker:hover {
        border-color: var(--ink-faint);
      }
      .my-picker:active {
        transform: translateY(0.5px);
      }
      .my-picker:focus-visible {
        outline: 2px solid var(--gold);
        outline-offset: 2px;
      }

      .my-label {
        font-family: var(--font-mono);
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: var(--ink-faint);
      }
      .my-divider {
        width: 1px;
        height: 14px;
        background: var(--line);
      }
      .my-value {
        font-family: var(--font-sans);
        font-weight: 500;
      }
      .my-chevron {
        width: 10px;
        height: 10px;
        color: var(--ink-muted);
        transition: transform 0.2s;
      }
      .my-picker.my-is-open .my-chevron {
        transform: rotate(180deg);
      }

      .my-menu {
        position: absolute;
        top: calc(100% + 6px);
        left: 0;
        z-index: 10;
        margin: 0;
        padding: 6px;
        list-style: none;
        min-width: 100%;
        border: 1px solid var(--line);
        background: var(--bg-elevated);
        border-radius: 8px;
        box-shadow: var(--shadow-md);
      }
      .my-option {
        padding: 6px 10px;
        border-radius: 6px;
        font-family: var(--font-sans);
        font-size: 13px;
        color: var(--ink-muted);
        cursor: pointer;
      }
      .my-option:hover,
      .my-option.cdk-option-active,
      .my-option[aria-selected='true'] {
        background: var(--bg-sunken);
        color: var(--ink);
      }
    `,
  ],
  template: `
    @if (sources() === null) {
      <span class="text-sm text-foreground-faint">loading sources…</span>
    } @else {
      <button
        type="button"
        class="my-picker"
        [class.my-is-open]="open()"
        [attr.aria-haspopup]="'listbox'"
        [attr.aria-expanded]="open()"
        (click)="toggle()"
      >
        <span class="my-label">{{ label }}</span>
        <span class="my-divider" aria-hidden="true"></span>
        <span class="my-value">{{ triggerLabel() }}</span>
        <svg class="my-chevron" viewBox="0 0 10 10" aria-hidden="true">
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
      @if (open()) {
        <ul
          cdkListbox
          class="my-menu"
          [tabindex]="0"
          [cdkListboxValue]="[selectedId()]"
          (cdkListboxValueChange)="onPick($event.value)"
          (keydown.escape)="close()"
        >
          @for (s of sources(); track s.id) {
            <li
              [cdkOption]="s.id"
              [attr.data-source-id]="s.id"
              class="my-option"
            >
              {{ s.label }}
            </li>
          }
        </ul>
      }
    }
  `,
})
export class SourcesPicker implements OnInit {
  @Input() label = 'source';
  @Output() valueChange = new EventEmitter<string>();

  private readonly configService = inject(ConfigService);
  readonly sources = signal<SourceListingEntry[] | null>(null);
  readonly selectedId = signal<string>('');
  readonly open = signal<boolean>(false);
  readonly triggerLabel = computed(() => {
    const id = this.selectedId();
    const entry = (this.sources() ?? []).find((s) => s.id === id);
    return entry?.label ?? '';
  });

  @Input() set value(v: string | null | undefined) {
    if (v !== null && v !== undefined && v !== '') {
      this.selectedId.set(v);
    }
  }

  toggle(): void {
    this.open.update((v) => !v);
  }

  close(): void {
    this.open.set(false);
  }

  onPick(value: readonly string[]): void {
    const id = value[0];
    if (id !== undefined && id !== this.selectedId()) {
      this.selectedId.set(id);
      this.valueChange.emit(id);
    }
    this.close();
  }

  ngOnInit(): void {
    this.configService.list().subscribe((listing) => {
      this.sources.set(listing.sources);
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
