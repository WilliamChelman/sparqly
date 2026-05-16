import { join } from 'node:path';

export interface PlanInitInput {
  readonly cwd: string;
  readonly force: boolean;
  readonly cwdConfigPath: string | null;
  readonly ancestorConfigPath: string | null;
}

export type PlanInitResult =
  | {
      readonly action: 'write';
      readonly destination: string;
      readonly warnAncestor: string | null;
    }
  | { readonly action: 'refuse'; readonly existingPath: string };

export function planInit(input: PlanInitInput): PlanInitResult {
  if (input.cwdConfigPath !== null && !input.force) {
    return { action: 'refuse', existingPath: input.cwdConfigPath };
  }
  return {
    action: 'write',
    destination: join(input.cwd, 'sparqly.config.yaml'),
    warnAncestor: input.ancestorConfigPath,
  };
}
