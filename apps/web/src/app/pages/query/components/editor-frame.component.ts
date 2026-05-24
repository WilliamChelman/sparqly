import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  inject,
  Input,
  Output,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CardComponent } from '@app/modules/card';
import { ConfigService, type DisplayContext } from '@app/core';
import { EyebrowComponent } from '@app/modules/eyebrow';
import { YasqeEditorComponent } from '@app/modules/yasqe-editor';
import {
  CdkMenuTrigger,
  MenuComponent,
  MenuItemComponent,
} from '@app/modules/menu';
import {
  ButtonComponent,
  ButtonIconEndDirective,
} from '@app/modules/button';
import { IconChevronDownComponent } from '@app/modules/icons';
import type {
  ParameterBindings,
  ParameterDeclaration,
} from 'common';
import { ParameterFormComponent } from './parameter-form.component';
import {
  buildQuickQuery,
  type QuickQueryKind,
} from '../utils/sparql-defaults';

@Component({
  selector: 'app-editor-frame',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ButtonComponent,
    ButtonIconEndDirective,
    CardComponent,
    CdkMenuTrigger,
    EyebrowComponent,
    IconChevronDownComponent,
    MenuComponent,
    MenuItemComponent,
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
        <span class="flex items-center gap-1.5">
          <button
            app-btn
            variant="ghost"
            size="sm"
            type="button"
            [cdkMenuTriggerFor]="quickQueryMenu"
            aria-haspopup="menu"
          >
            Quick query
            <app-icon-chevron-down iconEnd />
          </button>
          <button
            app-btn
            variant="ghost"
            size="sm"
            type="button"
            (click)="pickQuickQuery('clear')"
          >
            Clear
          </button>
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
          class="flex-1 min-h-0"
          [value]="value"
          (valueChange)="valueChange.emit($event)"
        />
      </div>
      @if (parametersVisible) {
        <div class="my-parameters border-t border-border-muted bg-surface px-3.5 py-2">
          <app-parameter-form
            [parameters]="parameters!"
            [initialBindings]="initialBindings"
            (submitBindings)="submitBindings.emit($event)"
          />
        </div>
      }
    </div>

    <ng-template #quickQueryMenu>
      <app-menu>
        <button app-menu-item (cdkMenuItemTriggered)="pickQuickQuery('select-spo')">
          SELECT ?s ?p ?o
        </button>
        <button app-menu-item (cdkMenuItemTriggered)="pickQuickQuery('select-spog')">
          SELECT ?s ?p ?o ?g
        </button>
        <button app-menu-item (cdkMenuItemTriggered)="pickQuickQuery('construct-spo')">
          CONSTRUCT {{ '{' }} ?s ?p ?o {{ '}' }}
        </button>
      </app-menu>
    </ng-template>
  `,
})
export class EditorFrameComponent {
  @Input() name = 'query';
  @Input() value = '';
  @Input() loadError?: { kind: 'not-found'; slug: string };
  @Input() parameters?: ReadonlyArray<ParameterDeclaration>;
  @Input() initialBindings?: ParameterBindings;
  @Input() showParameters = true;

  @Output() valueChange = new EventEmitter<string>();
  @Output() submitBindings = new EventEmitter<ParameterBindings>();

  private readonly configService = inject(ConfigService);
  private readonly context = toSignal(this.configService.context(), {
    initialValue: { prefixes: {} } as DisplayContext,
  });

  get parametersVisible(): boolean {
    if (!this.showParameters) return false;
    const params = this.parameters;
    return params !== undefined && params.length > 0;
  }

  pickQuickQuery(kind: QuickQueryKind): void {
    this.valueChange.emit(buildQuickQuery(kind, this.context()));
  }
}
