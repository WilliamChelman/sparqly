import { Route } from '@angular/router';
import { QueryPage } from '@app/pages/query';
import { DiffPage } from '@app/pages/diff';
import { DescribePage } from '@app/pages/describe';
import { QueriesPage } from '@app/pages/queries';
import { SourcesPage } from '@app/pages/sources';

export const appRoutes: Route[] = [
  { path: '', component: QueryPage, pathMatch: 'full' },
  { path: 'diff', component: DiffPage },
  { path: 'describe', component: DescribePage },
  { path: 'queries', component: QueriesPage },
  { path: 'queries/new', component: QueriesPage, data: { mode: 'create' } },
  { path: 'queries/:slug', component: QueriesPage },
  { path: 'sources', component: SourcesPage },
];
