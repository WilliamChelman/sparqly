import { describe, expect, it } from 'vitest';
import { planInit } from './plan-init';

describe('planInit', () => {
  it('writes ./sparqly.config.yaml when CWD has no existing config and no ancestor', () => {
    const result = planInit({
      cwd: '/tmp/proj',
      force: false,
      cwdConfigPath: null,
      ancestorConfigPath: null,
    });
    expect(result).toEqual({
      action: 'write',
      destination: '/tmp/proj/sparqly.config.yaml',
      warnAncestor: null,
    });
  });

  it('refuses when CWD has an existing config and --force is not set', () => {
    const result = planInit({
      cwd: '/tmp/proj',
      force: false,
      cwdConfigPath: '/tmp/proj/sparqly.config.yml',
      ancestorConfigPath: null,
    });
    expect(result).toEqual({
      action: 'refuse',
      existingPath: '/tmp/proj/sparqly.config.yml',
    });
  });

  it('overwrites when CWD has an existing config and --force is set', () => {
    const result = planInit({
      cwd: '/tmp/proj',
      force: true,
      cwdConfigPath: '/tmp/proj/sparqly.config.yaml',
      ancestorConfigPath: null,
    });
    expect(result).toEqual({
      action: 'write',
      destination: '/tmp/proj/sparqly.config.yaml',
      warnAncestor: null,
    });
  });

  it('writes and surfaces the ancestor path for shadow warning when ancestor exists', () => {
    const result = planInit({
      cwd: '/tmp/proj/sub',
      force: false,
      cwdConfigPath: null,
      ancestorConfigPath: '/tmp/proj/sparqly.config.yaml',
    });
    expect(result).toEqual({
      action: 'write',
      destination: '/tmp/proj/sub/sparqly.config.yaml',
      warnAncestor: '/tmp/proj/sparqly.config.yaml',
    });
  });

  it('refuse outranks ancestor warning (the existing CWD config matters more)', () => {
    const result = planInit({
      cwd: '/tmp/proj/sub',
      force: false,
      cwdConfigPath: '/tmp/proj/sub/sparqly.config.json',
      ancestorConfigPath: '/tmp/proj/sparqly.config.yaml',
    });
    expect(result).toEqual({
      action: 'refuse',
      existingPath: '/tmp/proj/sub/sparqly.config.json',
    });
  });

  it('force with both ancestor and CWD collision still writes and emits warning', () => {
    const result = planInit({
      cwd: '/tmp/proj/sub',
      force: true,
      cwdConfigPath: '/tmp/proj/sub/sparqly.config.yaml',
      ancestorConfigPath: '/tmp/proj/sparqly.config.yaml',
    });
    expect(result).toEqual({
      action: 'write',
      destination: '/tmp/proj/sub/sparqly.config.yaml',
      warnAncestor: '/tmp/proj/sparqly.config.yaml',
    });
  });
});
