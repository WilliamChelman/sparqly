import { loadRdf, type GraphMode, type LoadResult } from './rdf-loader';
import {
  parseSourceSpecs,
  type ParseSourceSpecsContext,
  type SourceSpecInput,
} from './source-spec';

export const NOT_SUPPORTED_TRACKING_URL =
  'https://github.com/WilliamChelman/sparqly/issues/60';

export interface LoadSourcesOptions {
  graphMode?: GraphMode;
  parseContext?: ParseSourceSpecsContext;
}

export async function loadSources(
  inputs: ReadonlyArray<SourceSpecInput>,
  options: LoadSourcesOptions = {},
): Promise<LoadResult> {
  const parsed = parseSourceSpecs(inputs, options.parseContext);
  const globs: string[] = [];
  for (const source of parsed) {
    if (source.kind === 'endpoint') {
      throw new Error(
        `SPARQL endpoint sources are not yet supported (tracking: ${NOT_SUPPORTED_TRACKING_URL})`,
      );
    }
    if (source.kind === 'reference') {
      throw new Error(
        `@id reference sources are not yet supported (tracking: ${NOT_SUPPORTED_TRACKING_URL})`,
      );
    }
    globs.push(source.glob);
  }
  return loadRdf({ sources: globs, graphMode: options.graphMode });
}
