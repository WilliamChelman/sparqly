import {
  ChangeDetectionStrategy,
  Component,
  computed,
  EventEmitter,
  input,
  Output,
  signal,
} from '@angular/core';
import {
  validate,
  type BindingError,
  type ParameterBindings,
  type ParameterDeclaration,
} from 'common';

@Component({
  selector: 'app-parameter-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form (submit)="onSubmit($event)">
      @for (p of parameters(); track p.name) {
        <div
          class="flex flex-col gap-1"
          [attr.data-testid]="'param-field-' + p.name"
        >
          <span class="text-foreground-muted">{{ p.label ?? p.name }}</span>
          @if (isMulti(p)) {
            <span class="flex flex-wrap gap-1">
              @for (chip of chips(p.name); track $index) {
                <span class="flex items-center gap-1">
                  <span data-testid="param-chip">{{ chip }}</span>
                  <button
                    type="button"
                    data-testid="param-chip-remove"
                    (click)="onChipRemove(p, $index)"
                  >×</button>
                </span>
              }
              <input
                type="text"
                data-testid="param-chip-input"
                [value]="adderText(p.name)"
                (input)="onAdderInput(p, $event)"
                (keydown.enter)="onAdderEnter(p, $event)"
              />
            </span>
          } @else if (p.enum) {
            <select
              [value]="rawValue(p.name)"
              (change)="onSelectChange(p, $event)"
            >
              @for (opt of p.enum; track opt) {
                <option [value]="opt">{{ opt }}</option>
              }
            </select>
          } @else if (p.type === 'boolean') {
            <input
              type="checkbox"
              [checked]="booleanValue(p.name)"
              (change)="onCheckboxChange(p, $event)"
            />
          } @else if (p.type === 'langString') {
            <span class="flex gap-1">
              <input
                type="text"
                data-param-part="value"
                [value]="langPart(p.name, 'value')"
                (input)="onLangInput(p, 'value', $event)"
              />
              <input
                type="text"
                data-param-part="lang"
                [value]="langPart(p.name, 'lang')"
                (input)="onLangInput(p, 'lang', $event)"
              />
            </span>
          } @else {
            <input
              [type]="inputTypeFor(p)"
              [attr.data-param-type]="p.type"
              [value]="rawValue(p.name)"
              (input)="onInput(p, $event)"
            />
          }
          @if (errors()[p.name]; as e) {
            <span
              class="text-danger"
              [attr.data-testid]="'param-error-' + p.name"
            >{{ e }}</span>
          }
        </div>
      }
      <button type="submit" data-testid="param-form-submit">Run</button>
    </form>
  `,
})
export class ParameterFormComponent {
  readonly parameters = input.required<ReadonlyArray<ParameterDeclaration>>();

  @Output() readonly submitBindings = new EventEmitter<ParameterBindings>();

  private readonly overrides = signal<Record<string, unknown>>({});
  private readonly defaults = computed<Record<string, unknown>>(() => {
    const seed: Record<string, unknown> = {};
    for (const p of this.parameters()) {
      if (p.default !== undefined) seed[p.name] = p.default;
    }
    return seed;
  });
  private readonly resolved = computed<Record<string, unknown>>(() => ({
    ...this.defaults(),
    ...this.overrides(),
  }));

  rawValue(name: string): string {
    const v = this.resolved()[name];
    if (v === undefined || v === null) return '';
    return String(v);
  }

  inputTypeFor(p: ParameterDeclaration): string {
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

  booleanValue(name: string): boolean {
    return this.resolved()[name] === true;
  }

  onCheckboxChange(p: ParameterDeclaration, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.overrides.update((prev) => ({ ...prev, [p.name]: checked }));
  }

  langPart(name: string, part: 'value' | 'lang'): string {
    const v = this.resolved()[name];
    if (v && typeof v === 'object') {
      const x = (v as Record<string, unknown>)[part];
      return typeof x === 'string' ? x : '';
    }
    return '';
  }

  onLangInput(
    p: ParameterDeclaration,
    part: 'value' | 'lang',
    event: Event,
  ): void {
    const raw = (event.target as HTMLInputElement).value;
    this.overrides.update((prev) => {
      const current = (prev[p.name] ?? this.defaults()[p.name] ?? {}) as Record<
        string,
        unknown
      >;
      return { ...prev, [p.name]: { ...current, [part]: raw } };
    });
  }

  onInput(p: ParameterDeclaration, event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const value = parseRawForType(p, raw);
    this.overrides.update((prev) => ({ ...prev, [p.name]: value }));
  }

  isMulti(p: ParameterDeclaration): boolean {
    return p.cardinality === '0..n' || p.cardinality === '1..n';
  }

  chips(name: string): unknown[] {
    const v = this.resolved()[name];
    return Array.isArray(v) ? v : [];
  }

  private readonly adders = signal<Record<string, string>>({});

  adderText(name: string): string {
    return this.adders()[name] ?? '';
  }

  onAdderInput(p: ParameterDeclaration, event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    this.adders.update((prev) => ({ ...prev, [p.name]: raw }));
  }

  onAdderEnter(p: ParameterDeclaration, event: Event): void {
    event.preventDefault();
    const raw = this.adders()[p.name] ?? '';
    if (raw === '') return;
    const parsed = parseRawForType(p, raw);
    const current = this.chips(p.name);
    const next = [...current, parsed];
    this.overrides.update((prev) => ({ ...prev, [p.name]: next }));
    this.adders.update((prev) => ({ ...prev, [p.name]: '' }));
  }

  onChipRemove(p: ParameterDeclaration, index: number): void {
    const current = this.chips(p.name);
    const next = current.filter((_, i) => i !== index);
    this.overrides.update((prev) => ({ ...prev, [p.name]: next }));
  }

  onSelectChange(p: ParameterDeclaration, event: Event): void {
    const raw = (event.target as HTMLSelectElement).value;
    const value = parseRawForType(p, raw);
    this.overrides.update((prev) => ({ ...prev, [p.name]: value }));
  }

  readonly errors = signal<Record<string, string>>({});

  onSubmit(event: Event): void {
    event.preventDefault();
    const bindings = this.buildBindings();
    const result = validate(this.parameters(), bindings);
    if (result.isErr()) {
      this.errors.set({ [result.error.name]: errorMessage(result.error) });
      return;
    }
    this.errors.set({});
    this.submitBindings.emit(bindings);
  }

  private buildBindings(): ParameterBindings {
    const resolved = this.resolved();
    const out: Record<string, unknown> = {};
    for (const p of this.parameters()) {
      const v = resolved[p.name];
      if (v === undefined || v === null) continue;
      if (typeof v === 'string' && v.length === 0) continue;
      out[p.name] = v;
    }
    return out;
  }
}

function parseRawForType(p: ParameterDeclaration, raw: string): unknown {
  if (raw === '') return '';
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

function errorMessage(err: BindingError): string {
  if (err.kind === 'cardinality-violation') return 'required';
  return `expected ${err.expected}`;
}
