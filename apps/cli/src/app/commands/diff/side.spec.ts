import { describe, expect, it, vi } from 'vitest';
import type { ParsedSource } from 'core';
import { resolveSide } from './side';

function captureLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('resolveSide — no pass-through boundary warn (view chain removed, ADR-0051)', () => {
  it('emits zero pass-through boundary warns when the side is not pass-through-resolved (in-memory glob, no match)', async () => {
    const registry: ParsedSource[] = [
      { kind: 'glob', id: 'local', glob: 'no/such/match-*.ttl' },
    ];
    const logger = captureLogger();

    await resolveSide(registry[0], {}, undefined, 'left', logger).catch(
      () => undefined,
    );

    // The glob no-match path emits its own warn (ADR-0028) — assert no warn
    // mentions Source-file snippet / pass-through boundary specifically.
    const boundaryWarns = logger.warn.mock.calls.filter(([msg]) =>
      /source.?file snippet/i.test(String(msg)),
    );
    expect(boundaryWarns).toEqual([]);
  });

  it('emits zero warns when an inline query is provided (inline-query path bypasses the pass-through check)', async () => {
    const target: ParsedSource = {
      kind: 'endpoint',
      id: 'live',
      endpoint: 'https://unreachable.invalid/sparql',
    };
    const logger = captureLogger();

    await resolveSide(
      target,
      {},
      'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      'left',
      logger,
    ).catch(() => undefined);

    expect(logger.warn).not.toHaveBeenCalled();
  });
});
