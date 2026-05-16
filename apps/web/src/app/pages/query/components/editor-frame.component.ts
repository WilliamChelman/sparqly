import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  computed,
} from '@angular/core';
import { EyebrowComponent } from '@app/modules/eyebrow';
import { YasqeEditorComponent } from '@app/modules/yasqe-editor';

@Component({
  selector: 'app-editor-frame',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EyebrowComponent, YasqeEditorComponent],
  host: { class: 'block' },
  template: `
    <div class="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <div
        class="my-head flex items-center justify-between border-b border-border-muted bg-surface-sunken px-3.5 py-2"
      >
        <span app-eyebrow class="my-name">{{ name }}</span>
        <span class="flex gap-3.5 font-mono text-[10px] text-foreground-faint">
          <span class="my-kind font-medium text-secondary">{{ kindLabel() }}</span>
          <span class="my-meta">{{ prefixLabel() }}</span>
        </span>
      </div>
      <div class="my-body flex resize-y flex-col overflow-hidden bg-surface h-80 min-h-32">
        <app-yasqe-editor
          #editor
          class="flex-1 min-h-0"
          [value]="value"
          (valueChange)="valueChange.emit($event)"
        />
      </div>
    </div>
  `,
})
export class EditorFrameComponent {
  @Input() name = 'query';
  @Input() value = '';
  @Output() valueChange = new EventEmitter<string>();

  @ViewChild('editor', { static: true })
  private editor!: YasqeEditorComponent;

  readonly kindLabel = computed(() => this.editor.queryType() ?? '—');
  readonly prefixLabel = computed(() => {
    const n = this.editor.prefixCount();
    return n === 1 ? '1 prefix' : `${n} prefixes`;
  });
}
