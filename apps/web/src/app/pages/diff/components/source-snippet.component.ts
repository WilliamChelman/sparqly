import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  OnInit,
  signal,
} from '@angular/core';

export interface SnippetPayload {
  kind: 'snippet';
  startLine: number;
  focalLine: number;
  lines: string[];
}

export interface SnippetUnavailable {
  kind: 'unavailable';
  reason: 'missing' | 'not-a-file' | 'beyond-eof' | 'empty';
}

export type SnippetReadResult = SnippetPayload | SnippetUnavailable;

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
            >{{ file() }}:{{ s.focalLine }}</span
          >
        </div>
        <div class="flex font-mono text-[11.5px] leading-[1.55]">
          <div
            class="flex-none min-w-9 select-none whitespace-pre bg-surface-sunken px-2 py-1.5 text-right text-foreground-faint"
            data-testid="snippet-gutter"
            >@for (l of s.lines; track $index) {<span
              [class]="
                s.startLine + $index === s.focalLine
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
              [attr.data-focal]="s.startLine + $index === s.focalLine ? 'true' : null"
              [class]="
                s.startLine + $index === s.focalLine
                  ? 'inline-block w-full my-line-focus'
                  : 'block'
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
  private readonly http = inject(HttpClient);

  readonly file = input.required<string>();
  readonly line = input.required<number>();
  readonly context = input.required<number>();

  readonly snippet = signal<SnippetPayload | null>(null);
  readonly unavailable = signal<boolean>(false);

  ngOnInit(): void {
    const params = new HttpParams()
      .set('file', this.file())
      .set('line', String(this.line()))
      .set('snippetContext', String(this.context()));
    this.http
      .get<SnippetReadResult>('/api/source-snippet', { params })
      .subscribe({
        next: (result) => {
          if (result.kind === 'snippet') this.snippet.set(result);
          else this.unavailable.set(true);
        },
        error: (_err: HttpErrorResponse) => this.unavailable.set(true),
      });
  }
}
