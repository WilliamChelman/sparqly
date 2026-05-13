import { DataFactory } from 'n3';
import { describe, expect, it } from 'vitest';
import { tabularRowKey, UNBOUND_SENTINEL } from './tabular-row-key';

const { namedNode, literal, blankNode } = DataFactory;

function unwrapKey(
  result: ReturnType<typeof tabularRowKey>,
): string {
  if (result.isErr()) {
    throw new Error(
      `expected ok, got err: ${JSON.stringify(result.error)}`,
    );
  }
  return result.value;
}

describe('tabularRowKey', () => {
  it('serializes a single named-node binding', () => {
    const key = unwrapKey(
      tabularRowKey({ id: namedNode('http://example.org/a') }, ['id']),
    );
    expect(key).toBe('?id=<http://example.org/a>');
  });

  it('serializes a plain literal without datatype suffix (xsd:string is implicit)', () => {
    const key = unwrapKey(tabularRowKey({ name: literal('alice') }, ['name']));
    expect(key).toBe('?name="alice"');
  });

  it('serializes a language-tagged literal with @lang', () => {
    const key = unwrapKey(
      tabularRowKey({ greeting: literal('hello', 'en') }, ['greeting']),
    );
    expect(key).toBe('?greeting="hello"@en');
  });

  it('serializes a datatyped literal with ^^<datatype>', () => {
    const key = unwrapKey(
      tabularRowKey(
        { age: literal('30', namedNode('http://www.w3.org/2001/XMLSchema#integer')) },
        ['age'],
      ),
    );
    expect(key).toBe('?age="30"^^<http://www.w3.org/2001/XMLSchema#integer>');
  });

  it('does NOT collapse value-equal but lexically-different datatyped literals', () => {
    const intKey = unwrapKey(
      tabularRowKey(
        { age: literal('30', namedNode('http://www.w3.org/2001/XMLSchema#integer')) },
        ['age'],
      ),
    );
    const intAliasKey = unwrapKey(
      tabularRowKey(
        { age: literal('30', namedNode('http://www.w3.org/2001/XMLSchema#int')) },
        ['age'],
      ),
    );
    expect(intKey).not.toBe(intAliasKey);
  });

  it('does NOT collapse same-value different-lexical literals (e.g. "01" vs "1")', () => {
    const a = unwrapKey(
      tabularRowKey(
        { n: literal('1', namedNode('http://www.w3.org/2001/XMLSchema#integer')) },
        ['n'],
      ),
    );
    const b = unwrapKey(
      tabularRowKey(
        { n: literal('01', namedNode('http://www.w3.org/2001/XMLSchema#integer')) },
        ['n'],
      ),
    );
    expect(a).not.toBe(b);
  });

  it('renders an unbound binding as the distinct sentinel', () => {
    const key = unwrapKey(tabularRowKey({ name: undefined }, ['name']));
    expect(key).toContain(UNBOUND_SENTINEL);
    expect(key).toBe(`?name=${UNBOUND_SENTINEL}`);
  });

  it('treats an unbound variable as distinct from a literal whose value happens to match the sentinel', () => {
    const unbound = unwrapKey(tabularRowKey({ x: undefined }, ['x']));
    const literalSentinel = unwrapKey(
      tabularRowKey({ x: literal(UNBOUND_SENTINEL) }, ['x']),
    );
    expect(unbound).not.toBe(literalSentinel);
  });

  it('joins multi-variable rows with a stable, variable-name-ordered serialization', () => {
    const row = {
      name: literal('alice'),
      age: literal('30'),
    };
    const keyByOne = unwrapKey(tabularRowKey(row, ['name', 'age']));
    const keyByOther = unwrapKey(tabularRowKey(row, ['age', 'name']));
    expect(keyByOne).toBe(keyByOther);
  });

  it('returns Result.err with a tabular-blank-node variant when a column is a blank node', () => {
    const result = tabularRowKey({ x: blankNode('b0') }, ['x']);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toEqual({ kind: 'tabular-blank-node', column: 'x' });
    }
  });

  it('blank-node err carries the structured offending column name', () => {
    const result = tabularRowKey(
      { name: literal('alice'), x: blankNode('b0') },
      ['name', 'x'],
    );
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.column).toBe('x');
    }
  });
});
