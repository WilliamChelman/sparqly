import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { CodeLine, CodeToken } from './code-highlight';

/**
 * Renders one block of displayed code as a highlighted `<pre>`.
 *
 * Given a token model in `lines`, each token becomes an inline `<span>` carrying
 * its `cm-*` classes; the `<pre>` carries the `cm-s-sparqly` theme class so the
 * editor palette applies. When `lines` is `null` — the module signalled an
 * unrecognized mode or an oversized input — the raw `text` renders as plain
 * text instead. Either way the displayed text is byte-identical to `text`.
 */
@Component({
  selector: 'app-code-block',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<pre
      data-testid="code-block"
      class="cm-s-sparqly overflow-auto whitespace-pre-wrap rounded border border-border-muted bg-surface-sunken p-3 font-mono text-xs text-foreground"
    >@if (flatTokens(); as tokens) {@for (token of tokens; track $index) {<span [class]="token.className">{{ token.text }}</span>}}@else {{{ text() }}}</pre>`,
})
export class CodeBlockComponent {
  /** The exact source text — the byte-identity reference and plain fallback. */
  readonly text = input<string>('');
  /** The per-line token model, or `null` to render `text` as plain text. */
  readonly lines = input<CodeLine[] | null>(null);

  /**
   * The line model flattened to a single token stream, with an unstyled
   * newline token between lines, so the template needs only one `@for`.
   */
  protected readonly flatTokens = computed<CodeToken[] | null>(() => {
    const lines = this.lines();
    if (!lines) return null;
    const tokens: CodeToken[] = [];
    lines.forEach((line, index) => {
      if (index > 0) tokens.push({ text: '\n', className: '' });
      tokens.push(...line);
    });
    return tokens;
  });
}
