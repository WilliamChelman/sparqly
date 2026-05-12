import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';
import { SnippetService, type SnippetPayload } from '../services/snippet.service';

@Component({
  selector: 'app-source-snippet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .my-line-focus {
        background: color-mix(in oklab, var(--gold-soft) 30%, transparent);
        box-shadow: -8px 0 0 color-mix(in oklab, var(--gold-soft) 30%, transparent);
      }
      :root[data-theme='dark'] .my-line-focus {
        background: color-mix(in oklab, var(--gold-deep) 35%, transparent);
        box-shadow: -8px 0 0 color-mix(in oklab, var(--gold-deep) 35%, transparent);
      }
    `,
  ],
  template: `
    @if (snippet(); as s) {
      <div class="overflow-hidden rounded-md border border-border bg-surface-frame">
        <div
          class="flex items-center justify-between gap-2.5 border-b border-border-muted bg-surface-sunken px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-foreground-faint"
        >
          <span data-testid="snippet-context-label"
            >± context · {{ context() }} {{ context() === 1 ? 'line' : 'lines' }}</span
          >
          <span
            data-testid="snippet-file"
            class="text-[11px] tracking-normal normal-case break-all text-foreground-muted"
            >{{ file() }}:{{ focalLabel(s) }}</span
          >
        </div>
        <div class="flex font-mono text-[11.5px] leading-[1.55]">
          <div
            class="flex-none min-w-9 select-none whitespace-pre bg-surface-sunken px-2 py-1.5 text-right text-foreground-faint"
            data-testid="snippet-gutter"
            >@for (l of s.lines; track $index) {<span
              [class]="
                isFocal(s, $index)
                  ? 'block font-semibold text-accent-strong dark:text-accent'
                  : 'block'
              "
              >{{ s.startLine + $index }}</span
            >}</div
          >
          <pre
            class="m-0 flex-1 overflow-x-auto whitespace-pre px-3 py-1.5 font-mono text-foreground"
            >@for (l of s.lines; track $index) {<span
              data-testid="snippet-line"
              [attr.data-line-number]="s.startLine + $index"
              [attr.data-focal]="isFocal(s, $index) ? 'true' : null"
              [class]="
                isFocal(s, $index)
                  ? 'block w-max min-w-full my-line-focus'
                  : 'block w-max min-w-full'
              "
              >{{ l }}</span
            >}</pre
          >
        </div>
      </div>
    } @else if (unavailable()) {
      <p
        data-testid="snippet-unavailable"
        class="px-3 py-2.5 font-serif italic text-[13px] text-foreground-faint"
      >
        (source file unavailable)
      </p>
    }
  `,
})
export class SourceSnippetComponent implements OnInit {
  private readonly snippets = inject(SnippetService);

  readonly file = input.required<string>();
  readonly focalStart = input.required<number>();
  readonly focalEnd = input.required<number>();
  readonly context = input.required<number>();

  readonly snippet = signal<SnippetPayload | null>(null);
  readonly unavailable = signal<boolean>(false);

  ngOnInit(): void {
    this.snippets
      .fetch(
        this.file(),
        { focalStart: this.focalStart(), focalEnd: this.focalEnd() },
        this.context(),
      )
      .subscribe((result) => {
        if (result.kind === 'snippet') this.snippet.set(result);
        else this.unavailable.set(true);
      });
  }

  isFocal(s: SnippetPayload, index: number): boolean {
    const lineNo = s.startLine + index;
    return lineNo >= s.focalStart && lineNo <= s.focalEnd;
  }

  focalLabel(s: SnippetPayload): string {
    return s.focalStart === s.focalEnd
      ? String(s.focalStart)
      : `${s.focalStart}-${s.focalEnd}`;
  }
}
