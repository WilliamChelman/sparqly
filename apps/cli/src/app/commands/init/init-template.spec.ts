import { load as loadYaml } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { validateProjectConfig } from '../../runner/project-config-schema';
import { INIT_TEMPLATE_YAML } from './init-template';

describe('INIT_TEMPLATE_YAML', () => {
  it('parses as YAML to an object', () => {
    const parsed = loadYaml(INIT_TEMPLATE_YAML);
    expect(parsed).not.toBeNull();
    expect(typeof parsed).toBe('object');
    expect(Array.isArray(parsed)).toBe(false);
  });

  it('passes validateProjectConfig as written (no required edits)', () => {
    const parsed = loadYaml(INIT_TEMPLATE_YAML);
    const result = validateProjectConfig(parsed);
    if (result.ok === false) {
      // Surface a useful diagnostic if this ever rots.
      throw new Error(
        `INIT_TEMPLATE_YAML failed validateProjectConfig:\n${result.issues
          .map((i) => `  - ${i.path}: ${i.message}`)
          .join('\n')}`,
      );
    }
    expect(result.ok).toBe(true);
  });

  it('declares an empty `sources: []` ready for the user to fill in', () => {
    const parsed = loadYaml(INIT_TEMPLATE_YAML) as Record<string, unknown>;
    expect(parsed.sources).toEqual([]);
  });

  it('includes commented examples for the documented blocks (glob, endpoint, serve, context.prefixes)', () => {
    // We assert on the *raw* template text because comments are the
    // template's payload and disappear after YAML parsing.
    expect(INIT_TEMPLATE_YAML).toMatch(/glob:/);
    expect(INIT_TEMPLATE_YAML).toMatch(/splitByFile:\s*true/);
    expect(INIT_TEMPLATE_YAML).toMatch(/endpoint:/);
    expect(INIT_TEMPLATE_YAML).toMatch(/serve:/);
    expect(INIT_TEMPLATE_YAML).toMatch(/context:/);
    expect(INIT_TEMPLATE_YAML).toMatch(/prefixes:/);
    expect(INIT_TEMPLATE_YAML).toMatch(/rdf:/);
    expect(INIT_TEMPLATE_YAML).toMatch(/xsd:/);
  });
});
