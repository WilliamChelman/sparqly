import {
  ChangeDetectionStrategy,
  Component,
  computed,
  EventEmitter,
  input,
  Output,
  signal,
} from '@angular/core';
import { ButtonComponent } from '@app/modules/button';
import { EyebrowComponent } from '@app/modules/eyebrow';
import { InputComponent, SelectComponent } from '@app/modules/input';
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
  imports: [ButtonComponent, EyebrowComponent, InputComponent, SelectComponent],
  template: `
    <form
      (submit)="onSubmit($event)"
      class="rounded-lg border border-border-muted bg-surface p-4 shadow-sm"
    >
      <h3 app-eyebrow class="mb-3 block">Bindings</h3>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        @for (p of parameters(); track p.name) {
          <label
            class="flex flex-col gap-1"
            [attr.for]="'param-field-input-' + p.name"
            [attr.data-testid]="'param-field-' + p.name"
          >
            <span class="flex items-baseline gap-1.5">
              <span class="text-[13px] font-medium text-foreground">
                {{ p.label ?? p.name }}
              </span>
              <span class="font-mono text-[10px] text-foreground-faint">
                ?{{ p.name }}
              </span>
            </span>
            @if (p.description) {
              <span class="text-[11px] text-foreground-faint">{{ p.description }}</span>
            }
            @if (isMulti(p)) {
              <span
                class="flex flex-wrap items-center gap-1 rounded-md border border-border bg-surface px-2 py-1.5 shadow-sm focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30"
              >
                @for (chip of chips(p.name); track $index) {
                  <span
                    class="inline-flex items-center gap-1 rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-foreground"
                  >
                    <span data-testid="param-chip">{{ chip }}</span>
                    <button
                      type="button"
                      class="cursor-pointer text-foreground-faint hover:text-removed"
                      data-testid="param-chip-remove"
                      (click)="onChipRemove(p, $index)"
                    >×</button>
                  </span>
                }
                <input
                  type="text"
                  class="min-w-[6rem] flex-1 border-0 bg-transparent text-[13px] text-foreground outline-none placeholder:text-foreground-faint"
                  placeholder="add… (Enter)"
                  data-testid="param-chip-input"
                  [attr.id]="'param-field-input-' + p.name"
                  [value]="adderText(p.name)"
                  (input)="onAdderInput(p, $event)"
                  (keydown.enter)="onAdderEnter(p, $event)"
                />
              </span>
            } @else if (p.enum) {
              <select
                app-input
                [attr.id]="'param-field-input-' + p.name"
                [value]="rawValue(p.name)"
                (change)="onSelectChange(p, $event)"
              >
                @for (opt of p.enum; track opt) {
                  <option [value]="opt">{{ opt }}</option>
                }
              </select>
            } @else if (p.type === 'boolean') {
              <span
                class="inline-flex h-[30px] items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-[13px] text-foreground-muted shadow-sm"
              >
                <input
                  type="checkbox"
                  [attr.id]="'param-field-input-' + p.name"
                  [checked]="booleanValue(p.name)"
                  (change)="onCheckboxChange(p, $event)"
                />
                <span>{{ booleanValue(p.name) ? 'true' : 'false' }}</span>
              </span>
            } @else if (p.type === 'langString') {
              <span class="flex gap-1">
                <input
                  app-input
                  class="flex-1"
                  type="text"
                  placeholder="value"
                  data-param-part="value"
                  [attr.id]="'param-field-input-' + p.name"
                  [value]="langPart(p.name, 'value')"
                  (input)="onLangInput(p, 'value', $event)"
                />
                <input
                  app-input
                  class="w-20 font-mono"
                  type="text"
                  placeholder="lang"
                  data-param-part="lang"
                  [value]="langPart(p.name, 'lang')"
                  (input)="onLangInput(p, 'lang', $event)"
                />
              </span>
            } @else {
              <input
                app-input
                [attr.id]="'param-field-input-' + p.name"
                [type]="inputTypeFor(p)"
                [attr.data-param-type]="p.type"
                [value]="rawValue(p.name)"
                (input)="onInput(p, $event)"
              />
            }
            @if (errors()[p.name]; as e) {
              <span
                class="text-[12px] text-removed"
                [attr.data-testid]="'param-error-' + p.name"
              >{{ e }}</span>
            }
          </label>
        }
      </div>
      <div class="mt-4 flex justify-end">
        <button
          app-btn
          variant="primary"
          type="submit"
          data-testid="param-form-submit"
        >Run with bindings</button>
      </div>
    </form>
  `,
})
export class ParameterFormComponent {
  readonly parameters = input.required<ReadonlyArray<ParameterDeclaration>>();
  readonly initialBindings = input<ParameterBindings | undefined>(undefined);

  @Output() readonly submitBindings = new EventEmitter<ParameterBindings>();

  private readonly overrides = signal<Record<string, unknown>>({});
  private readonly defaults = computed<Record<string, unknown>>(() => {
    const seed: Record<string, unknown> = {};
    for (const p of this.parameters()) {
      if (p.default !== undefined) seed[p.name] = p.default;
    }
    return seed;
  });
  private readonly initial = computed<Record<string, unknown>>(() => {
    const v = this.initialBindings();
    return v ? { ...v } : {};
  });
  private readonly resolved = computed<Record<string, unknown>>(() => ({
    ...this.defaults(),
    ...this.initial(),
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

  private readonly submitErrors = signal<Record<string, string>>({});
  private readonly initialErrors = computed<Record<string, string>>(() => {
    const ib = this.initialBindings();
    if (!ib) return {};
    const overrides = this.overrides();
    const out: Record<string, string> = {};
    for (const p of this.parameters()) {
      if (overrides[p.name] !== undefined) continue;
      if (ib[p.name] === undefined) continue;
      const result = validate([p], { [p.name]: ib[p.name] });
      if (result.isErr()) out[p.name] = errorMessage(result.error);
    }
    return out;
  });
  readonly errors = computed<Record<string, string>>(() => ({
    ...this.initialErrors(),
    ...this.submitErrors(),
  }));

  onSubmit(event: Event): void {
    event.preventDefault();
    const bindings = this.buildBindings();
    const result = validate(this.parameters(), bindings);
    if (result.isErr()) {
      this.submitErrors.set({
        [result.error.name]: errorMessage(result.error),
      });
      return;
    }
    this.submitErrors.set({});
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
