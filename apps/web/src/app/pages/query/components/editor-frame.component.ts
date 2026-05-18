import {
  ChangeDetectionStrategy,
  Component,
  computed,
  EventEmitter,
  Input,
  Output,
  ViewChild,
} from '@angular/core';
import { CardComponent } from '@app/modules/card';
import { EyebrowComponent } from '@app/modules/eyebrow';
import { YasqeEditorComponent } from '@app/modules/yasqe-editor';
import type {
  ParameterBindings,
  ParameterDeclaration,
} from 'common';
import { ParameterFormComponent } from './parameter-form.component';

@Component({
  selector: 'app-editor-frame',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CardComponent,
    EyebrowComponent,
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
            [initialBindings]="initialBindings"
            (submitBindings)="submitBindings.emit($event)"
          />
        </div>
      }
    </div>
  `,
})
export class EditorFrameComponent {
  @Input() name = 'query';
  @Input() value = '';
  @Input() loadError?: { kind: 'not-found'; slug: string };
  @Input() parameters?: ReadonlyArray<ParameterDeclaration>;
  @Input() initialBindings?: ParameterBindings;

  @Output() valueChange = new EventEmitter<string>();
  @Output() submitBindings = new EventEmitter<ParameterBindings>();

  @ViewChild('editor', { static: true })
  private editor!: YasqeEditorComponent;

  readonly kindLabel = computed(() => this.editor.queryType() ?? '—');
  readonly prefixLabel = computed(() => {
    const n = this.editor.prefixCount();
    return n === 1 ? '1 prefix' : `${n} prefixes`;
  });
}
