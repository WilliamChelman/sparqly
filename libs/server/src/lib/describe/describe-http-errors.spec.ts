import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { mapDescribeHttpError } from './describe-http-errors';

describe('mapDescribeHttpError', () => {
  it('maps a `source` load failure to 502 with a human message (ADR-0052)', () => {
    const ex = mapDescribeHttpError({
      kind: 'source',
      source: { kind: 'glob-load', glob: ['x'], message: 'boom' },
    });
    expect(ex.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    const body = ex.getResponse() as { kind: string; message: string };
    expect(body.kind).toBe('source');
    expect(body.message.length).toBeGreaterThan(0);
  });

  it('maps an unreachable `endpoint-describe` to 502 carrying the endpoint', () => {
    const ex = mapDescribeHttpError({
      kind: 'endpoint-describe',
      endpoint: 'http://ex/sparql',
      message: 'down',
    });
    expect(ex.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    const body = ex.getResponse() as {
      kind: string;
      endpoint: string;
      message: string;
    };
    expect(body.kind).toBe('endpoint-describe');
    expect(body.endpoint).toBe('http://ex/sparql');
    expect(body.message).toContain('http://ex/sparql');
  });

  it('maps undescribable-source preconditions to 400 carrying their ids', () => {
    const empty = mapDescribeHttpError({ kind: 'empty-source', id: 'placeholder' });
    expect(empty.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect((empty.getResponse() as { id: string }).id).toBe('placeholder');

    const ref = mapDescribeHttpError({
      kind: 'reference-source',
      id: 'aliasy',
      ref: 'alpha',
    });
    expect(ref.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect((ref.getResponse() as { ref: string }).ref).toBe('alpha');

    const disk = mapDescribeHttpError({ kind: 'disk-backed-source', id: 'big' });
    expect(disk.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect((disk.getResponse() as { id: string }).id).toBe('big');
  });

  it('maps empty-target to 400 with a message', () => {
    const ex = mapDescribeHttpError({ kind: 'empty-target' });
    expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    const body = ex.getResponse() as { kind: string; message: string };
    expect(body.kind).toBe('empty-target');
    expect(body.message.length).toBeGreaterThan(0);
  });

  it('maps seed-not-iri to 400 carrying the offending value', () => {
    const ex = mapDescribeHttpError({
      kind: 'seed-not-iri',
      value: 'not-an-iri',
    });
    expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect((ex.getResponse() as { value: string }).value).toBe('not-an-iri');
  });

  it('maps reference-target to 400', () => {
    const ex = mapDescribeHttpError({ kind: 'reference-target' });
    expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect((ex.getResponse() as { kind: string }).kind).toBe('reference-target');
  });

  it('maps no-default-multi to 400 carrying the available source ids (ADR-0052)', () => {
    const ex = mapDescribeHttpError({
      kind: 'no-default-multi',
      availableIds: ['alpha', 'beta'],
    });
    expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect((ex.getResponse() as { availableIds: string[] }).availableIds).toEqual(
      ['alpha', 'beta'],
    );
  });

  it('maps the expanded-paths preconditions to 400', () => {
    const without = mapDescribeHttpError({
      kind: 'expanded-paths-without-source',
    });
    expect(without.getStatus()).toBe(HttpStatus.BAD_REQUEST);

    const nonEndpoint = mapDescribeHttpError({
      kind: 'expanded-paths-non-endpoint-source',
      id: 'docs',
      sourceKind: 'glob',
    });
    expect(nonEndpoint.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect((nonEndpoint.getResponse() as { sourceKind: string }).sourceKind).toBe(
      'glob',
    );
  });
});
