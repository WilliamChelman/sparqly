import { TestBed } from '@angular/core/testing';
import { YasqeEditor } from './yasqe-editor';

function makeEditor(): YasqeEditor {
  TestBed.configureTestingModule({ imports: [YasqeEditor] });
  // Avoid detectChanges() so ngAfterViewInit (which boots @triply/yasgui) does not run.
  return TestBed.createComponent(YasqeEditor).componentInstance;
}

describe('YasqeEditor signals', () => {
  it('queryType signal reflects the current value', () => {
    const editor = makeEditor();
    editor.value = 'SELECT ?s WHERE { ?s ?p ?o }';
    expect(editor.queryType()).toBe('SELECT');
  });

  it('queryType signal updates when value changes', () => {
    const editor = makeEditor();
    editor.value = 'SELECT ?s WHERE { ?s ?p ?o }';
    expect(editor.queryType()).toBe('SELECT');
    editor.value = 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }';
    expect(editor.queryType()).toBe('CONSTRUCT');
    editor.value = 'ASK { ?s ?p ?o }';
    expect(editor.queryType()).toBe('ASK');
    editor.value = 'DESCRIBE <http://example.org/x>';
    expect(editor.queryType()).toBe('DESCRIBE');
  });

  it('prefixCount signal counts PREFIX declarations', () => {
    const editor = makeEditor();
    editor.value =
      'PREFIX ex: <http://example.org/>\nPREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\nSELECT ?s WHERE { ?s ?p ?o }';
    expect(editor.prefixCount()).toBe(2);
  });

  it('prefixCount signal updates as the value changes', () => {
    const editor = makeEditor();
    editor.value = 'SELECT ?s WHERE { ?s ?p ?o }';
    expect(editor.prefixCount()).toBe(0);
    editor.value =
      'PREFIX ex: <http://example.org/>\nSELECT ?s WHERE { ?s ?p ?o }';
    expect(editor.prefixCount()).toBe(1);
  });
});
