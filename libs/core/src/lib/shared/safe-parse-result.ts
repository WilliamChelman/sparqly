import { err, ok, type Result } from 'neverthrow';
import type { z } from 'zod';

/**
 * Per-ADR-0024 adapter from Zod's `safeParse` `{ success, error }` shape to a
 * `Result`, so schema-validation failures compose with the rest of a feature's
 * tagged-error union at input boundaries (controllers, CLI argv parsing)
 * instead of branching on a different shape.
 */
export interface SafeParseIssue {
  path: ReadonlyArray<PropertyKey>;
  message: string;
}

export interface SafeParseError {
  kind: 'zod-validation';
  issues: ReadonlyArray<SafeParseIssue>;
}

export function safeParseResult<TOut>(
  schema: z.ZodType<TOut>,
  input: unknown,
): Result<TOut, SafeParseError> {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return ok(parsed.data);
  }
  return err({
    kind: 'zod-validation',
    issues: parsed.error.issues.map((i) => ({
      path: i.path,
      message: i.message,
    })),
  });
}
