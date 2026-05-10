import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  ViewChild,
  computed,
} from '@angular/core';
import { YasqeEditorComponent } from '@app/modules/yasqe-editor';

@Component({
  selector: 'app-editor-frame',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [YasqeEditorComponent],
  host: { class: 'block' },
  template: `
    <div class="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <div
        class="flex items-center justify-between border-b border-border-muted bg-surface-sunken px-3.5 py-2"
      >
        <span
          class="font-mono text-[10px] uppercase tracking-[0.14em] text-foreground-faint"
          >{{ name }}</span
        >
        <span class="flex gap-3.5 font-mono text-[10px] text-foreground-faint">
          <span class="font-medium text-secondary">{{ kindLabel() }}</span>
          <span>{{ prefixLabel() }}</span>
        </span>
      </div>
      <div class="bg-surface">
        <app-yasqe-editor
          #editor
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
