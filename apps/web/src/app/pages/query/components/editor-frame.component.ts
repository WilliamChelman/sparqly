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
  styles: [
    `
      :host {
        display: block;
      }

      .my-editor {
        background: var(--bg-elevated);
        border: 1px solid var(--line);
        border-radius: 8px;
        overflow: hidden;
        box-shadow: var(--shadow-sm);
      }

      .my-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 14px;
        border-bottom: 1px solid var(--line-faint);
        background: var(--bg-sunken);
      }

      .my-name {
        font-family: var(--font-mono);
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: var(--ink-faint);
      }

      .my-meta {
        font-family: var(--font-mono);
        font-size: 10px;
        color: var(--ink-faint);
        display: flex;
        gap: 14px;
      }

      .my-kind {
        color: var(--teal);
        font-weight: 500;
      }

      .my-body {
        background: var(--bg-elevated);
      }
    `,
  ],
  template: `
    <div class="my-editor">
      <div class="my-head">
        <span class="my-name">{{ name }}</span>
        <span class="my-meta">
          <span class="my-kind">{{ kindLabel() }}</span>
          <span>{{ prefixLabel() }}</span>
        </span>
      </div>
      <div class="my-body">
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
