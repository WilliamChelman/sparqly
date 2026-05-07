import { Route } from '@angular/router';
import { QueryPage } from './query-page';
import { DiffPage } from './diff-page';

export const appRoutes: Route[] = [
  { path: '', component: QueryPage, pathMatch: 'full' },
  { path: 'diff', component: DiffPage },
];
