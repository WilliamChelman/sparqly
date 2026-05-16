import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  input,
  signal,
} from '@angular/core';
import { ButtonComponent } from '@app/modules/button';
import { IconCheckComponent, IconCopyComponent } from '@app/modules/icons';

@Component({
  selector: 'app-copy-iri',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, IconCheckComponent, IconCopyComponent],
  template: `
    <button
      app-btn
      variant="icon"
      type="button"
      data-testid="copy-iri"
      [title]="copied() ? 'Copied' : 'Copy IRI'"
      [attr.aria-label]="
        copied() ? 'IRI copied to clipboard' : 'Copy IRI to clipboard'
      "
      (click)="copy()"
      class="ml-1 align-middle font-[inherit] text-[1.05em]"
    >
      @if (copied()) {
        <app-icon-check />
      } @else {
        <app-icon-copy />
      }
    </button>
  `,
})
export class CopyIriComponent implements OnDestroy {
  readonly iri = input.required<string>();
  readonly copied = signal(false);
  private resetTimer: ReturnType<typeof setTimeout> | undefined;

  copy(): void {
    const promise = navigator.clipboard?.writeText(this.iri());
    if (promise === undefined) return;
    void promise.then(() => {
      this.copied.set(true);
      clearTimeout(this.resetTimer);
      this.resetTimer = setTimeout(() => this.copied.set(false), 1200);
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.resetTimer);
  }
}
