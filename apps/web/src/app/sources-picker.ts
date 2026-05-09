import {
  ChangeDetectionStrategy,
  Component,
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
  template: `
    @if (sources().length === 0) {
      <span class="text-sm text-foreground-faint">loading sources…</span>
    } @else {
      <label class="flex items-center gap-2 text-sm">
        <span class="text-foreground-muted">{{ label }}</span>
        <select
          class="rounded border border-border bg-surface px-2 py-1 text-foreground"
          (change)="onChange($event)"
        >
          @for (s of sources(); track s.id) {
            <option [value]="s.id" [selected]="s.id === selectedId()">
              {{ s.label }}
            </option>
          }
        </select>
      </label>
    }
  `,
})
export class SourcesPicker implements OnInit {
  @Input() label = 'source';
  @Output() valueChange = new EventEmitter<string>();

  private readonly configService = inject(ConfigService);
  readonly sources = signal<SourceListingEntry[]>([]);
  readonly selectedId = signal<string>('');

  @Input() set value(v: string | null | undefined) {
    if (v !== null && v !== undefined && v !== '') {
      this.selectedId.set(v);
    }
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

  onChange(ev: Event): void {
    const target = ev.target as HTMLSelectElement;
    this.selectedId.set(target.value);
    this.valueChange.emit(target.value);
  }
}
