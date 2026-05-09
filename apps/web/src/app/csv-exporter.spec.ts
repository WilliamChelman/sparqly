import { exportBindingsCsv } from './csv-exporter';
import type { Term } from './sparql-result-decoder';

const NN = (value: string): Term => ({ termType: 'NamedNode', value });
const BN = (value: string): Term => ({ termType: 'BlankNode', value });
const LIT = (value: string): Term => ({ termType: 'Literal', value });
const LANG = (value: string, language: string): Term => ({
  termType: 'Literal',
  value,
  language,
});
const TYPED = (value: string, dt: string): Term => ({
  termType: 'Literal',
  value,
  datatype: { value: dt },
});

describe('exportBindingsCsv', () => {
  it('emits a header row matching the projection order', () => {
    const csv = exportBindingsCsv(['s', 'p', 'o'], []);
    expect(csv).toBe('s,p,o\r\n');
  });

  it('emits one row per binding with cells in projection order', () => {
    const csv = exportBindingsCsv(
      ['s', 'p'],
      [{ s: LIT('a'), p: LIT('b') }],
    );
    expect(csv).toBe('s,p\r\na,b\r\n');
  });

  it('emits an empty cell for an unbound projection variable', () => {
    const csv = exportBindingsCsv(
      ['s', 'p'],
      [{ s: LIT('a') }],
    );
    expect(csv).toBe('s,p\r\na,\r\n');
  });

  it('quotes fields containing commas, double-quotes, CR or LF, doubling embedded quotes', () => {
    const csv = exportBindingsCsv(
      ['x'],
      [
        { x: LIT('a,b') },
        { x: LIT('say "hi"') },
        { x: LIT('first\nsecond') },
      ],
    );
    expect(csv).toBe('x\r\n"a,b"\r\n"say ""hi"""\r\n"first\nsecond"\r\n');
  });

  it('preserves language tag with @lang suffix on literals', () => {
    const csv = exportBindingsCsv(
      ['x'],
      [{ x: LANG('hi', 'en') }],
    );
    expect(csv).toBe('x\r\nhi@en\r\n');
  });

  it('preserves datatype with ^^<...> suffix on typed literals', () => {
    const csv = exportBindingsCsv(
      ['x'],
      [{ x: TYPED('42', 'http://www.w3.org/2001/XMLSchema#integer') }],
    );
    expect(csv).toBe(
      'x\r\n42^^<http://www.w3.org/2001/XMLSchema#integer>\r\n',
    );
  });

  it('wraps NamedNode IRIs in angle brackets', () => {
    const csv = exportBindingsCsv(
      ['x'],
      [{ x: NN('http://example.org/a') }],
    );
    expect(csv).toBe('x\r\n<http://example.org/a>\r\n');
  });

  it('emits BlankNodes as _:label', () => {
    const csv = exportBindingsCsv(['x'], [{ x: BN('b0') }]);
    expect(csv).toBe('x\r\n_:b0\r\n');
  });

  it('supports a TSV delimiter via opts', () => {
    const tsv = exportBindingsCsv(
      ['s', 'p'],
      [{ s: LIT('a'), p: LIT('b') }],
      { delimiter: '\t' },
    );
    expect(tsv).toBe('s\tp\r\na\tb\r\n');
  });
});
