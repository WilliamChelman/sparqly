import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header
      class="flex items-center gap-6 border-b border-slate-200 bg-gradient-to-r from-white via-slate-50 to-indigo-50/40 px-6 py-3 shadow-sm"
    >
      <a
        routerLink="/"
        class="group flex items-center gap-2.5 text-slate-900 no-underline"
      >
        <img
          src="assets/icon.svg"
          alt=""
          aria-hidden="true"
          class="h-9 w-9 transition-transform duration-300 group-hover:rotate-12"
        />
        <span
          class="bg-gradient-to-br from-teal-600 via-indigo-600 to-amber-600 bg-clip-text text-xl font-bold tracking-tight text-transparent"
          >sparqly</span
        >
      </a>
      <nav class="flex gap-1 text-sm">
        <a
          routerLink="/"
          routerLinkActive="bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
          [routerLinkActiveOptions]="{ exact: true }"
          class="rounded-md px-3 py-1.5 font-medium text-slate-600 transition-colors hover:bg-white/70 hover:text-slate-900"
          >Playground</a
        >
        <a
          routerLink="/diff"
          routerLinkActive="bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
          class="rounded-md px-3 py-1.5 font-medium text-slate-600 transition-colors hover:bg-white/70 hover:text-slate-900"
          >Diff</a
        >
      </nav>
    </header>
    <router-outlet />
  `,
})
export class App {}
