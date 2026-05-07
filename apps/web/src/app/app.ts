import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="flex items-center gap-4 border-b border-slate-200 bg-white px-4 py-3">
      <h1 class="text-lg font-semibold text-slate-900">sparqly</h1>
      <nav class="flex gap-3 text-sm">
        <a
          routerLink="/"
          routerLinkActive="font-semibold text-slate-900"
          [routerLinkActiveOptions]="{ exact: true }"
          class="text-slate-600 hover:text-slate-900"
          >Playground</a
        >
        <a
          routerLink="/diff"
          routerLinkActive="font-semibold text-slate-900"
          class="text-slate-600 hover:text-slate-900"
          >Diff</a
        >
      </nav>
    </header>
    <router-outlet />
  `,
})
export class App {}
