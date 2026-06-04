import type { DetailState } from '../models/detail-state';

/**
 * The queries page title value, derived from its detail state (ADR-0053):
 * the slug while a saved query is loading or loaded, a label for the create
 * and not-found states, and empty for the bare list.
 */
export function queriesTitleValue(detail: DetailState): string {
  switch (detail.kind) {
    case 'loaded':
    case 'loading':
      return detail.slug;
    case 'create':
      return 'New query';
    case 'not-found':
      return 'Not found';
    case 'empty':
      return '';
  }
}
