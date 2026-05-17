import { z } from 'zod';

export const PARAMETER_TYPES = [
  'iri',
  'string',
  'integer',
  'decimal',
  'boolean',
  'date',
  'dateTime',
  'langString',
  'literal',
] as const;

export const PARAMETER_CARDINALITIES = [
  '0..1',
  '1..1',
  '0..n',
  '1..n',
] as const;

export type ParameterType = (typeof PARAMETER_TYPES)[number];
export type ParameterCardinality = (typeof PARAMETER_CARDINALITIES)[number];

export const ParameterDeclarationSchema = z
  .object({
    name: z.string().min(1),
    type: z.enum(PARAMETER_TYPES),
    cardinality: z.enum(PARAMETER_CARDINALITIES),
    datatype: z.string().min(1).optional(),
    label: z.string().optional(),
    description: z.string().optional(),
    default: z.unknown().optional(),
    enum: z.array(z.unknown()).optional(),
  })
  .strict()
  .refine((p) => p.type !== 'literal' || typeof p.datatype === 'string', {
    message: 'literal parameter requires datatype',
    path: ['datatype'],
  })
  .refine((p) => p.type === 'literal' || p.datatype === undefined, {
    message: 'datatype is only allowed when type is literal',
    path: ['datatype'],
  });

export type ParameterDeclaration = z.infer<typeof ParameterDeclarationSchema>;
