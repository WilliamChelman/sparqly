import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ConfigService, type DisplayContext } from '@app/core';
import type { ParameterDeclaration } from 'common';
import { EditorFrameComponent } from './editor-frame.component';

function createWithContext(
  context: DisplayContext = { prefixes: {} },
): EditorFrameComponent {
  TestBed.configureTestingModule({
    imports: [EditorFrameComponent],
    providers: [
      { provide: ConfigService, useValue: { context: () => of(context) } },
    ],
  });
  const fixture = TestBed.createComponent(EditorFrameComponent);
  return fixture.componentInstance;
}

describe('EditorFrameComponent (DOM-free)', () => {
  describe('pickQuickQuery emits a body via valueChange', () => {
    it('emits a SELECT ?s ?p ?o body for select-spo, prefixed with the context header', () => {
      const inst = createWithContext({
        prefixes: { ex: 'http://example.org/' },
      });
      const emitted: string[] = [];
      inst.valueChange.subscribe((v) => emitted.push(v));

      inst.pickQuickQuery('select-spo');

      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toContain('PREFIX ex: <http://example.org/>');
      expect(emitted[0]).toContain('SELECT ?s ?p ?o');
    });

    it('emits a SELECT with a GRAPH ?g pattern for select-spog', () => {
      const inst = createWithContext();
      const emitted: string[] = [];
      inst.valueChange.subscribe((v) => emitted.push(v));

      inst.pickQuickQuery('select-spog');

      expect(emitted[0]).toContain('SELECT ?s ?p ?o ?g');
      expect(emitted[0]).toContain('GRAPH ?g');
    });

    it('emits a CONSTRUCT body for construct-spo', () => {
      const inst = createWithContext();
      const emitted: string[] = [];
      inst.valueChange.subscribe((v) => emitted.push(v));

      inst.pickQuickQuery('construct-spo');

      expect(emitted[0]).toContain('CONSTRUCT');
      expect(emitted[0]).toContain('?s ?p ?o');
    });

    it('emits an empty string for clear, ignoring the context header', () => {
      const inst = createWithContext({
        prefixes: { ex: 'http://example.org/' },
        base: 'http://example.org/base/',
      });
      const emitted: string[] = [];
      inst.valueChange.subscribe((v) => emitted.push(v));

      inst.pickQuickQuery('clear');

      expect(emitted).toEqual(['']);
    });
  });

  describe('parametersVisible gates the parameter form', () => {
    const params: ReadonlyArray<ParameterDeclaration> = [
      { name: 'country', type: 'string', cardinality: '1..1', default: 'CA' },
    ];

    it('is false when showParameters is false even with declared parameters', () => {
      const inst = createWithContext();
      inst.parameters = params;
      inst.showParameters = false;
      expect(inst.parametersVisible).toBe(false);
    });

    it('is true when showParameters is true and parameters are declared', () => {
      const inst = createWithContext();
      inst.parameters = params;
      inst.showParameters = true;
      expect(inst.parametersVisible).toBe(true);
    });

    it('is false when no parameters are declared even if showParameters is true', () => {
      const inst = createWithContext();
      inst.showParameters = true;
      expect(inst.parametersVisible).toBe(false);
    });

    it('is false when parameters is an empty list', () => {
      const inst = createWithContext();
      inst.parameters = [];
      inst.showParameters = true;
      expect(inst.parametersVisible).toBe(false);
    });
  });
});
