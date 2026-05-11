import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { DisplayContext, Term } from '@app/core';
import { DescribeLinkComponent } from '@app/modules/describe-link';
import { renderTerm, type TermDisplay } from './term-renderer';

const IRI_KINDS = new Set<TermDisplay['kind']>([
  'prefixed-iri',
  'base-iri',
  'absolute-iri',
]);

@Component({
  selector: 'app-term-cell',
  standalone: true,
  imports: [DescribeLinkComponent],
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
          <span class="text-secondary dark:text-secondary-soft">{{ asPrefixed(d).prefix }}</span
          ><span class="text-foreground-faint">:</span
          >{{ asPrefixed(d).local }}
        }
        @case ('base-iri') {
          <span class="text-foreground-faint">&lt;</span
          >{{ asBase(d).local }}<span class="text-foreground-faint">&gt;</span>
        }
        @case ('absolute-iri') {
          <span class="text-secondary-strong dark:text-secondary">&lt;{{ asAbsolute(d).iri }}&gt;</span>
        }
        @case ('plain-literal') {
          "{{ asPlain(d).lexical }}"
        }
        @case ('language-literal') {
          "{{ asLang(d).lexical }}"<span class="text-foreground-faint">&#64;{{ asLang(d).language }}</span>
        }
        @case ('typed-literal') {
          "{{ asTyped(d).lexical }}"<span class="text-foreground-faint">^^</span
          ><app-term-cell
            [term]="iriPlaceholderTerm(asTyped(d).datatype)"
            [context]="context()"
          />
        }
        @case ('number') {
          <span class="font-medium text-accent-strong dark:text-accent">{{ asNumber(d).lexical }}</span>
        }
        @case ('blank') {
          <span class="italic text-foreground-muted">{{ asBlank(d).label }}</span>
        }
      }
    </span>
    @if (describableIri(); as iri) {
      <app-describe-link [iri]="iri" />
    }
  `,
})
export class TermCellComponent {
  readonly term = input<Term | null>(null);
  readonly context = input<DisplayContext>({ prefixes: {} });

  readonly display = computed<TermDisplay | null>(() => {
    const t = this.term();
    if (t == null) return null;
    return renderTerm(t, this.context());
  });

  readonly describableIri = computed<string | null>(() => {
    const d = this.display();
    if (d != null && IRI_KINDS.has(d.kind)) {
      return (d as Extract<TermDisplay, { iri: string }>).iri;
    }
    return null;
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
