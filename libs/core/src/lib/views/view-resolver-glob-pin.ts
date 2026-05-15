import { Store } from 'n3';
import { ResultAsync } from 'neverthrow';
import type { SparqlyLogger } from 'common';
import { loadRdfResult } from '../engine';
import {
  applyTransformPipeline,
  type ParsedGlobSource,
  type ParsedViewSource,
} from '../sources';
import type { GitPort } from '../sources/git/git-port';
import { pinGlobSource } from '../sources/git/pin-glob-source';
import type { RepoDiscoveryDeps } from '../sources/git/discover-repo';
import type { GitPinError, GlobLoadError } from '../sources/errors';

export type LoadPinnedGlobError = GlobLoadError | GitPinError;

export interface PinDeps {
  configDir: string;
  gitPort: GitPort;
  repoDiscovery: RepoDiscoveryDeps;
}

export function loadPinnedGlobUpstreamResult(
  view: ParsedViewSource,
  globUpstream: ParsedGlobSource,
  logger: SparqlyLogger | undefined,
  pinDeps: PinDeps,
): ResultAsync<Store, LoadPinnedGlobError> {
  const effectivePin = effectivePinFor(view, globUpstream);
  if (effectivePin === undefined) {
    return loadRdfResult({ sources: globUpstream.glob, logger }).map((sub) =>
      applyTransformPipeline(sub.store, globUpstream.transforms ?? [], {
        perFileRecords: sub.perFileRecords,
      }),
    );
  }
  const pinnedGlob: ParsedGlobSource = {
    ...globUpstream,
    gitRef: effectivePin,
    resolvedSha: undefined,
  };
  return pinGlobSource(
    { source: pinnedGlob, configDir: pinDeps.configDir },
    {
      port: pinDeps.gitPort,
      repoDiscovery: pinDeps.repoDiscovery,
      logger,
    },
  )
    .mapErr<LoadPinnedGlobError>((e) => e)
    .andThen<Store, LoadPinnedGlobError>((pinned) =>
      loadRdfResult({
        sources: globUpstream.glob,
        logger,
        contentReader: pinned.contentReader,
      }).map((sub) =>
        applyTransformPipeline(sub.store, globUpstream.transforms ?? [], {
          perFileRecords: sub.perFileRecords,
        }),
      ),
    );
}

function effectivePinFor(
  view: ParsedViewSource,
  upstream: ParsedGlobSource,
): string | undefined {
  if (view.fromGitRef !== undefined) return view.fromGitRef;
  return upstream.gitRef;
}

