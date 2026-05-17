import {
  ChangeDetectionStrategy,
  Component,
  computed,
  EventEmitter,
  input,
  Output,
} from '@angular/core';
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
  template: `
    <div class="flex flex-col gap-2">
      @if (bannerError(); as msg) {
        <div data-testid="param-lint-banner" class="text-danger" role="alert">
          {{ msg }}
        </div>
      }
      @for (p of parameters(); track $index) {
        <div
          class="flex flex-col gap-1"
          [attr.data-testid]="'param-row-' + p.name"
        >
        <div class="flex items-center gap-2">
          <input
            type="text"
            data-testid="param-name"
            [value]="p.name"
            (input)="onFieldInput($index, 'name', $event)"
          />
          <select
            data-testid="param-type"
            [value]="p.type"
            (change)="onTypeChange($index, $event)"
          >
            @for (t of types; track t) {
              <option [value]="t" [selected]="t === p.type">{{ t }}</option>
            }
          </select>
          <select
            data-testid="param-cardinality"
            [value]="p.cardinality"
            (change)="onCardinalityChange($index, $event)"
          >
            @for (c of cardinalities; track c) {
              <option [value]="c" [selected]="c === p.cardinality">{{ c }}</option>
            }
          </select>
          <input
            type="text"
            data-testid="param-label"
            placeholder="label"
            [value]="p.label ?? ''"
            (input)="onTextInput($index, 'label', $event)"
          />
          <input
            type="text"
            data-testid="param-description"
            placeholder="description"
            [value]="p.description ?? ''"
            (input)="onTextInput($index, 'description', $event)"
          />
          @if (p.type === 'boolean') {
            <input
              type="checkbox"
              data-testid="param-default"
              [checked]="p.default === true"
              (change)="onDefaultCheckbox($index, $event)"
            />
          } @else {
            <input
              data-testid="param-default"
              placeholder="default"
              [type]="defaultInputType(p)"
              [value]="defaultDisplay(p)"
              (input)="onDefaultInput($index, $event)"
            />
          }
          @if (supportsEnum(p)) {
            <input
              type="text"
              data-testid="param-enum"
              placeholder="enum (comma-separated)"
              [value]="enumDisplay(p)"
              (input)="onEnumInput($index, $event)"
            />
          }
          <button
            type="button"
            data-testid="param-up"
            [disabled]="$index === 0"
            (click)="onMoveUp($index)"
          >↑</button>
          <button
            type="button"
            data-testid="param-down"
            [disabled]="$index === parameters().length - 1"
            (click)="onMoveDown($index)"
          >↓</button>
          <button
            type="button"
            data-testid="param-remove"
            (click)="onRemove($index)"
          >×</button>
        </div>
        @if (rowError(p.name); as msg) {
          <span class="text-danger" data-testid="param-lint-error">
            {{ msg }}
          </span>
        }
        </div>
      }
      <div>
        <button
          type="button"
          data-testid="param-add"
          (click)="onAdd()"
        >Add parameter</button>
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
