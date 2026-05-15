export type RefKind =
  | 'head'
  | 'branch'
  | 'remote-branch'
  | 'remote-head'
  | 'tag-annotated'
  | 'tag-lightweight';

export interface RefEntry {
  ref: string;
  sha: string;
  kind: RefKind;
  remote?: string;
}

export interface RefsResponse {
  head: RefEntry;
  branches: RefEntry[];
  remoteBranches: RefEntry[];
  tags: RefEntry[];
}
