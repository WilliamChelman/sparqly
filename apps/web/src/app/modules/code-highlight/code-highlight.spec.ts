import {
  HIGHLIGHT_MAX_CHARS,
  HIGHLIGHT_MAX_LINES,
  exceedsHighlightThreshold,
  resolveHighlightMode,
  tokenizeCode,
} from './code-highlight';

describe('tokenizeCode', () => {
  it('tokenizes a Turtle line into tokens whose text reproduces the input', () => {
    const lines = tokenizeCode('<a> <b> <c> .', 'turtle');
    expect(lines).toHaveLength(1);
    const text = lines[0].map((token) => token.text).join('');
    expect(text).toBe('<a> <b> <c> .');
  });

  it('splits a multi-line document into one token list per line', () => {
    const lines = tokenizeCode('<a> <b> <c> .\n<d> <e> <f> .', 'turtle');
    expect(lines).toHaveLength(2);
  });

  it('reproduces a multi-line input byte-for-byte across the line model', () => {
    const input = '@prefix ex: <http://example.org/> .\nex:s ex:p "lit" .\n';
    const lines = tokenizeCode(input, 'turtle');
    const rebuilt = lines
      .map((line) => line.map((token) => token.text).join(''))
      .join('\n');
    expect(rebuilt).toBe(input);
  });

  it('assigns cm-* style classes to recognized Turtle tokens', () => {
    const lines = tokenizeCode('ex:s ex:p "a literal" .', 'turtle');
    const classes = lines[0].map((token) => token.className);
    expect(classes.some((cls) => cls.startsWith('cm-'))).toBe(true);
  });

  it('leaves whitespace-only runs unstyled so byte-identity holds', () => {
    const lines = tokenizeCode('<a>   <b> <c> .', 'turtle');
    const gap = lines[0].find((token) => token.text.trim() === '');
    expect(gap?.className).toBe('');
  });

  it('tokenizes JSON, reproducing the input and styling structure', () => {
    const input = '{"head":{"vars":["s"]}}';
    const lines = tokenizeCode(input, 'json');
    const rebuilt = lines[0].map((token) => token.text).join('');
    expect(rebuilt).toBe(input);
    expect(lines[0].some((token) => token.className.startsWith('cm-'))).toBe(
      true,
    );
  });
});

describe('resolveHighlightMode', () => {
  it('resolves the SPARQL JSON results content type to the json mode', () => {
    expect(resolveHighlightMode('application/sparql-results+json')).toBe(
      'json',
    );
  });

  it('resolves every triples wire content type to the turtle mode', () => {
    expect(resolveHighlightMode('text/turtle')).toBe('turtle');
    expect(resolveHighlightMode('application/n-triples')).toBe('turtle');
    expect(resolveHighlightMode('application/n-quads')).toBe('turtle');
    expect(resolveHighlightMode('application/trig')).toBe('turtle');
  });

  it('ignores content-type parameters and casing', () => {
    expect(resolveHighlightMode('text/turtle; charset=utf-8')).toBe('turtle');
    expect(resolveHighlightMode('Application/SPARQL-Results+JSON')).toBe(
      'json',
    );
  });

  it('resolves RDF file extensions to the turtle mode', () => {
    for (const ext of ['.ttl', '.trig', '.nt', '.nq', '.n3']) {
      expect(resolveHighlightMode(ext)).toBe('turtle');
    }
  });

  it('resolves JSON file extensions to the json mode', () => {
    expect(resolveHighlightMode('.json')).toBe('json');
    expect(resolveHighlightMode('.jsonld')).toBe('json');
  });

  it('returns null for unrecognized content types and extensions', () => {
    expect(resolveHighlightMode('application/rdf+xml')).toBeNull();
    expect(resolveHighlightMode('text/plain')).toBeNull();
    expect(resolveHighlightMode('.xml')).toBeNull();
    expect(resolveHighlightMode('')).toBeNull();
  });
});

describe('exceedsHighlightThreshold', () => {
  it('does not flag a small input', () => {
    expect(exceedsHighlightThreshold('<a> <b> <c> .')).toBe(false);
  });

  it('allows input at exactly the line limit but flags one line over', () => {
    const atLimit = `${'x\n'.repeat(HIGHLIGHT_MAX_LINES - 1)}x`;
    const overLimit = `${'x\n'.repeat(HIGHLIGHT_MAX_LINES)}x`;
    expect(exceedsHighlightThreshold(atLimit)).toBe(false);
    expect(exceedsHighlightThreshold(overLimit)).toBe(true);
  });

  it('allows input at exactly the char limit but flags one char over', () => {
    expect(exceedsHighlightThreshold('x'.repeat(HIGHLIGHT_MAX_CHARS))).toBe(
      false,
    );
    expect(exceedsHighlightThreshold('x'.repeat(HIGHLIGHT_MAX_CHARS + 1))).toBe(
      true,
    );
  });
});
