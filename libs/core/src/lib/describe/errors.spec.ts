import { describe, expect, it } from 'vitest';
import {
  formatDescribeError,
  formatDescribePerSourceError,
  type DescribeError,
  type DescribeTopLevelError,
} from './errors';

describe('formatDescribePerSourceError', () => {
  it('produces a non-empty message for every variant', () => {
    const variants: ReadonlyArray<DescribeError> = [
      {
        kind: 'source',
        source: { kind: 'glob-load', glob: ['x'], message: 'm' },
      },
      { kind: 'endpoint-describe', endpoint: 'https://ex.org/sparql', message: 'm' },
      { kind: 'empty-source', id: 'placeholder' },
      { kind: 'reference-source', id: 'aliasy', ref: 'alpha' },
    ];
    for (const v of variants) {
      expect(formatDescribePerSourceError(v).length).toBeGreaterThan(0);
    }
  });
});

describe('formatDescribeError', () => {
  it('produces a non-empty message for every variant', () => {
    const variants: ReadonlyArray<DescribeTopLevelError> = [
      // ADR-0052: the single source's own failure is the top-level error.
      { kind: 'source', source: { kind: 'glob-load', glob: ['x'], message: 'm' } },
      { kind: 'endpoint-describe', endpoint: 'https://ex.org/sparql', message: 'm' },
      { kind: 'empty-source', id: 'placeholder' },
      { kind: 'reference-source', id: 'aliasy', ref: 'alpha' },
      { kind: 'disk-backed-source', id: 'big' },
      { kind: 'empty-target' },
      { kind: 'seed-not-iri', value: 'not-an-iri' },
      { kind: 'reference-target' },
      { kind: 'no-default-multi', availableIds: ['alpha', 'beta'] },
      { kind: 'expanded-paths-without-source' },
      { kind: 'expanded-paths-non-endpoint-source', id: 'docs', sourceKind: 'glob' },
    ];
    for (const v of variants) {
      expect(formatDescribeError(v).length).toBeGreaterThan(0);
    }
  });
});
