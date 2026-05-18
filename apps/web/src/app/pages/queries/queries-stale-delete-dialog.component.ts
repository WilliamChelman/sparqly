import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { ButtonComponent } from '@app/modules/button';

@Component({
  selector: 'app-queries-stale-delete-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent],
  template: `
    <div
      data-testid="queries-stale-delete-dialog"
      role="dialog"
      class="rounded border border-warning bg-surface p-3 text-sm"
    >
      <p>
        <strong>{{ slug }}</strong> was changed elsewhere. Reload to see the
        current version, or confirm the delete to remove it anyway.
      </p>
      <div class="mt-2 flex gap-2">
        <button
          app-btn
          type="button"
          variant="secondary"
          size="sm"
          data-testid="queries-stale-delete-reload"
          (click)="reload.emit()"
        >
          Reload
        </button>
        <button
          app-btn
          type="button"
          variant="primary"
          size="sm"
          data-testid="queries-stale-delete-confirm"
          (click)="confirmDelete.emit()"
        >
          Delete anyway
        </button>
      </div>
    </div>
  `,
})
export class QueriesStaleDeleteDialogComponent {
  @Input({ required: true }) slug!: string;
  @Output() readonly reload = new EventEmitter<void>();
  @Output() readonly confirmDelete = new EventEmitter<void>();
}
