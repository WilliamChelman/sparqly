import { TestBed } from '@angular/core/testing';
import type { ParameterBindings, ParameterDeclaration } from 'common';
import { ParameterFormComponent } from './parameter-form.component';

function setup(
  parameters: ReadonlyArray<ParameterDeclaration>,
  initialBindings?: ParameterBindings,
) {
  TestBed.configureTestingModule({ imports: [ParameterFormComponent] });
  const fixture = TestBed.createComponent(ParameterFormComponent);
  fixture.componentRef.setInput('parameters', parameters);
  if (initialBindings !== undefined) {
    fixture.componentRef.setInput('initialBindings', initialBindings);
  }
  fixture.detectChanges();
  return {
    fixture,
    root: fixture.nativeElement as HTMLElement,
    component: fixture.componentInstance,
  };
}

function field(root: HTMLElement, name: string): HTMLElement {
  const node = root.querySelector<HTMLElement>(
    `[data-testid="param-field-${name}"]`,
  );
  if (!node) throw new Error(`expected a param field for "${name}"`);
  return node;
}

function input(root: HTMLElement, name: string): HTMLInputElement {
  return field(root, name).querySelector('input') as HTMLInputElement;
}

function submitForm(root: HTMLElement): void {
  const form = root.querySelector('form') as HTMLFormElement;
  form.dispatchEvent(new Event('submit'));
}

describe('ParameterFormComponent', () => {
  describe('widget matrix per type', () => {
    it('renders a parameter with an enum declaration as a dropdown of the declared values', () => {
      const parameters: ParameterDeclaration[] = [
        {
          name: 'lang',
          type: 'string',
          cardinality: '1..1',
          default: 'en',
          enum: ['en', 'fr', 'de'],
        },
      ];
      const { fixture, root, component } = setup(parameters);
      const select = field(root, 'lang').querySelector(
        'select',
      ) as HTMLSelectElement;
      expect(select).toBeTruthy();
      const optionValues = Array.from(select.options).map((o) => o.value);
      expect(optionValues).toEqual(['en', 'fr', 'de']);
      expect(select.value).toBe('en');
      const emitted: ParameterBindings[] = [];
      component.submitBindings.subscribe((b: ParameterBindings) =>
        emitted.push(b),
      );
      select.value = 'fr';
      select.dispatchEvent(new Event('change'));
      submitForm(root);
      fixture.detectChanges();
      expect(emitted).toEqual([{ lang: 'fr' }]);
    });

    it('renders a langString parameter as a tagged value+lang input pair, emits {value, lang}', () => {
      const parameters: ParameterDeclaration[] = [
        {
          name: 'title',
          type: 'langString',
          cardinality: '1..1',
          default: { value: 'hello', lang: 'en' },
        },
      ];
      const { fixture, root, component } = setup(parameters);
      const value = field(root, 'title').querySelector(
        '[data-param-part="value"]',
      ) as HTMLInputElement;
      const lang = field(root, 'title').querySelector(
        '[data-param-part="lang"]',
      ) as HTMLInputElement;
      expect(value).toBeTruthy();
      expect(lang).toBeTruthy();
      expect(value.value).toBe('hello');
      expect(lang.value).toBe('en');
      const emitted: ParameterBindings[] = [];
      component.submitBindings.subscribe((b: ParameterBindings) =>
        emitted.push(b),
      );
      value.value = 'bonjour';
      value.dispatchEvent(new Event('input'));
      lang.value = 'fr';
      lang.dispatchEvent(new Event('input'));
      submitForm(root);
      fixture.detectChanges();
      expect(emitted).toEqual([{ title: { value: 'bonjour', lang: 'fr' } }]);
    });

    it('renders an iri parameter as a typed IRI input, emits the value as a string', () => {
      const parameters: ParameterDeclaration[] = [
        {
          name: 'subj',
          type: 'iri',
          cardinality: '1..1',
          default: 'http://example.org/x',
        },
      ];
      const { fixture, root, component } = setup(parameters);
      const el = input(root, 'subj');
      expect(el.dataset['paramType']).toBe('iri');
      expect(el.value).toBe('http://example.org/x');
      const emitted: ParameterBindings[] = [];
      component.submitBindings.subscribe((b: ParameterBindings) =>
        emitted.push(b),
      );
      el.value = 'http://example.org/y';
      el.dispatchEvent(new Event('input'));
      submitForm(root);
      fixture.detectChanges();
      expect(emitted).toEqual([{ subj: 'http://example.org/y' }]);
    });

    it('renders a date parameter as input[type=date], emits the value as the picker string', () => {
      const parameters: ParameterDeclaration[] = [
        { name: 'asOf', type: 'date', cardinality: '1..1' },
      ];
      const { fixture, root, component } = setup(parameters);
      const el = input(root, 'asOf');
      expect(el.type).toBe('date');
      const emitted: ParameterBindings[] = [];
      component.submitBindings.subscribe((b: ParameterBindings) =>
        emitted.push(b),
      );
      el.value = '2024-12-31';
      el.dispatchEvent(new Event('input'));
      submitForm(root);
      fixture.detectChanges();
      expect(emitted).toEqual([{ asOf: '2024-12-31' }]);
    });

    it('renders a boolean parameter as a checkbox toggle, emits the value as a boolean', () => {
      const parameters: ParameterDeclaration[] = [
        { name: 'live', type: 'boolean', cardinality: '1..1', default: false },
      ];
      const { fixture, root, component } = setup(parameters);
      const el = input(root, 'live');
      expect(el.type).toBe('checkbox');
      expect(el.checked).toBe(false);
      const emitted: ParameterBindings[] = [];
      component.submitBindings.subscribe((b: ParameterBindings) =>
        emitted.push(b),
      );
      el.checked = true;
      el.dispatchEvent(new Event('change'));
      submitForm(root);
      fixture.detectChanges();
      expect(emitted).toEqual([{ live: true }]);
    });

    it('renders an integer parameter as input[type=number], emits the value as a number', () => {
      const parameters: ParameterDeclaration[] = [
        { name: 'year', type: 'integer', cardinality: '1..1', default: 2024 },
      ];
      const { fixture, root, component } = setup(parameters);
      const el = input(root, 'year');
      expect(el.type).toBe('number');
      expect(el.value).toBe('2024');
      const emitted: ParameterBindings[] = [];
      component.submitBindings.subscribe((b: ParameterBindings) =>
        emitted.push(b),
      );
      el.value = '2025';
      el.dispatchEvent(new Event('input'));
      submitForm(root);
      fixture.detectChanges();
      expect(emitted).toEqual([{ year: 2025 }]);
    });
  });

  describe('multi-cardinality (upper bound n)', () => {
    const parameters: ParameterDeclaration[] = [
      {
        name: 'countries',
        type: 'string',
        cardinality: '1..n',
        default: ['CA', 'US'],
      },
    ];

    it('pre-fills with a chip per default array value', () => {
      const { root } = setup(parameters);
      const chips = field(root, 'countries').querySelectorAll(
        '[data-testid="param-chip"]',
      );
      expect(Array.from(chips).map((c) => c.textContent?.trim())).toEqual([
        'CA',
        'US',
      ]);
    });

    it('adds a new chip when the user types and presses Enter, emits the chips as an array', () => {
      const { fixture, root, component } = setup(parameters);
      const adder = field(root, 'countries').querySelector(
        '[data-testid="param-chip-input"]',
      ) as HTMLInputElement;
      adder.value = 'FR';
      adder.dispatchEvent(new Event('input'));
      adder.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
      fixture.detectChanges();
      const chips = Array.from(
        field(root, 'countries').querySelectorAll(
          '[data-testid="param-chip"]',
        ),
      ).map((c) => c.textContent?.trim());
      expect(chips).toEqual(['CA', 'US', 'FR']);

      const emitted: ParameterBindings[] = [];
      component.submitBindings.subscribe((b: ParameterBindings) =>
        emitted.push(b),
      );
      submitForm(root);
      fixture.detectChanges();
      expect(emitted).toEqual([{ countries: ['CA', 'US', 'FR'] }]);
    });
  });

  describe('optional (0..1) parameter left blank', () => {
    const parameters: ParameterDeclaration[] = [
      { name: 'country', type: 'string', cardinality: '1..1', default: 'CA' },
      { name: 'year', type: 'string', cardinality: '0..1' },
    ];

    it('submits successfully and omits the blank optional from the bindings', () => {
      const { fixture, root, component } = setup(parameters);
      const emitted: ParameterBindings[] = [];
      component.submitBindings.subscribe((b: ParameterBindings) =>
        emitted.push(b),
      );
      submitForm(root);
      fixture.detectChanges();
      expect(emitted).toEqual([{ country: 'CA' }]);
      expect(emitted[0]).not.toHaveProperty('year');
    });
  });

  describe('required (1..1) parameter left blank', () => {
    const parameters: ParameterDeclaration[] = [
      { name: 'country', type: 'string', cardinality: '1..1' },
    ];

    it('blocks submit and surfaces an inline error against the offending field', () => {
      const { fixture, root, component } = setup(parameters);
      const emitted: ParameterBindings[] = [];
      component.submitBindings.subscribe((b: ParameterBindings) =>
        emitted.push(b),
      );
      submitForm(root);
      fixture.detectChanges();
      expect(emitted).toEqual([]);
      const err = field(root, 'country').querySelector(
        '[data-testid="param-error-country"]',
      );
      expect(err).toBeTruthy();
    });
  });

  describe('initialBindings input', () => {
    it('pre-fills a field from initialBindings overriding the declared default', () => {
      const parameters: ParameterDeclaration[] = [
        {
          name: 'country',
          type: 'string',
          cardinality: '1..1',
          default: 'CA',
        },
      ];
      const { root } = setup(parameters, { country: 'FR' });
      expect(input(root, 'country').value).toBe('FR');
    });

    it('surfaces a field error for an invalid initial binding without blocking render', () => {
      const parameters: ParameterDeclaration[] = [
        { name: 'year', type: 'integer', cardinality: '1..1' },
        { name: 'country', type: 'string', cardinality: '1..1' },
      ];
      const { root } = setup(parameters, { year: 'notanumber' });
      expect(field(root, 'year')).toBeTruthy();
      expect(field(root, 'country')).toBeTruthy();
      const err = field(root, 'year').querySelector(
        '[data-testid="param-error-year"]',
      );
      expect(err).toBeTruthy();
    });

    it('falls back to declared defaults for fields not present in initialBindings', () => {
      const parameters: ParameterDeclaration[] = [
        {
          name: 'country',
          type: 'string',
          cardinality: '1..1',
          default: 'CA',
        },
        {
          name: 'year',
          type: 'string',
          cardinality: '1..1',
          default: '2024',
        },
      ];
      const { root } = setup(parameters, { country: 'FR' });
      expect(input(root, 'country').value).toBe('FR');
      expect(input(root, 'year').value).toBe('2024');
    });

    it('pre-fills the chip-multi widget from an array initialBinding', () => {
      const parameters: ParameterDeclaration[] = [
        { name: 'tag', type: 'string', cardinality: '1..n' },
      ];
      const { root } = setup(parameters, { tag: ['a', 'b'] });
      const chips = field(root, 'tag').querySelectorAll(
        '[data-testid="param-chip"]',
      );
      expect(Array.from(chips).map((c) => c.textContent?.trim())).toEqual([
        'a',
        'b',
      ]);
    });
  });

  describe('tracer: single required string parameter with a default', () => {
    const parameters: ParameterDeclaration[] = [
      {
        name: 'country',
        type: 'string',
        cardinality: '1..1',
        default: 'CA',
      },
    ];

    it('renders a text input pre-filled with the declared default', () => {
      const { root } = setup(parameters);
      expect(input(root, 'country').value).toBe('CA');
    });

    it('submits the bindings as { name: value } when the form is submitted', () => {
      const { fixture, root, component } = setup(parameters);
      const emitted: ParameterBindings[] = [];
      component.submitBindings.subscribe((b: ParameterBindings) =>
        emitted.push(b),
      );
      submitForm(root);
      fixture.detectChanges();
      expect(emitted).toEqual([{ country: 'CA' }]);
    });
  });
});
