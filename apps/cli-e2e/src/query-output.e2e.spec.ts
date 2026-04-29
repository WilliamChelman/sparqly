import { describe, expect, it } from 'vitest';
import { queryFixture } from './helpers/fixtures';
import { runCli } from './helpers/run-cli';

const sources = queryFixture('people.ttl');

describe('sparqly query — output formats', () => {
  describe('default formats by query type (US 5)', () => {
    it('SELECT defaults to JSON', async () => {
      const result = await runCli([
        'query',
        sources,
        '-q',
        'SELECT * WHERE { ?s ?p ?o } LIMIT 1',
      ]);

      expect(result.exitCode).toBe(0);
      expect(() => JSON.parse(result.stdout)).not.toThrow();
    });

    it('ASK defaults to JSON', async () => {
      const result = await runCli([
        'query',
        sources,
        '-q',
        'ASK { ?s ?p ?o }',
      ]);

      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.boolean).toBe(true);
    });

    it('CONSTRUCT defaults to Turtle', async () => {
      const result = await runCli([
        'query',
        sources,
        '-q',
        'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o } LIMIT 1',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/<http:\/\/example\.org\/[^>]+>/);
      expect(() => JSON.parse(result.stdout)).toThrow();
    });

    it('DESCRIBE defaults to Turtle', async () => {
      const result = await runCli([
        'query',
        sources,
        '-q',
        'DESCRIBE <http://example.org/alice>',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/<http:\/\/example\.org\/alice>/);
      expect(() => JSON.parse(result.stdout)).toThrow();
    });
  });

  describe('--format overrides (US 6)', () => {
    it('--format json on SELECT keeps JSON output', async () => {
      const result = await runCli([
        'query',
        sources,
        '--format',
        'json',
        '-q',
        'SELECT * WHERE { ?s ?p ?o } LIMIT 1',
      ]);

      expect(result.exitCode).toBe(0);
      expect(() => JSON.parse(result.stdout)).not.toThrow();
    });

    it('--format turtle on CONSTRUCT keeps Turtle output', async () => {
      const result = await runCli([
        'query',
        sources,
        '--format',
        'turtle',
        '-q',
        'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o } LIMIT 1',
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/<http:\/\/example\.org\/[^>]+>/);
    });
  });

  describe('incompatible formats error', () => {
    it('--format json on CONSTRUCT exits non-zero with a clear message', async () => {
      const result = await runCli([
        'query',
        sources,
        '--format',
        'json',
        '-q',
        'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/json.*CONSTRUCT|incompatible/i);
    });

    it('--format turtle on SELECT exits non-zero with a clear message', async () => {
      const result = await runCli([
        'query',
        sources,
        '--format',
        'turtle',
        '-q',
        'SELECT * WHERE { ?s ?p ?o } LIMIT 1',
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/turtle.*SELECT|incompatible/i);
    });

    it('unknown --format value exits non-zero', async () => {
      const result = await runCli([
        'query',
        sources,
        '--format',
        'xml',
        '-q',
        'SELECT * WHERE { ?s ?p ?o } LIMIT 1',
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/unknown --format/);
    });
  });
});
