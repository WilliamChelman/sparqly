import { Route } from '@angular/router';
import { QueryPage } from '@app/pages/query';
import { DiffPage } from '@app/pages/diff';
import { DescribePage } from '@app/pages/describe';

export const appRoutes: Route[] = [
  { path: '', component: QueryPage, pathMatch: 'full' },
  { path: 'diff', component: DiffPage },
  { path: 'describe', component: DescribePage },
];
