import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { DisplayContext } from './config.service';
import type { Term } from './sparql-result-decoder';
import { renderTerm, type TermDisplay } from './term-renderer';

@Component({
  selector: 'app-term-cell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = display();
    <span
      data-testid="term-cell"
      [attr.data-kind]="d?.kind ?? 'unbound'"
      class="font-mono"
    >
      @switch (d?.kind) {
        @case ('prefixed-iri') {
          <span class="term-prefix">{{ asPrefixed(d).prefix }}</span
          ><span class="term-iri-punct">:</span
          ><span class="term-iri-local">{{ asPrefixed(d).local }}</span>
        }
        @case ('base-iri') {
          <span class="term-iri-punct">&lt;</span
          ><span class="term-iri-local">{{ asBase(d).local }}</span
          ><span class="term-iri-punct">&gt;</span>
        }
        @case ('absolute-iri') {
          <span class="term-iri-absolute">&lt;{{ asAbsolute(d).iri }}&gt;</span>
        }
        @case ('plain-literal') {
          <span class="term-literal">"{{ asPlain(d).lexical }}"</span>
        }
        @case ('language-literal') {
          <span class="term-literal">"{{ asLang(d).lexical }}"</span
          ><span class="term-literal-tag">&#64;{{ asLang(d).language }}</span>
        }
        @case ('typed-literal') {
          <span class="term-literal">"{{ asTyped(d).lexical }}"</span
          ><span class="term-literal-tag">^^</span
          ><app-term-cell
            [term]="iriPlaceholderTerm(asTyped(d).datatype)"
            [context]="context()"
          />
        }
        @case ('number') {
          <span class="term-number">{{ asNumber(d).lexical }}</span>
        }
        @case ('blank') {
          <span class="term-blank">{{ asBlank(d).label }}</span>
        }
      }
    </span>
  `,
})
export class TermCell {
  readonly term = input<Term | null>(null);
  readonly context = input<DisplayContext>({ prefixes: {} });

  readonly display = computed<TermDisplay | null>(() => {
    const t = this.term();
    if (t == null) return null;
    return renderTerm(t, this.context());
  });

  asPrefixed(d: TermDisplay | null) {
    return d as Extract<TermDisplay, { kind: 'prefixed-iri' }>;
  }
  asBase(d: TermDisplay | null) {
    return d as Extract<TermDisplay, { kind: 'base-iri' }>;
  }
  asAbsolute(d: TermDisplay | null) {
    return d as Extract<TermDisplay, { kind: 'absolute-iri' }>;
  }
  asPlain(d: TermDisplay | null) {
    return d as Extract<TermDisplay, { kind: 'plain-literal' }>;
  }
  asLang(d: TermDisplay | null) {
    return d as Extract<TermDisplay, { kind: 'language-literal' }>;
  }
  asTyped(d: TermDisplay | null) {
    return d as Extract<TermDisplay, { kind: 'typed-literal' }>;
  }
  asNumber(d: TermDisplay | null) {
    return d as Extract<TermDisplay, { kind: 'number' }>;
  }
  asBlank(d: TermDisplay | null) {
    return d as Extract<TermDisplay, { kind: 'blank' }>;
  }

  iriPlaceholderTerm(iri: string): Term {
    return { termType: 'NamedNode', value: iri };
  }
}
