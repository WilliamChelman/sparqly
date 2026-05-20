import {
  ChangeDetectionStrategy,
  Component,
  computed,
  EventEmitter,
  input,
  Output,
} from '@angular/core';
import { ButtonComponent } from '@app/modules/button';
import { EyebrowComponent } from '@app/modules/eyebrow';
import { InputComponent, SelectComponent } from '@app/modules/input';
import {
  lint,
  PARAMETER_CARDINALITIES,
  PARAMETER_TYPES,
  type LintError,
  type ParameterCardinality,
  type ParameterDeclaration,
  type ParameterType,
} from 'common';

@Component({
  selector: 'app-parameter-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, EyebrowComponent, InputComponent, SelectComponent],
  template: `
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <h3 app-eyebrow>Parameters</h3>
        @if (parameters().length > 0) {
          <span class="text-[11px] text-foreground-faint">
            {{ parameters().length }}
            {{ parameters().length === 1 ? 'parameter' : 'parameters' }}
          </span>
        }
      </div>
      @if (bannerError(); as msg) {
        <div
          data-testid="param-lint-banner"
          role="alert"
          class="rounded-md border border-removed-line bg-removed-bg px-3 py-2 text-[12px] text-removed"
        >
          {{ msg }}
        </div>
      }
      @if (parameters().length === 0) {
        <p
          class="rounded-md border border-dashed border-border-muted bg-surface-sunken/40 px-3 py-4 text-center text-[12px] text-foreground-faint"
        >
          No parameters declared. Add one to bind values into the query body.
        </p>
      }
      @for (p of parameters(); track $index) {
        <div
          class="rounded-md border border-border-muted bg-surface-sunken/40 p-3 shadow-sm"
          [attr.data-testid]="'param-row-' + p.name"
        >
          <div class="flex flex-wrap items-end gap-2">
            <label class="flex min-w-[10rem] flex-1 flex-col gap-1">
              <span app-eyebrow>Name</span>
              <input
                app-input
                class="font-mono"
                type="text"
                data-testid="param-name"
                [value]="p.name"
                (input)="onFieldInput($index, 'name', $event)"
              />
            </label>
            <label class="flex w-32 flex-col gap-1">
              <span app-eyebrow>Type</span>
              <select
                app-input
                data-testid="param-type"
                [value]="p.type"
                (change)="onTypeChange($index, $event)"
              >
                @for (t of types; track t) {
                  <option [value]="t" [selected]="t === p.type">{{ t }}</option>
                }
              </select>
            </label>
            <label class="flex w-24 flex-col gap-1">
              <span app-eyebrow>Card.</span>
              <select
                app-input
                data-testid="param-cardinality"
                [value]="p.cardinality"
                (change)="onCardinalityChange($index, $event)"
              >
                @for (c of cardinalities; track c) {
                  <option [value]="c" [selected]="c === p.cardinality">{{ c }}</option>
                }
              </select>
            </label>
            <div class="ml-auto flex items-center gap-0.5">
              <button
                app-btn
                variant="icon"
                size="md"
                type="button"
                aria-label="Move up"
                title="Move up"
                class="h-7 w-7"
                data-testid="param-up"
                [disabled]="$index === 0"
                (click)="onMoveUp($index)"
              >↑</button>
              <button
                app-btn
                variant="icon"
                size="md"
                type="button"
                aria-label="Move down"
                title="Move down"
                class="h-7 w-7"
                data-testid="param-down"
                [disabled]="$index === parameters().length - 1"
                (click)="onMoveDown($index)"
              >↓</button>
              <button
                app-btn
                variant="icon"
                size="md"
                type="button"
                aria-label="Remove parameter"
                title="Remove"
                class="h-7 w-7 text-removed hover:text-removed"
                data-testid="param-remove"
                (click)="onRemove($index)"
              >×</button>
            </div>
          </div>
          <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label class="flex flex-col gap-1">
              <span app-eyebrow>Label</span>
              <input
                app-input
                type="text"
                data-testid="param-label"
                placeholder="Human-readable label"
                [value]="p.label ?? ''"
                (input)="onTextInput($index, 'label', $event)"
              />
            </label>
            <label class="flex flex-col gap-1">
              <span app-eyebrow>Description</span>
              <input
                app-input
                type="text"
                data-testid="param-description"
                placeholder="Short hint"
                [value]="p.description ?? ''"
                (input)="onTextInput($index, 'description', $event)"
              />
            </label>
            <label class="flex flex-col gap-1" [attr.for]="'param-default-' + $index">
              <span app-eyebrow>Default</span>
              @if (p.type === 'boolean') {
                <span
                  class="inline-flex h-[30px] items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-[13px] text-foreground-muted shadow-sm"
                >
                  <input
                    type="checkbox"
                    [attr.id]="'param-default-' + $index"
                    data-testid="param-default"
                    [checked]="p.default === true"
                    (change)="onDefaultCheckbox($index, $event)"
                  />
                  <span>{{ p.default === true ? 'true' : 'false' }}</span>
                </span>
              } @else {
                <input
                  app-input
                  [attr.id]="'param-default-' + $index"
                  data-testid="param-default"
                  placeholder="(none)"
                  [type]="defaultInputType(p)"
                  [value]="defaultDisplay(p)"
                  (input)="onDefaultInput($index, $event)"
                />
              }
            </label>
            @if (supportsEnum(p)) {
              <label class="flex flex-col gap-1">
                <span app-eyebrow>Enum</span>
                <input
                  app-input
                  type="text"
                  data-testid="param-enum"
                  placeholder="comma-separated values"
                  [value]="enumDisplay(p)"
                  (input)="onEnumInput($index, $event)"
                />
              </label>
            }
          </div>
          @if (rowError(p.name); as msg) {
            <p
              data-testid="param-lint-error"
              class="mt-2 text-[12px] text-removed"
            >
              {{ msg }}
            </p>
          }
        </div>
      }
      <div>
        <button
          app-btn
          variant="secondary"
          size="sm"
          type="button"
          data-testid="param-add"
          (click)="onAdd()"
        >+ Add parameter</button>
      </div>
    </div>
  `,
})
export class ParameterEditorComponent {
  readonly parameters = input.required<ReadonlyArray<ParameterDeclaration>>();
  readonly body = input<string>('');

  @Output() readonly parametersChange = new EventEmitter<
    ReadonlyArray<ParameterDeclaration>
  >();

  readonly types = PARAMETER_TYPES;
  readonly cardinalities = PARAMETER_CARDINALITIES;

  private readonly lintResult = computed<LintError | null>(() => {
    const result = lint(this.parameters(), this.body());
    return result.isErr() ? result.error : null;
  });

  rowError(name: string): string | null {
    const e = this.lintResult();
    if (!e) return null;
    if (e.kind === 'declared-but-unused' && e.name === name) {
      return `"?${name}" is declared but not used in the query body`;
    }
    return null;
  }

  bannerError(): string | null {
    const e = this.lintResult();
    if (!e) return null;
    if (e.kind === 'undeclared-body-variable') {
      return `"?${e.name}" is used in the body but not declared`;
    }
    return null;
  }

  onFieldInput(index: number, field: 'name', event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    this.updateAt(index, (p) => ({ ...p, [field]: raw }));
  }

  onTextInput(
    index: number,
    field: 'label' | 'description',
    event: Event,
  ): void {
    const raw = (event.target as HTMLInputElement).value;
    this.updateAt(index, (p) => {
      const next: ParameterDeclaration = { ...p };
      if (raw === '') delete next[field];
      else next[field] = raw;
      return next;
    });
  }

  onTypeChange(index: number, event: Event): void {
    const value = (event.target as HTMLSelectElement).value as ParameterType;
    this.updateAt(index, (p) => ({ ...p, type: value }));
  }

  onCardinalityChange(index: number, event: Event): void {
    const value = (event.target as HTMLSelectElement)
      .value as ParameterCardinality;
    this.updateAt(index, (p) => ({ ...p, cardinality: value }));
  }

  defaultInputType(p: ParameterDeclaration): string {
    switch (p.type) {
      case 'integer':
      case 'decimal':
        return 'number';
      case 'date':
        return 'date';
      case 'dateTime':
        return 'datetime-local';
      default:
        return 'text';
    }
  }

  defaultDisplay(p: ParameterDeclaration): string {
    const v = p.default;
    if (v === undefined || v === null) return '';
    return String(v);
  }

  onDefaultInput(index: number, event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    this.updateAt(index, (p) => {
      const next: ParameterDeclaration = { ...p };
      if (raw === '') {
        delete next.default;
        return next;
      }
      next.default = parseDefaultForType(p, raw);
      return next;
    });
  }

  onDefaultCheckbox(index: number, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.updateAt(index, (p) => ({ ...p, default: checked }));
  }

  supportsEnum(p: ParameterDeclaration): boolean {
    return p.type !== 'boolean' && p.type !== 'langString';
  }

  enumDisplay(p: ParameterDeclaration): string {
    if (!Array.isArray(p.enum)) return '';
    return p.enum.map((v) => String(v)).join(', ');
  }

  onEnumInput(index: number, event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    this.updateAt(index, (p) => {
      const next: ParameterDeclaration = { ...p };
      const trimmed = raw.trim();
      if (trimmed === '') {
        delete next.enum;
        return next;
      }
      next.enum = raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => parseDefaultForType(p, s));
      return next;
    });
  }

  onMoveUp(index: number): void {
    if (index <= 0) return;
    this.swap(index - 1, index);
  }

  onMoveDown(index: number): void {
    if (index >= this.parameters().length - 1) return;
    this.swap(index, index + 1);
  }

  private swap(a: number, b: number): void {
    const next = [...this.parameters()];
    [next[a], next[b]] = [next[b], next[a]];
    this.parametersChange.emit(next);
  }

  onRemove(index: number): void {
    const next = this.parameters().filter((_, i) => i !== index);
    this.parametersChange.emit(next);
  }

  onAdd(): void {
    const next: ParameterDeclaration[] = [
      ...this.parameters(),
      { name: '', type: 'string', cardinality: '1..1' },
    ];
    this.parametersChange.emit(next);
  }

  private updateAt(
    index: number,
    fn: (p: ParameterDeclaration) => ParameterDeclaration,
  ): void {
    const next = this.parameters().map((p, i) => (i === index ? fn(p) : p));
    this.parametersChange.emit(next);
  }
}

function parseDefaultForType(
  p: ParameterDeclaration,
  raw: string,
): unknown {
  switch (p.type) {
    case 'integer': {
      const n = Number.parseInt(raw, 10);
      return Number.isNaN(n) ? raw : n;
    }
    case 'decimal': {
      const n = Number.parseFloat(raw);
      return Number.isNaN(n) ? raw : n;
    }
    default:
      return raw;
  }
}
