import { ok, type Result } from 'neverthrow';
import type { ParameterDeclaration } from './parameter-declaration';

export interface SubstitutionInput {
  body: string;
  parameters: ReadonlyArray<ParameterDeclaration>;
}

export type ParameterBindings = Readonly<Record<string, unknown>>;

export type SubstitutionError = { kind: 'not-yet-implemented' };

export function substitute(
  input: SubstitutionInput,
  _bindings: ParameterBindings,
): Result<string, SubstitutionError> {
  // Slice 1: passthrough only. The templated branch (VALUES injection from
  // parameter declarations) lands in a follow-up slice; this slice ships the
  // literal-saved-query path end-to-end.
  return ok(input.body);
}
