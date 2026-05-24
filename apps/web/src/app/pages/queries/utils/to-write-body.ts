import type { SavedQueryWriteBody } from '@app/core';
import type { ParameterDeclaration } from 'common';

export function toWriteBody(
  body: string,
  parameters: ReadonlyArray<ParameterDeclaration>,
): SavedQueryWriteBody {
  return {
    body,
    ...(parameters.length > 0 ? { parameters } : {}),
  };
}
