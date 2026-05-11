import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

@Component({
  selector: 'app-describe-link',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a
      data-testid="describe-this"
      [href]="href()"
      target="_blank"
      rel="noopener noreferrer"
      title="Describe this IRI"
      aria-label="Describe this IRI"
      class="ml-1 inline-flex items-center align-middle text-[1.05em] leading-none text-foreground-faint no-underline transition-colors hover:text-accent"
      >⌖</a
    >
  `,
})
export class DescribeLinkComponent {
  readonly iri = input.required<string>();

  readonly href = computed(
    () => `/describe?iri=${encodeURIComponent(this.iri())}`,
  );
}
