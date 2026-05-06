import { DataFactory } from 'n3';
import { describe, expect, it } from 'vitest';
import { tabularRowKey, UNBOUND_SENTINEL } from './tabular-row-key';

const { namedNode, literal, blankNode } = DataFactory;

describe('tabularRowKey', () => {
  it('serializes a single named-node binding', () => {
    const key = tabularRowKey(
      { id: namedNode('http://example.org/a') },
      ['id'],
    );
    expect(key).toBe('?id=<http://example.org/a>');
  });

  it('serializes a plain literal without datatype suffix (xsd:string is implicit)', () => {
    const key = tabularRowKey({ name: literal('alice') }, ['name']);
    expect(key).toBe('?name="alice"');
  });

  it('serializes a language-tagged literal with @lang', () => {
    const key = tabularRowKey(
      { greeting: literal('hello', 'en') },
      ['greeting'],
    );
    expect(key).toBe('?greeting="hello"@en');
  });

  it('serializes a datatyped literal with ^^<datatype>', () => {
    const key = tabularRowKey(
      { age: literal('30', namedNode('http://www.w3.org/2001/XMLSchema#integer')) },
      ['age'],
    );
    expect(key).toBe('?age="30"^^<http://www.w3.org/2001/XMLSchema#integer>');
  });

  it('does NOT collapse value-equal but lexically-different datatyped literals', () => {
    const intKey = tabularRowKey(
      { age: literal('30', namedNode('http://www.w3.org/2001/XMLSchema#integer')) },
      ['age'],
    );
    const intAliasKey = tabularRowKey(
      { age: literal('30', namedNode('http://www.w3.org/2001/XMLSchema#int')) },
      ['age'],
    );
    expect(intKey).not.toBe(intAliasKey);
  });

  it('does NOT collapse same-value different-lexical literals (e.g. "01" vs "1")', () => {
    const a = tabularRowKey(
      { n: literal('1', namedNode('http://www.w3.org/2001/XMLSchema#integer')) },
      ['n'],
    );
    const b = tabularRowKey(
      { n: literal('01', namedNode('http://www.w3.org/2001/XMLSchema#integer')) },
      ['n'],
    );
    expect(a).not.toBe(b);
  });

  it('renders an unbound binding as the distinct sentinel', () => {
    const key = tabularRowKey({ name: undefined }, ['name']);
    expect(key).toContain(UNBOUND_SENTINEL);
    expect(key).toBe(`?name=${UNBOUND_SENTINEL}`);
  });

  it('treats an unbound variable as distinct from a literal whose value happens to match the sentinel', () => {
    const unbound = tabularRowKey({ x: undefined }, ['x']);
    const literalSentinel = tabularRowKey(
      { x: literal(UNBOUND_SENTINEL) },
      ['x'],
    );
    expect(unbound).not.toBe(literalSentinel);
  });

  it('joins multi-variable rows with a stable, variable-name-ordered serialization', () => {
    const row = {
      name: literal('alice'),
      age: literal('30'),
    };
    const keyByOne = tabularRowKey(row, ['name', 'age']);
    const keyByOther = tabularRowKey(row, ['age', 'name']);
    expect(keyByOne).toBe(keyByOther);
  });

  it('rejects a row with a blank-node-valued column with an actionable error', () => {
    expect(() =>
      tabularRowKey({ x: blankNode('b0') }, ['x']),
    ).toThrow(/blank node/i);
  });

  it('blank-node rejection names the offending variable', () => {
    expect(() =>
      tabularRowKey({ name: literal('alice'), x: blankNode('b0') }, [
        'name',
        'x',
      ]),
    ).toThrow(/\?x/);
  });
});
