export type SourceRow =
  | ({
      mode: 'in-memory';
      id: string;
      kind: 'glob' | 'file' | 'view' | 'empty';
      state: InMemoryState | 'mixed';
      default?: true;
      parentId?: string;
      children?: SourceRow[];
    } & Layer2Fields &
      Layer5Fields)
  | ({
      mode: 'disk-backed';
      id: string;
      kind: 'glob' | 'file';
      state: DiskBackedState | 'mixed';
      default?: true;
      parentId?: string;
      children?: SourceRow[];
    } & Layer2Fields &
      Layer3Fields &
      Layer5Fields)
  | ({
      mode: 'endpoint';
      id: string;
      kind: 'endpoint';
      default?: true;
    } & Layer4Fields);

export type InMemoryState = 'not-loaded' | 'loading' | 'loaded' | 'failed';
export type DiskBackedState =
  | 'not-built'
  | 'indexing'
  | 'ready'
  | 'stale'
  | 'failed';

interface Layer2Fields {
  quads?: number;
  files?: number;
  loadedAt?: number;
  loadMs?: number;
}

/** `staleReason` is present iff `state === 'stale'`. */
interface Layer3Fields {
  indexDir?: string;
  indexBytes?: number;
  manifestSparqlyVersion?: string;
  staleReason?: string;
}

interface Layer4Fields {
  endpointUrl?: string;
}

/** Present iff state is `failed`; never on endpoint rows. */
interface Layer5Fields {
  error?: SourceRowError;
}

export interface SourceRowError {
  kind: string;
  message: string;
  details?: string;
}

export type EndpointProbeChip =
  | { state: 'pending' }
  | { state: 'ok'; latencyMs: number }
  | { state: 'error'; kind: string; message: string };
