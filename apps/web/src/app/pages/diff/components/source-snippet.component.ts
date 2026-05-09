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
  template: `
    @if (snippet(); as s) {
      <pre
        class="overflow-x-auto rounded bg-surface-sunken p-2 font-mono text-[11px] leading-snug text-foreground"
      >@for (l of s.lines; track $index) {<span
          data-testid="snippet-line"
          [attr.data-line-number]="s.startLine + $index"
          [attr.data-focal]="s.startLine + $index === s.focalLine ? 'true' : null"
          [class.bg-accent-soft]="s.startLine + $index === s.focalLine"
          class="block w-max min-w-full whitespace-pre"
          ><span class="mr-2 select-none text-foreground-faint">{{
          s.startLine + $index
        }}</span>{{ l }}</span>}</pre>
    } @else if (unavailable()) {
      <p
        data-testid="snippet-unavailable"
        class="text-xs italic text-foreground-faint"
      >(source file unavailable)</p>
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
