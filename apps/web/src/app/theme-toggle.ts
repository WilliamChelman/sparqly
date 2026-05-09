import {
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';
import { ThemeService, type ThemeMode } from './theme.service';

const MODES: ReadonlyArray<{ mode: ThemeMode; label: string; glyph: string }> = [
  { mode: 'light', label: 'Light theme', glyph: '☀' },
  { mode: 'dark', label: 'Dark theme', glyph: '☾' },
  { mode: 'system', label: 'Match system theme', glyph: '◐' },
];

@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      role="group"
      aria-label="Theme"
      class="inline-flex items-center gap-0.5 rounded-full border border-border bg-surface-elevated p-0.5 text-foreground-muted shadow-sm"
    >
      @for (m of modes; track m.mode) {
        <button
          type="button"
          [attr.data-mode]="m.mode"
          [attr.aria-label]="m.label"
          [attr.aria-pressed]="service.mode() === m.mode"
          class="grid h-7 w-7 place-items-center rounded-full text-[13px] leading-none transition-colors hover:text-foreground aria-pressed:bg-bg aria-pressed:text-foreground aria-pressed:shadow-sm"
          (click)="service.set(m.mode)"
        >
          <span aria-hidden="true">{{ m.glyph }}</span>
        </button>
      }
    </div>
  `,
})
export class ThemeToggle {
  protected readonly service = inject(ThemeService);
  protected readonly modes = MODES;
}
