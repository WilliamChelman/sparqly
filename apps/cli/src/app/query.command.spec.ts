import { describe, expect, it } from 'vitest';
import { QueryCommand } from './query.command';

describe('QueryCommand', () => {
  it('can be referenced by the module', () => {
    expect(QueryCommand.name).toBe('QueryCommand');
  });
});
