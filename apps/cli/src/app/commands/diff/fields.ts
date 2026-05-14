import { z } from 'zod';
import type { FieldDescriptor } from '../../runner/fields/field';
import { singleSourceSchema } from '../../runner/fields/fields-shared';

export const DIFF_FORMATS = [
  'html',
  'human',
  'json',
  'rdf-patch',
  'turtle',
  'grouped',
] as const;
export type DiffFormat = (typeof DIFF_FORMATS)[number];

export const MAX_SNIPPET_CONTEXT = 100;

export function inferDiffFormatFromOut(
  out: string | undefined,
): DiffFormat | undefined {
  if (out === undefined) return undefined;
  const lower = out.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.ttl')) return 'turtle';
  return undefined;
}

const sourceSpecObjectSchema = z.record(z.string(), z.unknown());

export const sourcesRegistryField: FieldDescriptor = {
  key: 'sources',
  schema: z.array(z.union([z.string(), sourceSpecObjectSchema])),
};

export const leftField: FieldDescriptor = {
  key: 'left',
  schema: singleSourceSchema,
  flags: [
    {
      spec: '--left <source>',
      description:
        'Left-hand target source: an `@id` ref into the config registry, or an inline glob/URL. Alternative to the first positional argument.',
    },
  ],
};

export const rightField: FieldDescriptor = {
  key: 'right',
  schema: singleSourceSchema,
  flags: [
    {
      spec: '--right <source>',
      description:
        'Right-hand target source: an `@id` ref into the config registry, or an inline glob/URL. Alternative to the second positional argument.',
    },
  ],
};

export const queryField: FieldDescriptor = {
  key: 'query',
  schema: z.string().min(1),
  flags: [
    {
      spec: '--query <sparql>',
      description:
        'Inline SPARQL CONSTRUCT or SELECT-{?s,?p,?o[,?g]} that scopes BOTH sides identically. Required for SPARQL endpoint targets; otherwise optional. Lowers to an anonymous, uncached view per side. Mutually exclusive with --query-file.',
    },
  ],
};

export const queryFileField: FieldDescriptor = {
  key: 'queryFile',
  schema: z.string().min(1),
  flags: [
    {
      spec: '--query-file <path>',
      description:
        'Path to a SPARQL file (relative to CWD) used as the inline scoping query for both sides. Mutually exclusive with --query.',
    },
  ],
};

export const leftQueryField: FieldDescriptor = {
  key: 'leftQuery',
  schema: z.string().min(1),
  flags: [
    {
      spec: '--left-query <sparql>',
      description:
        'Inline SPARQL CONSTRUCT or SELECT-{?s,?p,?o[,?g]} that scopes the LEFT side. Required for SPARQL endpoint targets on that side; otherwise optional. Lowers to an anonymous, uncached view. Mutually exclusive with --left-query-file and with the symmetric --query/--query-file.',
    },
  ],
};

export const leftQueryFileField: FieldDescriptor = {
  key: 'leftQueryFile',
  schema: z.string().min(1),
  flags: [
    {
      spec: '--left-query-file <path>',
      description:
        'Path to a SPARQL file (relative to CWD) used as the inline scoping query for the left side. Mutually exclusive with --left-query and with the symmetric --query/--query-file.',
    },
  ],
};

export const rightQueryField: FieldDescriptor = {
  key: 'rightQuery',
  schema: z.string().min(1),
  flags: [
    {
      spec: '--right-query <sparql>',
      description:
        'Inline SPARQL CONSTRUCT or SELECT-{?s,?p,?o[,?g]} that scopes the RIGHT side. Required for SPARQL endpoint targets on that side; otherwise optional. Lowers to an anonymous, uncached view. Mutually exclusive with --right-query-file and with the symmetric --query/--query-file.',
    },
  ],
};

export const rightQueryFileField: FieldDescriptor = {
  key: 'rightQueryFile',
  schema: z.string().min(1),
  flags: [
    {
      spec: '--right-query-file <path>',
      description:
        'Path to a SPARQL file (relative to CWD) used as the inline scoping query for the right side. Mutually exclusive with --right-query and with the symmetric --query/--query-file.',
    },
  ],
};

export const formatField: FieldDescriptor = {
  key: 'format',
  schema: z.enum(DIFF_FORMATS),
  flags: [
    {
      spec: '-f, --format <format>',
      description: `Output format: ${DIFF_FORMATS.map((f) => `'${f}'`).join(', ')}. When omitted, inferred from --out's extension (.html/.htm → html, .json → json, .ttl → turtle), falling back to 'human'. Format \`html\` benefits from source records, which \`diff\` auto-attaches to glob targets unless \`--skip-auto-source-annotation\` is passed.`,
    },
  ],
};

export const skipAutoSourceAnnotationField: FieldDescriptor = {
  key: 'skipAutoSourceAnnotation',
  schema: z.preprocess(
    (v) => (typeof v === 'string' ? v === 'true' : v),
    z.boolean(),
  ),
  default: false,
  flags: [
    {
      spec: '--skip-auto-source-annotation',
      description:
        "Suppress `diff`'s implicit `annotateSource` injection on glob targets. Has no effect on view/endpoint targets (which can't carry source records anyway). An explicit `annotateSource` declared in config still runs. Also a no-op in tabular diff mode — bindings rows have no per-row provenance, so no annotation is injected on either side.",
    },
  ],
};

export const snippetContextField: FieldDescriptor = {
  key: 'snippetContext',
  schema: z.preprocess((v) => {
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return v;
  }, z.number().int().min(0).max(MAX_SNIPPET_CONTEXT)),
  flags: [
    {
      spec: '-C, --snippet-context <n>',
      description: `Number of source-file context lines around each focal line in the \`html\` format (default 3, max ${MAX_SNIPPET_CONTEXT}). Loud-errors when used with any non-html format.`,
    },
  ],
};
