import {
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';
import { ButtonComponent } from '@app/modules/button';
import { ThemeService, type ThemeMode } from '@app/core';

const MODES: ReadonlyArray<{ mode: ThemeMode; label: string; glyph: string }> = [
  { mode: 'light', label: 'Light theme', glyph: '☀' },
  { mode: 'dark', label: 'Dark theme', glyph: '☾' },
  { mode: 'system', label: 'Match system theme', glyph: '◐' },
];

@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent],
  template: `
    <div
      role="group"
      aria-label="Theme"
      class="inline-flex items-center gap-0.5 rounded-full border border-border bg-surface-elevated p-0.5 text-foreground-muted shadow-sm"
    >
      @for (m of modes; track m.mode) {
        <button
          app-btn
          variant="icon"
          type="button"
          [attr.data-mode]="m.mode"
          [attr.aria-label]="m.label"
          [attr.aria-pressed]="service.mode() === m.mode"
          class="h-7 w-7 rounded-full aria-pressed:bg-bg aria-pressed:text-foreground aria-pressed:shadow-sm"
          (click)="service.set(m.mode)"
        >
          <span aria-hidden="true">{{ m.glyph }}</span>
        </button>
      }
    </div>
  `,
})
export class ThemeToggleComponent {
  protected readonly service = inject(ThemeService);
  protected readonly modes = MODES;
}
