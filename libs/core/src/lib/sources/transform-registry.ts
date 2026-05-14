import { ANNOTATE_SOURCE_TRANSFORM } from './annotate-transform';
import { GRAPH_NAME_TRANSFORM } from './graph-name-transform';
import type { TransformDefinition } from './transform-spec';

/**
 * Closed registry of source transforms recognised by the source-spec parser.
 * Adding a transform: append a `TransformDefinition` here.
 */
export const TRANSFORM_REGISTRY: ReadonlyArray<TransformDefinition> = [
  GRAPH_NAME_TRANSFORM,
  ANNOTATE_SOURCE_TRANSFORM,
];
