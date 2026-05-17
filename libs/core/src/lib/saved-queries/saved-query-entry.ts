import { z } from 'zod';
import { ParameterDeclarationSchema } from 'common';

export const SAVED_QUERY_SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const SavedQueryEntrySchema = z
  .object({
    slug: z.string().regex(SAVED_QUERY_SLUG_REGEX),
    description: z.string().optional(),
    body: z.string().min(1),
    parameters: z.array(ParameterDeclarationSchema).optional(),
  })
  .strict();

export type SavedQueryEntry = z.infer<typeof SavedQueryEntrySchema>;
