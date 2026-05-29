import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  input,
  Output,
} from '@angular/core';
import { ButtonComponent } from '@app/modules/button';

/**
 * The ref search/refresh bar lifted out of {@link RefsPanelComponent} so the
 * overlay can pin it to the bottom of the refs column. Presentational: it owns
 * no state, emitting every change back to the overlay.
 */
@Component({
  selector: 'app-ref-search-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent],
  template: `
    <div class="flex flex-col gap-1.5 border-t border-border p-3">
      <div class="flex items-center gap-2">
        <input
          data-testid="refs-search"
          type="text"
          placeholder="Search refs…"
          class="min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-foreground-faint focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          [value]="refSearch()"
          (input)="onInput($event)"
          (keydown.enter)="onEnter($event)"
        />
        @if (stagedRef() !== '') {
          <button
            app-btn
            variant="secondary"
            type="button"
            data-testid="refs-clear"
            title="Clear selected ref"
            class="shrink-0"
            (click)="clear.emit()"
          >Clear</button>
        }
        <button
          app-btn
          variant="secondary"
          type="button"
          data-testid="refs-refresh"
          class="shrink-0"
          (click)="refresh.emit()"
        >⟳ Refresh remotes</button>
      </div>
      <p class="text-[11px] text-foreground-faint">
        Press <kbd class="rounded border border-border bg-surface-sunken px-1 font-mono text-[10px]">Enter</kbd>
        to use a custom ref (e.g. <code class="font-mono">HEAD~3</code> or a SHA).
      </p>
      @if (refreshError(); as kind) {
        <p
          data-testid="refs-refresh-error"
          class="text-[12px] text-foreground-muted"
        >Refresh failed ({{ kind }})</p>
      }
    </div>
  `,
})
export class RefSearchBarComponent {
  readonly refSearch = input<string>('');
  readonly stagedRef = input<string>('');
  readonly refreshError = input<string | null>(null);

  @Output() readonly refSearchChange = new EventEmitter<string>();
  @Output() readonly appliedRef = new EventEmitter<string>();
  @Output() readonly clear = new EventEmitter<void>();
  @Output() readonly refresh = new EventEmitter<void>();

  onInput(ev: Event): void {
    const target = ev.target as HTMLInputElement;
    this.refSearchChange.emit(target.value);
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
