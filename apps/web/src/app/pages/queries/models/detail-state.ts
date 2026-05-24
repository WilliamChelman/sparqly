import type { ParameterDeclaration } from 'common';

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
