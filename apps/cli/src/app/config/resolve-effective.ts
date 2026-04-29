import type { EnvBlock } from './env-config';
import type { ResolvedConfig } from './resolve-config';
import {
  QUERY_BLOCK_KEYS,
  SERVE_BLOCK_KEYS,
  type CommandName,
  type EffectiveOptions,
  type QueryBlockConfig,
  type ServeBlockConfig,
} from './schema';

export type ConfigSource = 'default' | 'file' | 'env' | 'flag';

export interface ResolveEffectiveInput<C extends CommandName> {
  command: C;
  resolved: ResolvedConfig;
  env: EnvBlock<C>;
  cliOverrides: Partial<EffectiveOptions>;
  positionalSources?: string;
}

export interface EffectiveResult {
  effective: EffectiveOptions;
  sources: Partial<Record<keyof EffectiveOptions, ConfigSource>>;
}

const SHARED_DEFAULTS: Partial<EffectiveOptions> = {
  graphStrategy: 'default',
  mutable: false,
  verbose: false,
  quiet: false,
};
const QUERY_DEFAULTS: Partial<EffectiveOptions> = {};
const SERVE_DEFAULTS: Partial<EffectiveOptions> = {
  port: 3000,
  watch: false,
  watchDebounce: 250,
};

export function resolveEffective<C extends CommandName>(
  input: ResolveEffectiveInput<C>,
): EffectiveOptions {
  const block: QueryBlockConfig | ServeBlockConfig =
    input.command === 'query'
      ? input.resolved.queryBlock
      : input.resolved.serveBlock;

  const merged: Record<string, unknown> = {};
  assign(merged, input.resolved.shared);
  assign(merged, block);
  assign(merged, input.env);
  if (input.positionalSources !== undefined) {
    merged.sources = input.positionalSources;
  }
  assign(merged, input.cliOverrides);
  return merged as EffectiveOptions;
}

export function resolveEffectiveWithSources<C extends CommandName>(
  input: ResolveEffectiveInput<C>,
): EffectiveResult {
  const defaults =
    input.command === 'query'
      ? { ...SHARED_DEFAULTS, ...QUERY_DEFAULTS }
      : { ...SHARED_DEFAULTS, ...SERVE_DEFAULTS };
  const block: QueryBlockConfig | ServeBlockConfig =
    input.command === 'query'
      ? input.resolved.queryBlock
      : input.resolved.serveBlock;

  const merged: Record<string, unknown> = {};
  const sources: Record<string, ConfigSource> = {};

  layer(merged, sources, defaults, 'default');
  layer(merged, sources, input.resolved.shared, 'file');
  layer(merged, sources, block, 'file');
  layer(merged, sources, input.env, 'env');
  if (input.positionalSources !== undefined) {
    merged.sources = input.positionalSources;
    sources.sources = 'flag';
  }
  layer(merged, sources, input.cliOverrides, 'flag');

  return {
    effective: merged as EffectiveOptions,
    sources: sources as Partial<Record<keyof EffectiveOptions, ConfigSource>>,
  };
}

export function formatPrintConfig<C extends CommandName>(input: {
  command: C;
  result: EffectiveResult;
  filepath: string | null;
}): string {
  const { command, result, filepath } = input;
  const orderedKeys =
    command === 'query' ? QUERY_BLOCK_KEYS : SERVE_BLOCK_KEYS;

  const entries: Array<{ key: string; valueStr: string; source: ConfigSource }> =
    [];
  for (const key of orderedKeys) {
    const source = result.sources[key];
    if (source === undefined) continue;
    entries.push({
      key,
      valueStr: formatValue((result.effective as Record<string, unknown>)[key]),
      source,
    });
  }

  const keyWidth = Math.max(0, ...entries.map((e) => e.key.length));
  const valueWidth = Math.max(0, ...entries.map((e) => e.valueStr.length));

  const lines: string[] = [];
  lines.push(`# sparqly ${command} --print-config`);
  lines.push(`# config file: ${filepath ?? '(none)'}`);
  for (const e of entries) {
    lines.push(
      `${e.key.padEnd(keyWidth)}: ${e.valueStr.padEnd(valueWidth)}  # ${e.source}`,
    );
  }
  return lines.join('\n') + '\n';
}

function assign(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) target[key] = value;
  }
}

function layer(
  merged: Record<string, unknown>,
  sources: Record<string, ConfigSource>,
  src: Record<string, unknown>,
  tier: ConfigSource,
): void {
  for (const [key, value] of Object.entries(src)) {
    if (value !== undefined) {
      merged[key] = value;
      sources[key] = tier;
    }
  }
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}
