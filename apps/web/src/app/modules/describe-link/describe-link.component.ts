import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { ButtonComponent } from '@app/modules/button';
import { IconTargetComponent } from '@app/modules/icons';

@Component({
  selector: 'app-describe-link',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, IconTargetComponent],
  template: `
    <a
      app-btn
      variant="icon"
      data-testid="describe-this"
      [href]="href()"
      target="_blank"
      rel="noopener noreferrer"
      [attr.title]="ariaLabel()"
      [attr.aria-label]="ariaLabel()"
      class="ml-1 align-middle font-[inherit] text-[1.05em] no-underline"
    >
      <app-icon-target />
    </a>
  `,
})
export class DescribeLinkComponent {
  readonly iri = input.required<string>();
  readonly source = input<string | undefined>(undefined);
  readonly ariaLabel = input<string>('Describe this IRI');

  readonly href = computed(() => {
    const base = `/describe?iri=${encodeURIComponent(this.iri())}`;
    const src = this.source();
    return src ? `${base}&source=${encodeURIComponent(src)}` : base;
  });
}
