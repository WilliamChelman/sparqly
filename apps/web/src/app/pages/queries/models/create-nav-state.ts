import type { ParameterDeclaration } from 'common';

export interface CreateNavState {
  prefill?: { body?: string; parameters?: ReadonlyArray<ParameterDeclaration> };
  origin?: string;
}
