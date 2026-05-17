import { z } from 'zod';

/**
 * Stub schema for a Parameter declaration. The full schema (type, cardinality,
 * label, description, default, enum) is deferred to a later slice; this slice
 * only needs the `name:` field so the passthrough substitute() can be wired up
 * end-to-end and the saved-query sidecar schema can carry an empty list.
 */
export const ParameterDeclarationSchema = z
  .object({
    name: z.string().min(1),
  })
  .passthrough();

export type ParameterDeclaration = z.infer<typeof ParameterDeclarationSchema>;
