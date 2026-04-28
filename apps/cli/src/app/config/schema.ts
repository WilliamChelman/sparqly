import { z } from 'zod';

export const SHARED_CONFIG_KEYS = [
  'sources',
  'graphStrategy',
  'mutable',
  'verbose',
  'quiet',
] as const;

export const sharedConfigSchema = z
  .object({
    sources: z.string().optional(),
    graphStrategy: z.enum(['default', 'partial', 'full']).optional(),
    mutable: z.boolean().optional(),
    verbose: z.boolean().optional(),
    quiet: z.boolean().optional(),
  })
  .passthrough();

export type SharedConfig = z.infer<typeof sharedConfigSchema>;
