import { z } from 'zod';
import { GRAPH_STRATEGIES } from 'core';
import type { FieldDescriptor } from './field';

const coercedBoolean = z.preprocess((v) => {
  if (typeof v === 'string') {
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
  }
  return v;
}, z.boolean());

export const sourcesField: FieldDescriptor = {
  key: 'sources',
  schema: z.union([z.string(), z.array(z.string()).min(1)]),
  flags: [
    {
      spec: '-s, --sources <glob>',
      description:
        'Glob of RDF files to load (alternative to positional arg). Repeat to hash multiple sources independently.',
      parse: (value, prev) => [
        ...((prev as string[] | undefined) ?? []),
        value,
      ],
    },
  ],
};

export function sourcesFieldFor(commandName: string): FieldDescriptor {
  const upper = commandName.toUpperCase();
  return {
    ...sourcesField,
    env: ['SPARQLY_SOURCES', `SPARQLY_${upper}_SOURCES`],
  };
}

export function graphStrategyFieldFor(commandName: string): FieldDescriptor {
  const upper = commandName.toUpperCase();
  return {
    key: 'graphStrategy',
    schema: z.enum(GRAPH_STRATEGIES),
    default: 'default',
    env: ['SPARQLY_GRAPH_STRATEGY', `SPARQLY_${upper}_GRAPH_STRATEGY`],
    flags: [
      {
        spec: '--graph-strategy <strategy>',
        description:
          "Named-graph strategy: 'default', 'partial', 'full', or 'none' (see `query --help`)",
      },
    ],
  };
}

export function verbosityFieldsFor(
  commandName: string,
): ReadonlyArray<FieldDescriptor> {
  const upper = commandName.toUpperCase();
  return [
    {
      key: 'verbose',
      schema: coercedBoolean,
      default: false,
      env: ['SPARQLY_VERBOSE', `SPARQLY_${upper}_VERBOSE`],
      flags: [
        {
          spec: '-v, --verbose',
          description: 'Verbose logging',
        },
      ],
    },
    {
      key: 'quiet',
      schema: coercedBoolean,
      default: false,
      env: ['SPARQLY_QUIET', `SPARQLY_${upper}_QUIET`],
      flags: [
        {
          spec: '--quiet',
          description: 'Suppress non-result output',
        },
      ],
    },
  ];
}

export function outFieldFor(commandName: string): FieldDescriptor {
  const upper = commandName.toUpperCase();
  return {
    key: 'out',
    schema: z.string(),
    env: ['SPARQLY_OUT', `SPARQLY_${upper}_OUT`],
    flags: [
      {
        spec: '-o, --out <path>',
        description:
          'Write the output to <path> (CWD-relative) instead of stdout. Creates parent directories, silently overwrites, and replaces symlinks at the target.',
      },
    ],
  };
}

export const coercedBooleanSchema = coercedBoolean;
