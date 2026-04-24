import { describe, expect, it } from 'vitest';
import { SparqlController } from './sparql.controller';

describe('SparqlController', () => {
  const controller = new SparqlController();

  it('GET returns the not-implemented placeholder', () => {
    expect(controller.get().error).toBe('not yet implemented');
  });

  it('POST returns the not-implemented placeholder', () => {
    expect(controller.post().error).toBe('not yet implemented');
  });
});
