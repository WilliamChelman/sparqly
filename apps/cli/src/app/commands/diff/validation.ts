import { z } from 'zod';
import { inferDiffFormatFromOut, type DiffFormat } from './fields';

export function refineDiffConfig(schema: z.ZodObject): z.ZodTypeAny {
  return schema.superRefine((val: Record<string, unknown>, ctx) => {
    const effectiveFormat =
      (val.format as DiffFormat | undefined) ??
      inferDiffFormatFromOut(val.out as string | undefined) ??
      'human';
    if (val.snippetContext !== undefined && effectiveFormat !== 'html') {
      ctx.addIssue({
        code: 'custom',
        message:
          '`--snippet-context` is only valid with `--format=html`; remove `--snippet-context` or pass `--format=html`',
        path: ['snippetContext'],
      });
    }
    const hasSymQuery = typeof val.query === 'string';
    const hasSymQueryFile = typeof val.queryFile === 'string';
    if (hasSymQuery && hasSymQueryFile) {
      ctx.addIssue({
        code: 'custom',
        message:
          '`--query` and `--query-file` are mutually exclusive on `diff`',
        path: ['query'],
      });
    }
    const symInlineScope = hasSymQuery || hasSymQueryFile;

    for (const side of ['left', 'right'] as const) {
      const sideQueryKey = side === 'left' ? 'leftQuery' : 'rightQuery';
      const sideQueryFileKey =
        side === 'left' ? 'leftQueryFile' : 'rightQueryFile';
      const sideQueryFlag =
        side === 'left' ? '--left-query' : '--right-query';
      const sideQueryFileFlag =
        side === 'left' ? '--left-query-file' : '--right-query-file';
      const hasSideQuery = typeof val[sideQueryKey] === 'string';
      const hasSideQueryFile = typeof val[sideQueryFileKey] === 'string';

      if (hasSideQuery && hasSideQueryFile) {
        ctx.addIssue({
          code: 'custom',
          message: `\`${sideQueryFlag}\` and \`${sideQueryFileFlag}\` are mutually exclusive on \`diff\``,
          path: [sideQueryKey],
        });
      }
      if (symInlineScope && hasSideQuery) {
        ctx.addIssue({
          code: 'custom',
          message: `symmetric \`--query\`/\`--query-file\` and \`${sideQueryFlag}\` are mutually exclusive on the same side`,
          path: [sideQueryKey],
        });
      }
      if (symInlineScope && hasSideQueryFile) {
        ctx.addIssue({
          code: 'custom',
          message: `symmetric \`--query\`/\`--query-file\` and \`${sideQueryFileFlag}\` are mutually exclusive on the same side`,
          path: [sideQueryFileKey],
        });
      }
    }
  });
}
