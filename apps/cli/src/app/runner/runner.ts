import { Logger } from '@nestjs/common';
import { Option, type Command } from 'commander';
import { resolveSourceReferences, type SourceSpecInput } from 'core';
import { configureLogger } from '../logging';
import type { FieldDescriptor } from './fields/field';
import { blockSchemaFromFields } from './fields/field';
import { mergeLayers } from './fields/merge';
import type { CommandSpec } from './fields/spec';

export interface FileLayers {
  readonly data: Record<string, unknown>;
  readonly filepath: string | null;
}

export interface WritableLike {
  write: (chunk: string) => unknown;
}

export interface RunnerContext {
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly stdout?: WritableLike;
  readonly stderr?: WritableLike;
  readonly loadFile?: (configPath: string, cwd: string) => Promise<FileLayers>;
  readonly discoverConfig?: (cwd: string) => string | null;
}

export function registerSpec<T extends Record<string, unknown>>(
  program: Command,
  spec: CommandSpec<T>,
  ctx: RunnerContext,
): Command {
  const positionalArgs = (spec.positionals ?? [])
    .map((p) => {
      const inner = p.variadic ? `${p.name}...` : p.name;
      return p.required ? `<${inner}>` : `[${inner}]`;
    })
    .join(' ');

  const segments = spec.name.split(/\s+/).filter(Boolean);
  const leafName = segments[segments.length - 1];
  const parentSegments = segments.slice(0, -1);
  let parent: Command = program;
  for (const segment of parentSegments) {
    parent = findOrCreateParent(parent, segment);
  }

  const sub = parent
    .command(positionalArgs ? `${leafName} ${positionalArgs}` : leafName)
    .description(spec.description);

  const positionalsCount = (spec.positionals ?? []).length;
  const allowsVariadic = (spec.positionals ?? []).some((p) => p.variadic);

  applyFieldFlags(sub, spec.fields);
  sub.option('--config <path>', 'Path to a sparqly.config.{yaml,yml,json} file.');
  sub.option(
    '--no-config',
    'Skip auto-discovery of sparqly.config.{yaml,yml,json} from the current directory upward.',
  );

  sub.action(async (...args: unknown[]) => {
    let rawConfig: Record<string, unknown> = {};
    try {
      const commanderInstance = args[args.length - 1] as Command;
      const optsBag = commanderInstance.opts() as Record<string, unknown>;
      const positionalValues = args.slice(0, -2) as unknown[];

      if (
        positionalsCount > 0 &&
        !allowsVariadic &&
        commanderInstance.args.length > positionalsCount
      ) {
        throw new Error(
          `${spec.name} takes at most ${numberWord(positionalsCount)} positional argument${
            positionalsCount === 1 ? '' : 's'
          } (got ${commanderInstance.args.length})`,
        );
      }

      const cli: Record<string, unknown> = {};
      for (const f of spec.fields) {
        const v = optsBag[f.key];
        if (v !== undefined) cli[f.key] = v;
      }
      spec.positionals?.forEach((p, i) => {
        const v = positionalValues[i];
        if (v === undefined || v === null) return;
        if (cli[p.field] !== undefined) return;
        cli[p.field] = v;
      });

      const rawConfigOpt = optsBag.config;
      const flagConfigPath =
        typeof rawConfigOpt === 'string' ? rawConfigOpt : undefined;
      const envConfigPath = ctx.env['SPARQLY_CONFIG'];
      const noConfig = rawConfigOpt === false || envConfigPath === '';
      let configPath: string | undefined;
      if (flagConfigPath !== undefined) {
        configPath = flagConfigPath;
      } else if (envConfigPath !== undefined && envConfigPath !== '') {
        configPath = envConfigPath;
      } else if (!noConfig && ctx.discoverConfig) {
        configPath = ctx.discoverConfig(ctx.cwd) ?? undefined;
      }
      const fileLayers: FileLayers =
        ctx.loadFile && configPath !== undefined
          ? await ctx.loadFile(configPath, ctx.cwd)
          : { data: {}, filepath: null };

      const env = readEnv(spec.fields, ctx.env);
      const fileSlice = projectFileLayer(fileLayers.data, spec);

      const merged = mergeLayers(spec.fields, {
        file: fileSlice,
        env,
        cli,
      });
      resolveSourcesIfPresent(merged.config, fileLayers);
      rawConfig = merged.config;

      const baseSchema = blockSchemaFromFields(spec.fields);
      const finalSchema = spec.refine ? spec.refine(baseSchema) : baseSchema;
      const validated = finalSchema.safeParse(merged.config);
      if (!validated.success) {
        throw new Error(formatIssues(validated.error.issues, spec.fields, merged.config));
      }

      const data = validated.data as Record<string, unknown>;
      configureLogger({
        verbose: data.verbose === true,
        quiet: data.quiet === true,
        logFormat: data.logFormat === 'json' ? 'json' : 'text',
      });
      if (fileLayers.filepath && data.verbose === true) {
        new Logger('sparqly').log(`Loaded config from ${fileLayers.filepath}`);
      }

      await spec.handler(validated.data as T);
    } catch (err) {
      const silent = (err as { silent?: boolean } | undefined)?.silent === true;
      if (!silent) {
        const msg = err instanceof Error ? err.message : String(err);
        (ctx.stderr ?? process.stderr).write(`error: ${msg}\n`);
      }
      process.exitCode = spec.exitCode(err, { rawConfig });
    }
  });

  return sub;
}

function projectFileLayer(
  data: Record<string, unknown>,
  spec: CommandSpec,
): Record<string, unknown> {
  const scope = spec.configScope ?? { sources: true };
  const out: Record<string, unknown> = {};
  if (scope.sources !== false && data.sources !== undefined) {
    out.sources = data.sources;
  }
  // Registry-wide blocks whose keys map 1:1 onto a command's flat field keys.
  // A command only picks up a block's keys if it declares matching fields.
  const fieldKeys = new Set(spec.fields.map((f) => f.key));
  for (const blockName of ['context', 'describe', 'savedQueries'] as const) {
    const block = data[blockName];
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    for (const [k, v] of Object.entries(block as Record<string, unknown>)) {
      if (v === undefined) continue;
      const fieldKey =
        blockName === 'savedQueries' && k === 'path' ? 'savedQueriesPath' : k;
      if (fieldKeys.has(fieldKey)) out[fieldKey] = v;
    }
  }
  if (scope.block !== undefined) {
    const raw = data[scope.block];
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const block = raw as Record<string, unknown>;
      for (const [k, v] of Object.entries(block)) {
        if (v === undefined) continue;
        const fieldKey = scope.block === 'cache' && k === 'dir' ? 'cacheDir' : k;
        out[fieldKey] = v;
      }
    }
  }
  return out;
}

function resolveSourcesIfPresent(
  config: Record<string, unknown>,
  fileLayers: FileLayers,
): void {
  const sources = config.sources;
  if (sources === undefined) return;
  const list: SourceSpecInput[] = Array.isArray(sources)
    ? (sources as SourceSpecInput[])
    : [sources as SourceSpecInput];
  const registry = fileLayers.filepath === null
    ? null
    : ((fileLayers.data.sources as SourceSpecInput[] | undefined) ?? []);
  const resolved = resolveSourceReferences(list, { registry });
  config.sources = Array.isArray(sources) ? resolved : resolved[0];
}

function findOrCreateParent(parent: Command, segment: string): Command {
  const existing = parent.commands.find((c) => c.name() === segment);
  if (existing) return existing;
  return parent.command(segment).description(`${segment} commands`);
}

class AliasedOption extends Option {
  constructor(
    flags: string,
    description: string,
    private readonly attrName: string,
  ) {
    super(flags, description);
  }
  override attributeName(): string {
    return this.attrName;
  }
}

function applyFieldFlags(
  sub: Command,
  fields: ReadonlyArray<FieldDescriptor>,
): void {
  for (const f of fields) {
    for (const flag of f.flags ?? []) {
      const opt = flag.attributeName
        ? new AliasedOption(flag.spec, flag.description, flag.attributeName)
        : new Option(flag.spec, flag.description);
      if (flag.preset !== undefined) opt.preset(flag.preset);
      const parse = flag.parse;
      if (parse) opt.argParser((value, prev) => parse(value, prev));
      sub.addOption(opt);
    }
  }
}

function readEnv(
  fields: ReadonlyArray<FieldDescriptor>,
  env: NodeJS.ProcessEnv,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.env === undefined) continue;
    const names = typeof f.env === 'string' ? [f.env] : f.env;
    for (const name of names) {
      const v = env[name];
      if (v !== undefined) out[f.key] = v;
    }
  }
  return out;
}

function numberWord(n: number): string {
  return n === 2 ? 'two' : String(n);
}

function flagFor(field: FieldDescriptor): string {
  for (const f of field.flags ?? []) {
    const match = f.spec.match(/--[a-zA-Z0-9-]+/);
    if (match) return match[0];
  }
  return `--${field.key}`;
}

function formatIssues(
  issues: ReadonlyArray<{ code?: string; path: ReadonlyArray<PropertyKey>; message: string; values?: ReadonlyArray<unknown> }>,
  fields: ReadonlyArray<FieldDescriptor>,
  rawValues: Record<string, unknown>,
): string {
  const fieldByKey = new Map(fields.map((f) => [f.key, f]));
  return issues
    .map((issue) => {
      const key = String(issue.path[0] ?? '');
      const field = fieldByKey.get(key);
      const flag = field ? flagFor(field) : `--${key}`;
      if (issue.code === 'invalid_value' && Array.isArray(issue.values)) {
        const offered = rawValues[key];
        const expected = issue.values.join(', ');
        return `unknown ${flag} '${String(offered)}' (expected ${expected})`;
      }
      return `${flag}: ${issue.message}`;
    })
    .join('; ');
}
