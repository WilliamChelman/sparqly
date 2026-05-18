import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { ButtonComponent } from '@app/modules/button';

@Component({
  selector: 'app-queries-stale-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent],
  template: `
    <div
      data-testid="queries-stale-dialog"
      role="dialog"
      class="rounded border border-warning bg-surface p-3 text-sm"
    >
      <p>
        <strong>{{ slug }}</strong> was changed elsewhere. Reload to see the
        current version, or overwrite.
      </p>
      <div class="mt-2 flex gap-2">
        <button
          app-btn
          type="button"
          variant="secondary"
          size="sm"
          data-testid="queries-stale-reload"
          (click)="reload.emit()"
        >
          Reload
        </button>
        <button
          app-btn
          type="button"
          variant="primary"
          size="sm"
          data-testid="queries-stale-overwrite"
          (click)="overwrite.emit()"
        >
          Overwrite
        </button>
      </div>
    </div>
  `,
})
export class QueriesStaleDialogComponent {
  @Input({ required: true }) slug!: string;
  @Output() readonly reload = new EventEmitter<void>();
  @Output() readonly overwrite = new EventEmitter<void>();
}
