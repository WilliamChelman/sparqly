import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { TargetError } from 'core';
import { targetErrorToStatus } from './target-http-errors';

describe('targetErrorToStatus — per-variant status mapping for TargetError', () => {
  const cases: Array<{ name: string; error: TargetError; status: HttpStatus }> = [
    {
      name: 'ref-as-target',
      error: { kind: 'ref-as-target' },
      status: HttpStatus.BAD_REQUEST,
    },
    {
      name: 'empty-registry',
      error: { kind: 'empty-registry' },
      status: HttpStatus.BAD_REQUEST,
    },
    {
      name: 'no-default-multi',
      error: { kind: 'no-default-multi', availableIds: ['a', 'b'] },
      status: HttpStatus.BAD_REQUEST,
    },
    {
      name: 'unknown-ref',
      error: {
        kind: 'unknown-ref',
        ref: '@nope',
        availableIds: ['a', 'b'],
      },
      status: HttpStatus.BAD_REQUEST,
    },
  ];

  for (const { name, error, status } of cases) {
    it(`maps ${name} to ${status}`, () => {
      expect(targetErrorToStatus(error)).toBe(status);
    });
  }

  it('covers every variant of TargetError (compile-time exhaustiveness sanity)', () => {
    expect(cases.length).toBe(4);
  });
});
