import { convertToParamMap } from '@angular/router';
import { encodeBindings, parseBindings } from './bindings-url';

describe('parseBindings', () => {
  it('returns null when no bind.* keys are present', () => {
    expect(parseBindings(convertToParamMap({}))).toBeNull();
    expect(
      parseBindings(convertToParamMap({ source: 'a', query: 'SELECT ?s' })),
    ).toBeNull();
  });

  it('keeps only keys prefixed with bind.', () => {
    const out = parseBindings(
      convertToParamMap({ 'bind.country': 'CA', source: 'a' }),
    );
    expect(out).toEqual({ country: 'CA' });
  });

  it('collapses a single value into a scalar string', () => {
    const out = parseBindings(convertToParamMap({ 'bind.country': 'CA' }));
    expect(out).toEqual({ country: 'CA' });
  });

  it('preserves an array when the same bind.<name> key is repeated', () => {
    const out = parseBindings(
      convertToParamMap({ 'bind.tag': ['a', 'b', 'c'] }),
    );
    expect(out).toEqual({ tag: ['a', 'b', 'c'] });
  });
});

describe('encodeBindings', () => {
  it('emits one `bind.<name>=<value>` pair per scalar binding', () => {
    expect(encodeBindings({ country: 'CA' })).toEqual({ 'bind.country': 'CA' });
  });

  it('emits a string[] for array bindings — the router serialises it as repeated keys', () => {
    expect(encodeBindings({ tag: ['a', 'b'] })).toEqual({
      'bind.tag': ['a', 'b'],
    });
  });

  it('round-trips through parseBindings for the scalar + array case', () => {
    const original = { country: 'CA', tag: ['a', 'b'] };
    const encoded = encodeBindings(original);
    expect(parseBindings(convertToParamMap(encoded))).toEqual(original);
  });

  it('coerces non-string scalar values to strings', () => {
    expect(encodeBindings({ count: 42 as unknown as string })).toEqual({
      'bind.count': '42',
    });
  });
});
