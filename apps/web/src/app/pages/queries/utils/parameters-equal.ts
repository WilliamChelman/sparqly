import type { ParameterDeclaration } from 'common';

export function parametersEqual(
  a: ReadonlyArray<ParameterDeclaration>,
  b: ReadonlyArray<ParameterDeclaration>,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
