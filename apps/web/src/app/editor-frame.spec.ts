import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EditorFrame } from './editor-frame';
import { YasqeEditor } from './yasqe-editor';
import type { QueryType } from './query-detection';

@Component({
  selector: 'app-yasqe-editor',
  standalone: true,
  template: `<textarea
    [value]="value"
    (input)="valueChange.emit($any($event.target).value)"
  ></textarea>`,
})
class YasqeEditorStub {
  @Input() value = '';
  @Output() valueChange = new EventEmitter<string>();
  readonly queryTypeSignal = signal<QueryType | undefined>(undefined);
  readonly prefixCountSignal = signal(0);
  readonly queryType = this.queryTypeSignal.asReadonly();
  readonly prefixCount = this.prefixCountSignal.asReadonly();
}

function setup(initial: { value?: string; name?: string } = {}) {
  TestBed.configureTestingModule({ imports: [EditorFrame] }).overrideComponent(
    EditorFrame,
    {
      remove: { imports: [YasqeEditor] },
      add: { imports: [YasqeEditorStub] },
    },
  );
  const fixture = TestBed.createComponent(EditorFrame);
  if (initial.value !== undefined) fixture.componentRef.setInput('value', initial.value);
  if (initial.name !== undefined) fixture.componentRef.setInput('name', initial.name);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const stub = fixture.debugElement.query((n) => n.componentInstance instanceof YasqeEditorStub)
    ?.componentInstance as YasqeEditorStub;
  return { fixture, root, stub };
}

describe('EditorFrame', () => {
  it('renders a my-head strip with the name (defaults to "query")', () => {
    const { root } = setup();
    const head = root.querySelector('.my-head');
    expect(head).toBeTruthy();
    expect(head?.querySelector('.my-name')?.textContent?.trim()).toBe('query');
  });

  it('renders the configured name in the head strip', () => {
    const { root } = setup({ name: 'left query' });
    expect(root.querySelector('.my-head .my-name')?.textContent?.trim()).toBe(
      'left query',
    );
  });

  it('renders the YasqeEditor body inside the my-body', () => {
    const { root } = setup();
    expect(root.querySelector('.my-body app-yasqe-editor')).toBeTruthy();
  });

  it('shows the query type from the YasqeEditor in the head my-kind span', () => {
    const { fixture, root, stub } = setup();
    expect(root.querySelector('.my-head .my-kind')?.textContent?.trim()).toBe(
      '—',
    );
    stub.queryTypeSignal.set('SELECT');
    fixture.detectChanges();
    expect(root.querySelector('.my-head .my-kind')?.textContent?.trim()).toBe(
      'SELECT',
    );
  });

  it('shows the prefix count from the YasqeEditor in the head meta', () => {
    const { fixture, root, stub } = setup();
    stub.prefixCountSignal.set(3);
    fixture.detectChanges();
    const meta = root.querySelector('.my-head .my-meta')?.textContent ?? '';
    expect(meta).toContain('3 prefixes');
  });

  it('uses singular "1 prefix" when only one prefix is declared', () => {
    const { fixture, root, stub } = setup();
    stub.prefixCountSignal.set(1);
    fixture.detectChanges();
    const meta = root.querySelector('.my-head .my-meta')?.textContent ?? '';
    expect(meta).toContain('1 prefix');
    expect(meta).not.toContain('1 prefixes');
  });

  it('passes value down to the YasqeEditor and forwards valueChange up', () => {
    const { fixture, root, stub } = setup({ value: 'SELECT ?s WHERE { ?s ?p ?o }' });
    expect(stub.value).toBe('SELECT ?s WHERE { ?s ?p ?o }');
    const emitted: string[] = [];
    fixture.componentInstance.valueChange.subscribe((v: string) => emitted.push(v));
    const ta = root.querySelector('textarea') as HTMLTextAreaElement;
    ta.value = 'ASK { ?s ?p ?o }';
    ta.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(emitted).toEqual(['ASK { ?s ?p ?o }']);
  });
});
