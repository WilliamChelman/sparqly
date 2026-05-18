import type { SavedQueryWriteBody } from '@app/core';
import type { ParameterDeclaration } from 'common';

export interface CreateNavState {
  prefill?: { body?: string; parameters?: ReadonlyArray<ParameterDeclaration> };
  origin?: string;
}

export type DetailState =
  | { kind: 'empty' }
  | { kind: 'loading'; slug: string }
  | {
      kind: 'loaded';
      slug: string;
      loadedBody: string;
      loadedEtag: string;
      loadedParameters: ReadonlyArray<ParameterDeclaration>;
    }
  | { kind: 'not-found'; slug: string }
  | {
      kind: 'create';
      origin: string | null;
      prefillBody: string;
      prefillParameters: ReadonlyArray<ParameterDeclaration>;
    };

export function parametersEqual(
  a: ReadonlyArray<ParameterDeclaration>,
  b: ReadonlyArray<ParameterDeclaration>,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function toWriteBody(
  body: string,
  parameters: ReadonlyArray<ParameterDeclaration>,
): SavedQueryWriteBody {
  return {
    body,
    ...(parameters.length > 0 ? { parameters } : {}),
  };
}
