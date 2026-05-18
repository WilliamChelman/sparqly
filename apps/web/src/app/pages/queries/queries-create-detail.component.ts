import {
  ChangeDetectionStrategy,
  Component,
  computed,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  signal,
  SimpleChanges,
} from '@angular/core';
import { ButtonComponent } from '@app/modules/button';
import { YasqeEditorComponent } from '@app/modules/yasqe-editor';
import { SAVED_QUERY_SLUG_REGEX } from 'core/saved-queries/saved-query-entry';
import type { ParameterDeclaration } from 'common';
import { ParameterEditorComponent } from '../query/components/parameter-editor.component';

export interface CreatePayload {
  slug: string;
  body: string;
  parameters: ReadonlyArray<ParameterDeclaration>;
}

@Component({
  selector: 'app-queries-create-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, YasqeEditorComponent, ParameterEditorComponent],
  template: `
    <div class="flex flex-col gap-2">
      <input
        type="text"
        data-testid="queries-create-slug"
        placeholder="slug"
        [value]="draftSlug()"
        (input)="onSlugInput($event)"
        class="rounded border border-border bg-surface px-2 py-1 font-mono text-sm text-foreground"
      />
      @if (errorSlug && errorSlug === draftSlug()) {
        <p
          data-testid="queries-create-slug-error"
          class="text-xs text-warning"
        >
          A saved query named <code>{{ draftSlug() }}</code> already exists.
          Pick another slug.
        </p>
      }
    </div>
    <app-yasqe-editor
      class="mt-2 block"
      [value]="draftBody()"
      (valueChange)="draftBody.set($event)"
    />
    <div class="mt-3">
      <app-parameter-editor
        [parameters]="draftParameters()"
        [body]="draftBody()"
        (parametersChange)="draftParameters.set($event)"
      />
    </div>
    <div class="mt-3 flex gap-2">
      <button
        type="button"
        data-testid="queries-save"
        [disabled]="!isSlugValid()"
        (click)="emitSave()"
        class="inline-flex items-center rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-accent-foreground shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
      >
        Save
      </button>
      <button
        app-btn
        type="button"
        variant="secondary"
        size="sm"
        data-testid="queries-cancel"
        (click)="cancel.emit()"
      >
        Cancel
      </button>
    </div>
  `,
})
export class QueriesCreateDetailComponent implements OnChanges {
  @Input() prefillBody = '';
  @Input() prefillParameters: ReadonlyArray<ParameterDeclaration> = [];
  @Input() errorSlug: string | null = null;
  @Output() readonly save = new EventEmitter<CreatePayload>();
  @Output() readonly cancel = new EventEmitter<void>();

  readonly draftSlug = signal<string>('');
  readonly draftBody = signal<string>('');
  readonly draftParameters = signal<ReadonlyArray<ParameterDeclaration>>([]);
  readonly isSlugValid = computed(() =>
    SAVED_QUERY_SLUG_REGEX.test(this.draftSlug()),
  );

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['prefillBody']) this.draftBody.set(this.prefillBody);
    if (changes['prefillParameters'])
      this.draftParameters.set(this.prefillParameters);
  }

  onSlugInput(event: Event): void {
    this.draftSlug.set((event.target as HTMLInputElement).value);
  }

  emitSave(): void {
    if (!this.isSlugValid()) return;
    this.save.emit({
      slug: this.draftSlug(),
      body: this.draftBody(),
      parameters: this.draftParameters(),
    });
  }
}
