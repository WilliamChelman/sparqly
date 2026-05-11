import { describe, expect, it } from 'vitest';
import { Store } from 'n3';
import {
  parseTransformList,
  type TransformDefinition,
} from './transform-spec';

const NOOP_STUB: TransformDefinition = {
  key: 'stubNoop',
  parse: () => (store: Store) => store,
};

describe('parseTransformList — registry plumbing', () => {
  it('accepts an empty list and returns an empty parsed list (no registry needed)', () => {
    expect(parseTransformList([], [])).toEqual([]);
  });

  it('rejects a non-array input with a stable error', () => {
    expect(() =>
      parseTransformList({ stubNoop: true } as unknown, [NOOP_STUB]),
    ).toThrow(/`transforms` must be an array/);
  });

  it('rejects an unknown transform key and names the offending key', () => {
    expect(() => parseTransformList([{ bogus: true }], [NOOP_STUB])).toThrow(
      /transforms\[0\].*unknown transform key "bogus"/,
    );
  });

  it('rejects a list item that is not a single-key object', () => {
    expect(() => parseTransformList(['stubNoop'], [NOOP_STUB])).toThrow(
      /transforms\[0\].*object with exactly one transform key/,
    );
    expect(() => parseTransformList([{}], [NOOP_STUB])).toThrow(
      /transforms\[0\].*exactly one transform key.*<none>/,
    );
    expect(() =>
      parseTransformList([{ stubNoop: true, extra: 1 }], [NOOP_STUB]),
    ).toThrow(/transforms\[0\].*exactly one transform key.*stubNoop, extra/);
  });

  it('rejects duplicate transform keys within one list with a stable error', () => {
    expect(() =>
      parseTransformList(
        [{ stubNoop: true }, { stubNoop: true }],
        [NOOP_STUB],
      ),
    ).toThrow(/duplicate transform key "stubNoop".*transforms\[0\].*transforms\[1\]/);
  });
});

describe('parseTransformList — shorthand vs long form (via stubs)', () => {
  it('parses shorthand string values via the stub registry', () => {
    const calls: unknown[] = [];
    const stub: TransformDefinition = {
      key: 'stubShorthand',
      parse: (raw) => {
        calls.push(raw);
        return (s) => s;
      },
    };
    const parsed = parseTransformList([{ stubShorthand: 'forceAll' }], [stub]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].key).toBe('stubShorthand');
    expect(calls).toEqual(['forceAll']);
  });

  it('parses long-form object values via the stub registry', () => {
    const calls: unknown[] = [];
    const stub: TransformDefinition = {
      key: 'stubLong',
      parse: (raw) => {
        calls.push(raw);
        return (s) => s;
      },
    };
    parseTransformList([{ stubLong: { mode: 'forceAll', graph: 'urn:g' } }], [stub]);
    expect(calls).toEqual([{ mode: 'forceAll', graph: 'urn:g' }]);
  });

  it('surfaces parse errors from the registered transform unchanged', () => {
    const stub: TransformDefinition = {
      key: 'stubStrict',
      parse: () => {
        throw new Error('stubStrict: boom');
      },
    };
    expect(() => parseTransformList([{ stubStrict: 1 }], [stub])).toThrow(
      /stubStrict: boom/,
    );
  });
});
