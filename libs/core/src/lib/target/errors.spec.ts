import { describe, expect, it } from 'vitest';
import { formatTargetError, type TargetError } from './errors';

describe('formatTargetError — exhaustive per-variant formatting', () => {
  const cases: Array<{ name: string; error: TargetError; matchers: RegExp[] }> = [
    {
      name: 'ref-as-target',
      error: { kind: 'ref-as-target' },
      matchers: [/reference/i, /alias/i],
    },
    {
      name: 'empty-registry',
      error: { kind: 'empty-registry' },
      matchers: [/empty/i],
    },
    {
      name: 'no-default-multi',
      error: {
        kind: 'no-default-multi',
        availableIds: ['files', 'live', 'snap'],
      },
      matchers: [/default/i, /@files/, /@live/, /@snap/],
    },
    {
      name: 'unknown-ref',
      error: {
        kind: 'unknown-ref',
        ref: '@nope',
        availableIds: ['files', 'live'],
      },
      matchers: [/@nope/, /@files/, /@live/],
    },
  ];

  for (const { name, error, matchers } of cases) {
    it(`formats ${name} with structured fields surfaced in the message`, () => {
      const message = formatTargetError(error);
      expect(message).toBeTypeOf('string');
      expect(message.length).toBeGreaterThan(0);
      for (const matcher of matchers) {
        expect(message).toMatch(matcher);
      }
    });
  }

  it('formats unknown-ref with "<none>" when registry is empty', () => {
    const message = formatTargetError({
      kind: 'unknown-ref',
      ref: '@nope',
      availableIds: [],
    });
    expect(message).toMatch(/<none>/);
  });

  it('formats no-default-multi with "<none>" when no ids are available', () => {
    const message = formatTargetError({
      kind: 'no-default-multi',
      availableIds: [],
    });
    expect(message).toMatch(/<none>/);
  });

  it('exposes structured fields without parsing the formatted string', () => {
    const error: TargetError = {
      kind: 'unknown-ref',
      ref: '@nope',
      availableIds: ['a', 'b'],
    };
    expect(error.ref).toBe('@nope');
    expect(error.availableIds).toEqual(['a', 'b']);
  });
});
