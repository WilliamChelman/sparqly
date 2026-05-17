import {
  ChangeDetectionStrategy,
  Component,
  computed,
  EventEmitter,
  Input,
  Output,
  ViewChild,
} from '@angular/core';
import { ButtonComponent } from '@app/modules/button';
import { CardComponent } from '@app/modules/card';
import { EyebrowComponent } from '@app/modules/eyebrow';
import { YasqeEditorComponent } from '@app/modules/yasqe-editor';
import type {
  ParameterBindings,
  ParameterDeclaration,
} from 'common';
import { ParameterEditorComponent } from './parameter-editor.component';
import { ParameterFormComponent } from './parameter-form.component';

@Component({
  selector: 'app-editor-frame',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    CardComponent,
    EyebrowComponent,
    ParameterEditorComponent,
    ParameterFormComponent,
    YasqeEditorComponent,
  ],
  host: { class: 'block' },
  template: `
    <div app-card>
      <div
        class="my-head flex items-center justify-between border-b border-border-muted bg-surface-sunken px-3.5 py-2"
      >
        <span app-eyebrow class="my-name">{{ name }}</span>
        <span class="flex gap-3.5 font-mono text-[10px] text-foreground-faint">
          @if (isModifiedFromLoaded()) {
            <span
              class="my-modified font-medium text-warning"
              data-testid="editor-modified-badge"
            >
              modified from <code>{{ loadedSlug }}</code>
            </span>
          }
          <span class="my-kind font-medium text-secondary">{{ kindLabel() }}</span>
          <span class="my-meta">{{ prefixLabel() }}</span>
        </span>
      </div>
      @if (loadError?.kind === 'not-found') {
        <div
          class="border-b border-border-muted bg-surface px-3.5 py-2 text-sm text-danger"
          data-testid="editor-not-found"
          role="alert"
        >
          Saved query <code>{{ loadError?.slug }}</code> was not found.
        </div>
      }
      <div class="my-body flex resize-y flex-col overflow-hidden bg-surface h-80 min-h-32">
        <app-yasqe-editor
          #editor
          class="flex-1 min-h-0"
          [value]="value"
          (valueChange)="valueChange.emit($event)"
        />
      </div>
      @if (parameters && parameters.length > 0) {
        <div class="my-parameters border-t border-border-muted bg-surface px-3.5 py-2">
          <app-parameter-form
            [parameters]="parameters"
            (submitBindings)="submitBindings.emit($event)"
          />
        </div>
      }
      @if (writable) {
        <div class="my-declarations border-t border-border-muted bg-surface px-3.5 py-2">
          <app-parameter-editor
            [parameters]="parameters ?? []"
            [body]="value"
            (parametersChange)="parametersDraftChange.emit($event)"
          />
        </div>
      }
      @if (writable) {
        <div
          class="my-actions flex items-center gap-2 border-t border-border-muted bg-surface-sunken px-3.5 py-2"
        >
          @if (loadedSlug) {
            <button
              app-btn
              type="button"
              variant="primary"
              size="sm"
              data-testid="editor-save"
              (click)="save.emit()"
            >
              Save
            </button>
          }
          <button
            app-btn
            type="button"
            variant="secondary"
            size="sm"
            data-testid="editor-save-as"
            (click)="saveAs.emit()"
          >
            Save as…
          </button>
          @if (loadedSlug) {
            <button
              app-btn
              type="button"
              variant="ghost"
              size="sm"
              data-testid="editor-delete"
              (click)="delete.emit()"
            >
              Delete
            </button>
          }
        </div>
      }
    </div>
  `,
})
export class EditorFrameComponent {
  @Input() name = 'query';
  @Input() value = '';
  @Input() loadedSlug?: string;
  @Input() loadedBody?: string;
  @Input() loadError?: { kind: 'not-found'; slug: string };
  @Input() writable = true;
  @Input() parameters?: ReadonlyArray<ParameterDeclaration>;

  @Output() valueChange = new EventEmitter<string>();
  @Output() save = new EventEmitter<void>();
  @Output() saveAs = new EventEmitter<void>();
  @Output() delete = new EventEmitter<void>();
  @Output() submitBindings = new EventEmitter<ParameterBindings>();
  @Output() parametersDraftChange = new EventEmitter<
    ReadonlyArray<ParameterDeclaration>
  >();

  @ViewChild('editor', { static: true })
  private editor!: YasqeEditorComponent;

  readonly kindLabel = computed(() => this.editor.queryType() ?? '—');
  readonly prefixLabel = computed(() => {
    const n = this.editor.prefixCount();
    return n === 1 ? '1 prefix' : `${n} prefixes`;
  });

  isModifiedFromLoaded(): boolean {
    return (
      this.loadedSlug !== undefined &&
      this.loadedBody !== undefined &&
      this.value !== this.loadedBody
    );
  }
}
