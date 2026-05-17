import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { YasqeEditorComponent } from '@app/modules/yasqe-editor';
import { EditorFrameComponent } from './editor-frame.component';
import type { QueryType } from '@app/core';

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

function setup(
  initial: {
    value?: string;
    name?: string;
    loadedSlug?: string;
    loadedBody?: string;
    writable?: boolean;
  } = {},
) {
  TestBed.configureTestingModule({ imports: [EditorFrameComponent] }).overrideComponent(
    EditorFrameComponent,
    {
      remove: { imports: [YasqeEditorComponent] },
      add: { imports: [YasqeEditorStub] },
    },
  );
  const fixture = TestBed.createComponent(EditorFrameComponent);
  if (initial.value !== undefined) fixture.componentRef.setInput('value', initial.value);
  if (initial.name !== undefined) fixture.componentRef.setInput('name', initial.name);
  if (initial.loadedSlug !== undefined)
    fixture.componentRef.setInput('loadedSlug', initial.loadedSlug);
  if (initial.loadedBody !== undefined)
    fixture.componentRef.setInput('loadedBody', initial.loadedBody);
  if (initial.writable !== undefined)
    fixture.componentRef.setInput('writable', initial.writable);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  const stub = fixture.debugElement.query((n) => n.componentInstance instanceof YasqeEditorStub)
    ?.componentInstance as YasqeEditorStub;
  return { fixture, root, stub };
}

describe('EditorFrameComponent', () => {
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

  it('renders a Save-as button and emits saveAs when clicked', () => {
    const { fixture, root } = setup();
    const emitted: number[] = [];
    fixture.componentInstance.saveAs.subscribe(() => emitted.push(1));
    const btn = root.querySelector(
      '[data-testid="editor-save-as"]',
    ) as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    expect(emitted).toEqual([1]);
  });

  it('shows no "modified from" badge when nothing is loaded', () => {
    const { root } = setup({ value: 'SELECT *' });
    expect(root.querySelector('[data-testid="editor-modified-badge"]')).toBeNull();
  });

  it('shows the "modified from <slug>" badge when the editor body diverges from the loaded body', () => {
    const { root } = setup({
      value: 'SELECT ?s',
      loadedSlug: 'alpha',
      loadedBody: 'SELECT *',
    });
    const badge = root.querySelector(
      '[data-testid="editor-modified-badge"]',
    ) as HTMLElement | null;
    expect(badge).toBeTruthy();
    expect(badge?.textContent ?? '').toContain('modified from');
    expect(badge?.textContent ?? '').toContain('alpha');
  });

  it('hides the badge when the editor body matches the loaded body', () => {
    const { root } = setup({
      value: 'SELECT *',
      loadedSlug: 'alpha',
      loadedBody: 'SELECT *',
    });
    expect(root.querySelector('[data-testid="editor-modified-badge"]')).toBeNull();
  });

  it('hides Save and Delete buttons when no slug is loaded', () => {
    const { root } = setup();
    expect(root.querySelector('[data-testid="editor-save"]')).toBeNull();
    expect(root.querySelector('[data-testid="editor-delete"]')).toBeNull();
  });

  it('hides Save, Save-as and Delete when writable=false, even with a slug loaded', () => {
    const { root } = setup({
      value: 'SELECT ?s',
      loadedSlug: 'alpha',
      loadedBody: 'SELECT *',
      writable: false,
    });
    expect(root.querySelector('[data-testid="editor-save"]')).toBeNull();
    expect(root.querySelector('[data-testid="editor-save-as"]')).toBeNull();
    expect(root.querySelector('[data-testid="editor-delete"]')).toBeNull();
  });

  it('still shows the modified-from badge when writable=false (read-only is not invisible)', () => {
    const { root } = setup({
      value: 'SELECT ?s',
      loadedSlug: 'alpha',
      loadedBody: 'SELECT *',
      writable: false,
    });
    expect(root.querySelector('[data-testid="editor-modified-badge"]')).not.toBeNull();
  });

  it('shows Save and Delete when a slug is loaded; each emits when clicked', () => {
    const { fixture, root } = setup({
      value: 'SELECT ?s',
      loadedSlug: 'alpha',
      loadedBody: 'SELECT *',
    });
    const saved: number[] = [];
    const deleted: number[] = [];
    fixture.componentInstance.save.subscribe(() => saved.push(1));
    fixture.componentInstance.delete.subscribe(() => deleted.push(1));
    (
      root.querySelector('[data-testid="editor-save"]') as HTMLButtonElement
    ).click();
    (
      root.querySelector('[data-testid="editor-delete"]') as HTMLButtonElement
    ).click();
    expect(saved).toEqual([1]);
    expect(deleted).toEqual([1]);
  });
});
