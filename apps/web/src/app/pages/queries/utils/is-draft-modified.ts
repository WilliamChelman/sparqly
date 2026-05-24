import type { ParameterDeclaration } from 'common';
import { parametersEqual } from './parameters-equal';

/**
 * Stale-detection rule for the loaded-detail surface: a draft is "modified
 * from <slug>" exactly when its body or its parameter declarations differ
 * from the version last loaded from (or saved to) the server.
 */
export function isDraftModified(
  loaded: {
    readonly body: string;
    readonly parameters: ReadonlyArray<ParameterDeclaration>;
  },
  draft: {
    readonly body: string;
    readonly parameters: ReadonlyArray<ParameterDeclaration>;
  },
): boolean {
  if (loaded.body !== draft.body) return true;
  return !parametersEqual(loaded.parameters, draft.parameters);
}
