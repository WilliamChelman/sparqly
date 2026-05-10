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
import { ConfigService, type SourceListingEntry } from '@app/core';

@Component({
  selector: 'app-sources-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkListboxModule],
  host: { class: 'relative inline-block' },
  template: `
    @if (sources() === null) {
      <span class="text-sm text-foreground-faint">loading sources…</span>
    } @else {
      <button
        type="button"
        class="inline-flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-surface py-2 pl-3 pr-3.5 text-[13px] text-foreground shadow-sm transition-[border-color,box-shadow,transform] duration-200 hover:border-foreground-faint active:translate-y-[0.5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        [attr.aria-haspopup]="'listbox'"
        [attr.aria-expanded]="open()"
        (click)="toggle()"
      >
        <span
          class="font-mono text-[10px] uppercase tracking-[0.14em] text-foreground-faint"
          >{{ label }}</span
        >
        <span class="h-3.5 w-px bg-border" aria-hidden="true"></span>
        <span class="font-sans font-medium">{{ triggerLabel() }}</span>
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
      @if (open()) {
        <ul
          cdkListbox
          class="absolute left-0 top-[calc(100%+6px)] z-10 m-0 min-w-full list-none rounded-lg border border-border bg-surface p-1.5 shadow-md"
          [tabindex]="0"
          [cdkListboxValue]="[selectedId()]"
          (cdkListboxValueChange)="onPick($event.value)"
          (keydown.escape)="close()"
        >
          @for (s of sources(); track s.id) {
            <li
              [cdkOption]="s.id"
              [attr.data-source-id]="s.id"
              class="cursor-pointer rounded-md px-2.5 py-1.5 font-sans text-[13px] text-foreground-muted hover:bg-surface-sunken hover:text-foreground aria-selected:bg-surface-sunken aria-selected:text-foreground [&.cdk-option-active]:bg-surface-sunken [&.cdk-option-active]:text-foreground"
            >
              {{ s.label }}
            </li>
          }
        </ul>
      }
    }
  `,
})
export class SourcesPickerComponent implements OnInit {
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
