import { ResultAsync, errAsync, okAsync } from 'neverthrow';
import type { SparqlyLogger } from 'common';
import type { GitPinError } from '../errors';
import type { ParsedGlobSource, ParsedSource } from '../source-spec';
import type { RepoDiscoveryDeps } from './discover-repo';
import type { GitPort } from './git-port';
import { pinGlobSource } from './pin-glob-source';

export interface NormalizeRegistryPinsDeps {
  configDir: string;
  port: GitPort;
  repoDiscovery: RepoDiscoveryDeps;
  /** Logger for floating-ref `<ref> → <sha>` startup lines (ADR-0029, #273). */
  logger?: SparqlyLogger;
}

/**
 * Pre-resolve `gitRef:` on every glob in the registry to a 40-char commit SHA
 * and stamp it onto a copy of the source as {@link ParsedGlobSource.resolvedSha}
 * (ADR-0029). Used to normalize cache-key inputs so two refs pointing at the
 * same commit (e.g. an annotated tag and its full SHA) share cache entries.
 *
 * Registry shape and ordering are preserved. Globs without `gitRef`, globs
 * already carrying `resolvedSha`, and non-glob sources pass through untouched.
 * Resolution failures surface as a {@link GitPinError} (caller's responsibility
 * to attribute to a specific upstream).
 */
export function normalizeRegistryPinsResult(
  registry: ReadonlyArray<ParsedSource>,
  deps: NormalizeRegistryPinsDeps,
): ResultAsync<ReadonlyArray<ParsedSource>, GitPinError> {
  const needsResolve = registry.some(needsPinResolution);
  if (!needsResolve) return okAsync(registry);

  return ResultAsync.fromSafePromise(
    Promise.all(registry.map((source) => resolveOne(source, deps))),
  ).andThen((entries) => {
    for (const entry of entries) {
      if (entry.kind === 'err') return errAsync(entry.error);
    }
    return okAsync(entries.map((e) => e.source));
  });
}

function needsPinResolution(source: ParsedSource): boolean {
  return (
    source.kind === 'glob' &&
    source.gitRef !== undefined &&
    source.resolvedSha === undefined
  );
}

type ResolveOutcome =
  | { kind: 'ok'; source: ParsedSource }
  | { kind: 'err'; error: GitPinError; source: ParsedSource };

async function resolveOne(
  source: ParsedSource,
  deps: NormalizeRegistryPinsDeps,
): Promise<ResolveOutcome> {
  if (!needsPinResolution(source)) return { kind: 'ok', source };
  const glob = source as ParsedGlobSource;
  const result = await pinGlobSource(
    { source: glob, configDir: deps.configDir },
    {
      port: deps.port,
      repoDiscovery: deps.repoDiscovery,
      logger: deps.logger,
    },
  );
  if (result.isErr()) {
    return { kind: 'err', error: result.error, source };
  }
  return {
    kind: 'ok',
    source: { ...glob, resolvedSha: result.value.resolvedSha },
  };
}
