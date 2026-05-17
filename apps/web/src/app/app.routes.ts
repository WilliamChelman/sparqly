import { Route } from '@angular/router';
import { QueryPage } from '@app/pages/query';
import { DiffPage } from '@app/pages/diff';
import { DescribePage } from '@app/pages/describe';
import { QueriesPage } from '@app/pages/queries';

export const appRoutes: Route[] = [
  { path: '', component: QueryPage, pathMatch: 'full' },
  { path: 'diff', component: DiffPage },
  { path: 'describe', component: DescribePage },
  { path: 'queries', component: QueriesPage },
  { path: 'queries/:slug', component: QueriesPage },
];
