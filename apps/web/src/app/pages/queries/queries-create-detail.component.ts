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
import { EyebrowComponent } from '@app/modules/eyebrow';
import { InputComponent } from '@app/modules/input';
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
  imports: [
    ButtonComponent,
    EyebrowComponent,
    InputComponent,
    YasqeEditorComponent,
    ParameterEditorComponent,
  ],
  template: `
    <label class="flex flex-col gap-1">
      <span app-eyebrow>Slug</span>
      <input
        app-input
        class="font-mono"
        type="text"
        data-testid="queries-create-slug"
        placeholder="my-saved-query"
        [value]="draftSlug()"
        (input)="onSlugInput($event)"
      />
      @if (errorSlug && errorSlug === draftSlug()) {
        <span
          data-testid="queries-create-slug-error"
          class="text-[12px] text-removed"
        >
          A saved query named <code>{{ draftSlug() }}</code> already exists.
          Pick another slug.
        </span>
      }
    </label>
    <app-yasqe-editor
      class="mt-3 block"
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
    <div
      class="mt-3 flex flex-wrap items-center justify-end gap-2 rounded-lg border border-border-muted bg-surface p-3 shadow-sm"
    >
      <button
        app-btn
        type="button"
        variant="secondary"
        data-testid="queries-cancel"
        (click)="canceled.emit()"
      >
        Cancel
      </button>
      <button
        app-btn
        type="button"
        variant="accent"
        data-testid="queries-save"
        [disabled]="!isSlugValid()"
        (click)="emitSave()"
      >
        Save
      </button>
    </div>
  `,
})
export class QueriesCreateDetailComponent implements OnChanges {
  @Input() prefillBody = '';
  @Input() prefillParameters: ReadonlyArray<ParameterDeclaration> = [];
  @Input() errorSlug: string | null = null;
  @Output() readonly save = new EventEmitter<CreatePayload>();
  @Output() readonly canceled = new EventEmitter<void>();

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
