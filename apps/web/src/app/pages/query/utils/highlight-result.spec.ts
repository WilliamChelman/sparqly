import { highlightFormatted, highlightRaw } from './highlight-result';

const HUGE = 'x'.repeat(400_001);

describe('highlightRaw', () => {
  it('tokenises a recognised mode (Turtle)', () => {
    const lines = highlightRaw('<a> <b> <c> .', 'text/turtle');
    expect(lines).not.toBeNull();
    expect(lines!.length).toBeGreaterThan(0);
  });

  it('tokenises SPARQL-results JSON', () => {
    const lines = highlightRaw(
      '{"head":{"vars":[]},"results":{"bindings":[]}}',
      'application/sparql-results+json',
    );
    expect(lines).not.toBeNull();
  });

  it('returns null for an unrecognised content type (caller renders plain text)', () => {
    expect(highlightRaw('<rdf:RDF/>', 'application/rdf+xml')).toBeNull();
  });

  it('returns null when the body exceeds the highlight size threshold', () => {
    expect(highlightRaw(HUGE, 'text/turtle')).toBeNull();
  });
});

describe('highlightFormatted', () => {
  it('tokenises any body under the size threshold (turtle mode handles trig)', () => {
    const lines = highlightFormatted('<a> <b> <c> .');
    expect(lines).not.toBeNull();
    expect(lines!.length).toBeGreaterThan(0);
  });

  it('returns null for an oversized body so the caller falls back to plain <pre>', () => {
    expect(highlightFormatted(HUGE)).toBeNull();
  });
});
