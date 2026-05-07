import { Route } from '@angular/router';
import { YasguiPage } from './yasgui-page';
import { DiffPage } from './diff-page';

export const appRoutes: Route[] = [
  { path: '', component: YasguiPage, pathMatch: 'full' },
  { path: 'diff', component: DiffPage },
];
