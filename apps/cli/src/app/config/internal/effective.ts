import { defaultsFromFields } from '../../runner/field';
import type { CommandSpec } from '../../runner/spec';
import type { FileConfigBlocks } from './file-config';

export type ConfigSource = 'default' | 'file' | 'env' | 'flag';

export interface MergeInput {
  spec: CommandSpec;
  file: FileConfigBlocks;
  env: Record<string, unknown>;
  cliOverrides: Record<string, unknown>;
  positionalSources?: string;
}

export interface MergeResult {
  effective: Record<string, unknown>;
  sources: Record<string, ConfigSource>;
}

interface Layer {
  source: ConfigSource;
  read: (input: MergeInput) => Record<string, unknown>;
}

const LAYERS: ReadonlyArray<Layer> = [
  { source: 'default', read: (i) => defaultsFromFields(i.spec.fields) },
  { source: 'file', read: (i) => i.file.shared },
  {
    source: 'file',
    read: (i) => i.file.blocks[i.spec.fileBlockName ?? i.spec.name] ?? {},
  },
  { source: 'env', read: (i) => i.env },
  {
    source: 'flag',
    read: (i) =>
      i.positionalSources !== undefined ? { sources: i.positionalSources } : {},
  },
  { source: 'flag', read: (i) => i.cliOverrides },
];

const DEEP_MERGE_KEYS: ReadonlySet<string> = new Set(['prefixes']);

export function merge(input: MergeInput): MergeResult {
  const merged: Record<string, unknown> = {};
  const sources: Record<string, ConfigSource> = {};
  for (const layer of LAYERS) {
    for (const [key, value] of Object.entries(layer.read(input))) {
      if (value === undefined) continue;
      if (
        DEEP_MERGE_KEYS.has(key) &&
        isPlainObject(merged[key]) &&
        isPlainObject(value)
      ) {
        merged[key] = {
          ...(merged[key] as Record<string, unknown>),
          ...(value as Record<string, unknown>),
        };
      } else {
        merged[key] = value;
      }
      sources[key] = layer.source;
    }
  }
  return { effective: merged, sources };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function formatPrintConfig(input: {
  spec: CommandSpec;
  result: MergeResult;
  filepath: string | null;
}): string {
  const { spec, result, filepath } = input;
  const orderedKeys = spec.fields.map((f) => f.key);

  const entries: Array<{ key: string; valueStr: string; source: ConfigSource }> =
    [];
  for (const key of orderedKeys) {
    const source = result.sources[key];
    if (source === undefined) continue;
    entries.push({
      key,
      valueStr: formatValue(result.effective[key]),
      source,
    });
  }

  const keyWidth = Math.max(0, ...entries.map((e) => e.key.length));
  const valueWidth = Math.max(0, ...entries.map((e) => e.valueStr.length));

  const lines: string[] = [];
  lines.push(`# sparqly ${spec.name} --print-config`);
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
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}
