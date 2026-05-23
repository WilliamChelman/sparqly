import type { SparqlyLogger } from 'common';

// Time-based (not quad-based) so heartbeat lines stay bounded regardless of
// dataset size — a 15-min build is ~180 lines.
export const HEARTBEAT_MS = 5000;

/** A matched file the build will index, with the byte size feeding byte-%. */
export interface BuildProgressFile {
  /** Absolute path of the matched file. */
  path: string;
  /** Byte size of the file (from `stat`). */
  bytes: number;
}

export interface BuildProgressOptions {
  /** The matched files with their byte sizes, in glob-enumeration order. */
  files: ReadonlyArray<BuildProgressFile>;
  /** Boundary logger the events fire through; omit to disable progress. */
  logger?: SparqlyLogger;
  /** Wall clock — injectable for tests. Defaults to `Date.now`. */
  now?: () => number;
  /** Heartbeat throttle in ms. Defaults to {@link HEARTBEAT_MS}. */
  heartbeatMs?: number;
}

export class BuildProgress {
  private readonly files: ReadonlyArray<BuildProgressFile>;
  private readonly logger: SparqlyLogger | undefined;
  private readonly now: () => number;
  private readonly heartbeatMs: number;
  private readonly totalBytes: number;
  private readonly startTime: number;
  private lastHeartbeat: number;
  private completedBytes = 0;
  private quads = 0;

  constructor(options: BuildProgressOptions) {
    this.files = options.files;
    this.logger = options.logger;
    this.now = options.now ?? Date.now;
    this.heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
    this.totalBytes = options.files.reduce((sum, file) => sum + file.bytes, 0);
    this.startTime = this.now();
    this.lastHeartbeat = this.startTime;
  }

  /** Emits `index-file-start` for the file at `index` (0-based). */
  fileStarted(index: number): void {
    this.emitFileEvent('index-file-start', index);
  }

  /** Emits `index-file-done` for the file at `index` (0-based). */
  fileDone(index: number): void {
    this.completedBytes += this.files[index].bytes;
    this.emitFileEvent('index-file-done', index);
  }

  /**
   * Records `count` quads written to the index and emits an `index-progress`
   * heartbeat when at least one throttle interval has elapsed since the last.
   */
  quadsWritten(count: number): void {
    this.quads += count;
    const at = this.now();
    if (at - this.lastHeartbeat < this.heartbeatMs) return;
    this.lastHeartbeat = at;
    const ms = at - this.startTime;
    this.logger?.info('index-progress', {
      percent:
        this.totalBytes === 0
          ? 100
          : Math.round((this.completedBytes / this.totalBytes) * 100),
      quads: this.quads,
      ms,
      rate: Math.round(this.quads / (ms / 1000)),
    });
  }

  private emitFileEvent(msg: string, index: number): void {
    const file = this.files[index];
    this.logger?.info(msg, {
      file: file.path,
      index: index + 1,
      total: this.files.length,
      bytes: file.bytes,
    });
  }
}
