import { TestBed } from '@angular/core/testing';
import {
  PARAMETER_CARDINALITIES,
  PARAMETER_TYPES,
  type ParameterDeclaration,
} from 'common';
import { ParameterEditorComponent } from './parameter-editor.component';

function setup(
  parameters: ReadonlyArray<ParameterDeclaration>,
  body = '',
) {
  TestBed.configureTestingModule({ imports: [ParameterEditorComponent] });
  const fixture = TestBed.createComponent(ParameterEditorComponent);
  fixture.componentRef.setInput('parameters', parameters);
  fixture.componentRef.setInput('body', body);
  fixture.detectChanges();
  return {
    fixture,
    root: fixture.nativeElement as HTMLElement,
    component: fixture.componentInstance,
  };
}

function row(root: HTMLElement, name: string): HTMLElement {
  const node = root.querySelector<HTMLElement>(
    `[data-testid="param-row-${name}"]`,
  );
  if (!node) throw new Error(`expected a row for "${name}"`);
  return node;
}

describe('ParameterEditorComponent', () => {
  describe('tracer: render rows for declarations', () => {
    const parameters: ParameterDeclaration[] = [
      { name: 'country', type: 'string', cardinality: '1..1' },
      { name: 'year', type: 'integer', cardinality: '0..1' },
    ];

    it('renders one row per parameter declaration', () => {
      const { root } = setup(parameters);
      expect(
        root.querySelectorAll('[data-testid^="param-row-"]').length,
      ).toBe(2);
    });

    it('row shows name, type, and cardinality', () => {
      const { root } = setup(parameters);
      const r = row(root, 'country');
      const name = r.querySelector<HTMLInputElement>(
        '[data-testid="param-name"]',
      );
      const type = r.querySelector<HTMLSelectElement>(
        '[data-testid="param-type"]',
      );
      const card = r.querySelector<HTMLSelectElement>(
        '[data-testid="param-cardinality"]',
      );
      expect(name?.value).toBe('country');
      expect(type?.value).toBe('string');
      expect(card?.value).toBe('1..1');
    });
  });

  describe('editing the name', () => {
    const parameters: ParameterDeclaration[] = [
      { name: 'country', type: 'string', cardinality: '1..1' },
    ];

    it('emits parametersChange with the new name', () => {
      const { fixture, root, component } = setup(parameters);
      const emitted: ReadonlyArray<ParameterDeclaration>[] = [];
      component.parametersChange.subscribe((p) => emitted.push(p));

      const name = row(root, 'country').querySelector<HTMLInputElement>(
        '[data-testid="param-name"]',
      )!;
      name.value = 'place';
      name.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(emitted).toEqual([
        [{ name: 'place', type: 'string', cardinality: '1..1' }],
      ]);
    });
  });

  describe('type dropdown', () => {
    const parameters: ParameterDeclaration[] = [
      { name: 'country', type: 'string', cardinality: '1..1' },
    ];

    it('exposes exactly the nine declared types as options', () => {
      const { root } = setup(parameters);
      const select = row(root, 'country').querySelector<HTMLSelectElement>(
        '[data-testid="param-type"]',
      )!;
      const values = Array.from(select.options).map((o) => o.value);
      expect(values).toEqual([...PARAMETER_TYPES]);
    });

    it('emits parametersChange with the chosen type', () => {
      const { fixture, root, component } = setup(parameters);
      const emitted: ReadonlyArray<ParameterDeclaration>[] = [];
      component.parametersChange.subscribe((p) => emitted.push(p));

      const select = row(root, 'country').querySelector<HTMLSelectElement>(
        '[data-testid="param-type"]',
      )!;
      select.value = 'integer';
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(emitted).toEqual([
        [{ name: 'country', type: 'integer', cardinality: '1..1' }],
      ]);
    });
  });

  describe('cardinality dropdown', () => {
    const parameters: ParameterDeclaration[] = [
      { name: 'country', type: 'string', cardinality: '1..1' },
    ];

    it('exposes exactly the four declared cardinalities as options', () => {
      const { root } = setup(parameters);
      const select = row(root, 'country').querySelector<HTMLSelectElement>(
        '[data-testid="param-cardinality"]',
      )!;
      const values = Array.from(select.options).map((o) => o.value);
      expect(values).toEqual([...PARAMETER_CARDINALITIES]);
    });

    it('emits parametersChange with the chosen cardinality', () => {
      const { fixture, root, component } = setup(parameters);
      const emitted: ReadonlyArray<ParameterDeclaration>[] = [];
      component.parametersChange.subscribe((p) => emitted.push(p));

      const select = row(root, 'country').querySelector<HTMLSelectElement>(
        '[data-testid="param-cardinality"]',
      )!;
      select.value = '0..n';
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(emitted).toEqual([
        [{ name: 'country', type: 'string', cardinality: '0..n' }],
      ]);
    });
  });

  describe('label and description', () => {
    const parameters: ParameterDeclaration[] = [
      {
        name: 'country',
        type: 'string',
        cardinality: '1..1',
        label: 'Country',
        description: 'ISO 3166-1 alpha-2',
      },
    ];

    it('renders label and description pre-filled with the declared values', () => {
      const { root } = setup(parameters);
      const r = row(root, 'country');
      const label = r.querySelector<HTMLInputElement>(
        '[data-testid="param-label"]',
      )!;
      const desc = r.querySelector<HTMLInputElement>(
        '[data-testid="param-description"]',
      )!;
      expect(label.value).toBe('Country');
      expect(desc.value).toBe('ISO 3166-1 alpha-2');
    });

    it('emits parametersChange with the updated label', () => {
      const { fixture, root, component } = setup(parameters);
      const emitted: ReadonlyArray<ParameterDeclaration>[] = [];
      component.parametersChange.subscribe((p) => emitted.push(p));

      const label = row(root, 'country').querySelector<HTMLInputElement>(
        '[data-testid="param-label"]',
      )!;
      label.value = 'Pays';
      label.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(emitted[0]?.[0].label).toBe('Pays');
    });

    it('emits parametersChange with the updated description', () => {
      const { fixture, root, component } = setup(parameters);
      const emitted: ReadonlyArray<ParameterDeclaration>[] = [];
      component.parametersChange.subscribe((p) => emitted.push(p));

      const desc = row(root, 'country').querySelector<HTMLInputElement>(
        '[data-testid="param-description"]',
      )!;
      desc.value = 'Code pays';
      desc.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(emitted[0]?.[0].description).toBe('Code pays');
    });
  });

  describe('add row', () => {
    it('emits a list with a new empty-named string/1..1 declaration appended', () => {
      const parameters: ParameterDeclaration[] = [
        { name: 'country', type: 'string', cardinality: '1..1' },
      ];
      const { fixture, root, component } = setup(parameters);
      const emitted: ReadonlyArray<ParameterDeclaration>[] = [];
      component.parametersChange.subscribe((p) => emitted.push(p));

      const add = root.querySelector<HTMLButtonElement>(
        '[data-testid="param-add"]',
      )!;
      add.click();
      fixture.detectChanges();

      expect(emitted.length).toBe(1);
      const next = emitted[0];
      expect(next.length).toBe(2);
      expect(next[0]).toEqual(parameters[0]);
      expect(next[1]).toEqual({
        name: '',
        type: 'string',
        cardinality: '1..1',
      });
    });

    it('exposes the add button even with no rows', () => {
      const { root } = setup([]);
      expect(
        root.querySelector('[data-testid="param-add"]'),
      ).not.toBeNull();
    });
  });

  describe('remove row', () => {
    const parameters: ParameterDeclaration[] = [
      { name: 'country', type: 'string', cardinality: '1..1' },
      { name: 'year', type: 'integer', cardinality: '0..1' },
    ];

    it('drops the row and emits the shorter list', () => {
      const { fixture, root, component } = setup(parameters);
      const emitted: ReadonlyArray<ParameterDeclaration>[] = [];
      component.parametersChange.subscribe((p) => emitted.push(p));

      const remove = row(root, 'country').querySelector<HTMLButtonElement>(
        '[data-testid="param-remove"]',
      )!;
      remove.click();
      fixture.detectChanges();

      expect(emitted).toEqual([
        [{ name: 'year', type: 'integer', cardinality: '0..1' }],
      ]);
    });
  });

  describe('reorder rows', () => {
    const parameters: ParameterDeclaration[] = [
      { name: 'a', type: 'string', cardinality: '1..1' },
      { name: 'b', type: 'string', cardinality: '1..1' },
      { name: 'c', type: 'string', cardinality: '1..1' },
    ];

    it('move-up swaps with the previous row and emits', () => {
      const { fixture, root, component } = setup(parameters);
      const emitted: ReadonlyArray<ParameterDeclaration>[] = [];
      component.parametersChange.subscribe((p) => emitted.push(p));

      const up = row(root, 'b').querySelector<HTMLButtonElement>(
        '[data-testid="param-up"]',
      )!;
      up.click();
      fixture.detectChanges();

      expect(emitted[0]?.map((p) => p.name)).toEqual(['b', 'a', 'c']);
    });

    it('move-down swaps with the next row and emits', () => {
      const { fixture, root, component } = setup(parameters);
      const emitted: ReadonlyArray<ParameterDeclaration>[] = [];
      component.parametersChange.subscribe((p) => emitted.push(p));

      const down = row(root, 'b').querySelector<HTMLButtonElement>(
        '[data-testid="param-down"]',
      )!;
      down.click();
      fixture.detectChanges();

      expect(emitted[0]?.map((p) => p.name)).toEqual(['a', 'c', 'b']);
    });

    it('first row cannot move up (button disabled)', () => {
      const { root } = setup(parameters);
      const up = row(root, 'a').querySelector<HTMLButtonElement>(
        '[data-testid="param-up"]',
      )!;
      expect(up.disabled).toBe(true);
    });

    it('last row cannot move down (button disabled)', () => {
      const { root } = setup(parameters);
      const down = row(root, 'c').querySelector<HTMLButtonElement>(
        '[data-testid="param-down"]',
      )!;
      expect(down.disabled).toBe(true);
    });
  });

  describe('default input adapts to declared type', () => {
    it('renders input[type=number] for integer', () => {
      const { root } = setup([
        { name: 'year', type: 'integer', cardinality: '1..1', default: 2024 },
      ]);
      const def = row(root, 'year').querySelector<HTMLInputElement>(
        '[data-testid="param-default"]',
      )!;
      expect(def.type).toBe('number');
      expect(def.value).toBe('2024');
    });

    it('renders input[type=date] for date', () => {
      const { root } = setup([
        { name: 'asOf', type: 'date', cardinality: '1..1' },
      ]);
      const def = row(root, 'asOf').querySelector<HTMLInputElement>(
        '[data-testid="param-default"]',
      )!;
      expect(def.type).toBe('date');
    });

    it('renders a checkbox for boolean', () => {
      const { root } = setup([
        { name: 'live', type: 'boolean', cardinality: '1..1', default: true },
      ]);
      const def = row(root, 'live').querySelector<HTMLInputElement>(
        '[data-testid="param-default"]',
      )!;
      expect(def.type).toBe('checkbox');
      expect(def.checked).toBe(true);
    });

    it('emits parametersChange with a numeric default when integer input changes', () => {
      const parameters: ParameterDeclaration[] = [
        { name: 'year', type: 'integer', cardinality: '1..1' },
      ];
      const { fixture, root, component } = setup(parameters);
      const emitted: ReadonlyArray<ParameterDeclaration>[] = [];
      component.parametersChange.subscribe((p) => emitted.push(p));

      const def = row(root, 'year').querySelector<HTMLInputElement>(
        '[data-testid="param-default"]',
      )!;
      def.value = '2025';
      def.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(emitted[0]?.[0].default).toBe(2025);
    });

    it('emits parametersChange with a boolean default when checkbox toggles', () => {
      const parameters: ParameterDeclaration[] = [
        { name: 'live', type: 'boolean', cardinality: '1..1' },
      ];
      const { fixture, root, component } = setup(parameters);
      const emitted: ReadonlyArray<ParameterDeclaration>[] = [];
      component.parametersChange.subscribe((p) => emitted.push(p));

      const def = row(root, 'live').querySelector<HTMLInputElement>(
        '[data-testid="param-default"]',
      )!;
      def.checked = true;
      def.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(emitted[0]?.[0].default).toBe(true);
    });

    it('clears default when text input is emptied', () => {
      const parameters: ParameterDeclaration[] = [
        { name: 'country', type: 'string', cardinality: '1..1', default: 'CA' },
      ];
      const { fixture, root, component } = setup(parameters);
      const emitted: ReadonlyArray<ParameterDeclaration>[] = [];
      component.parametersChange.subscribe((p) => emitted.push(p));

      const def = row(root, 'country').querySelector<HTMLInputElement>(
        '[data-testid="param-default"]',
      )!;
      def.value = '';
      def.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(emitted[0]?.[0]).not.toHaveProperty('default');
    });
  });

  describe('enum list editor', () => {
    it('renders an enum field on a string parameter, pre-filled with comma-separated values', () => {
      const { root } = setup([
        {
          name: 'lang',
          type: 'string',
          cardinality: '1..1',
          enum: ['en', 'fr', 'de'],
        },
      ]);
      const enumInput = row(root, 'lang').querySelector<HTMLInputElement>(
        '[data-testid="param-enum"]',
      )!;
      expect(enumInput.value).toBe('en, fr, de');
    });

    it('parses a comma-separated list and emits enum as an array of strings', () => {
      const parameters: ParameterDeclaration[] = [
        { name: 'lang', type: 'string', cardinality: '1..1' },
      ];
      const { fixture, root, component } = setup(parameters);
      const emitted: ReadonlyArray<ParameterDeclaration>[] = [];
      component.parametersChange.subscribe((p) => emitted.push(p));

      const enumInput = row(root, 'lang').querySelector<HTMLInputElement>(
        '[data-testid="param-enum"]',
      )!;
      enumInput.value = 'en, fr, de';
      enumInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(emitted[0]?.[0].enum).toEqual(['en', 'fr', 'de']);
    });

    it('parses numeric entries when the type is integer', () => {
      const parameters: ParameterDeclaration[] = [
        { name: 'year', type: 'integer', cardinality: '1..1' },
      ];
      const { fixture, root, component } = setup(parameters);
      const emitted: ReadonlyArray<ParameterDeclaration>[] = [];
      component.parametersChange.subscribe((p) => emitted.push(p));

      const enumInput = row(root, 'year').querySelector<HTMLInputElement>(
        '[data-testid="param-enum"]',
      )!;
      enumInput.value = '2023, 2024, 2025';
      enumInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(emitted[0]?.[0].enum).toEqual([2023, 2024, 2025]);
    });

    it('clears the enum when the input is emptied', () => {
      const parameters: ParameterDeclaration[] = [
        {
          name: 'lang',
          type: 'string',
          cardinality: '1..1',
          enum: ['en', 'fr'],
        },
      ];
      const { fixture, root, component } = setup(parameters);
      const emitted: ReadonlyArray<ParameterDeclaration>[] = [];
      component.parametersChange.subscribe((p) => emitted.push(p));

      const enumInput = row(root, 'lang').querySelector<HTMLInputElement>(
        '[data-testid="param-enum"]',
      )!;
      enumInput.value = '';
      enumInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(emitted[0]?.[0]).not.toHaveProperty('enum');
    });

    it('does not render the enum field for boolean (closed type)', () => {
      const { root } = setup([
        { name: 'live', type: 'boolean', cardinality: '1..1' },
      ]);
      expect(
        row(root, 'live').querySelector('[data-testid="param-enum"]'),
      ).toBeNull();
    });

    it('does not render the enum field for langString (structured type)', () => {
      const { root } = setup([
        { name: 'title', type: 'langString', cardinality: '1..1' },
      ]);
      expect(
        row(root, 'title').querySelector('[data-testid="param-enum"]'),
      ).toBeNull();
    });
  });

  describe('inline lint', () => {
    it('flags a declared parameter that is not used in the body', () => {
      const { root } = setup(
        [{ name: 'country', type: 'string', cardinality: '1..1' }],
        'SELECT ?x WHERE { ?x ?y ?z }',
      );
      const err = row(root, 'country').querySelector<HTMLElement>(
        '[data-testid="param-lint-error"]',
      );
      expect(err).not.toBeNull();
      expect(err?.textContent?.toLowerCase() ?? '').toContain('not used');
    });

    it('shows no row error when every declared parameter appears in the body', () => {
      const { root } = setup(
        [{ name: 'country', type: 'string', cardinality: '1..1' }],
        'SELECT ?s WHERE { ?s :inCountry ?country }',
      );
      expect(
        row(root, 'country').querySelector('[data-testid="param-lint-error"]'),
      ).toBeNull();
    });

    it('shows a banner when a body variable is not declared (and at least one declaration exists)', () => {
      const { root } = setup(
        [{ name: 'country', type: 'string', cardinality: '1..1' }],
        'SELECT ?s WHERE { ?s :inCountry ?country ; :asOf ?year }',
      );
      const banner = root.querySelector<HTMLElement>(
        '[data-testid="param-lint-banner"]',
      );
      expect(banner).not.toBeNull();
      expect(banner?.textContent ?? '').toContain('year');
    });

    it('shows no banner when there are no declarations (plain SPARQL is fine)', () => {
      const { root } = setup([], 'SELECT ?s WHERE { ?s ?p ?o }');
      expect(
        root.querySelector('[data-testid="param-lint-banner"]'),
      ).toBeNull();
    });
  });
});
