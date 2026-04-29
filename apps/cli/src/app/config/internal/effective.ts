import {
  blockKeysFor,
  defaultsFor,
  type CommandName,
  type EffectiveOptions,
} from './schema';
import type { FileConfigBlocks } from './file-config';

export type ConfigSource = 'default' | 'file' | 'env' | 'flag';

export interface MergeInput {
  command: CommandName;
  file: FileConfigBlocks;
  env: Record<string, unknown>;
  cliOverrides: Partial<EffectiveOptions>;
  positionalSources?: string;
}

export interface MergeResult {
  effective: EffectiveOptions;
  sources: Partial<Record<keyof EffectiveOptions, ConfigSource>>;
}

interface Layer {
  source: ConfigSource;
  read: (input: MergeInput) => Record<string, unknown>;
}

const LAYERS: ReadonlyArray<Layer> = [
  { source: 'default', read: (i) => defaultsFor(i.command) },
  { source: 'file', read: (i) => i.file.shared },
  {
    source: 'file',
    read: (i) => (i.command === 'query' ? i.file.queryBlock : i.file.serveBlock),
  },
  { source: 'env', read: (i) => i.env },
  {
    source: 'flag',
    read: (i) =>
      i.positionalSources !== undefined ? { sources: i.positionalSources } : {},
  },
  { source: 'flag', read: (i) => i.cliOverrides as Record<string, unknown> },
];

export function merge(input: MergeInput): MergeResult {
  const merged: Record<string, unknown> = {};
  const sources: Record<string, ConfigSource> = {};
  for (const layer of LAYERS) {
    for (const [key, value] of Object.entries(layer.read(input))) {
      if (value === undefined) continue;
      merged[key] = value;
      sources[key] = layer.source;
    }
  }
  return {
    effective: merged as EffectiveOptions,
    sources: sources as Partial<Record<keyof EffectiveOptions, ConfigSource>>,
  };
}

export function formatPrintConfig(input: {
  command: CommandName;
  result: MergeResult;
  filepath: string | null;
}): string {
  const { command, result, filepath } = input;
  const orderedKeys = blockKeysFor(command);

  const entries: Array<{ key: string; valueStr: string; source: ConfigSource }> =
    [];
  for (const key of orderedKeys) {
    const source = result.sources[key as keyof EffectiveOptions];
    if (source === undefined) continue;
    entries.push({
      key,
      valueStr: formatValue(
        (result.effective as Record<string, unknown>)[key],
      ),
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

function formatValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}
