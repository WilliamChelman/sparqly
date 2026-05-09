import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ThemeToggle } from './theme-toggle';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ThemeToggle],
  template: `
    <header
      class="flex items-center gap-6 border-b border-border-muted bg-surface/80 px-6 py-3 backdrop-blur"
    >
      <a
        routerLink="/"
        class="group flex items-baseline gap-1.5 text-foreground no-underline"
      >
        <span class="font-serif text-xl italic tracking-tight"
          >sparqly</span
        >
        <span class="text-accent transition-transform group-hover:rotate-12"
          >✦</span
        >
      </a>
      <nav class="flex gap-1 text-xs uppercase tracking-[0.14em]">
        <a
          routerLink="/"
          routerLinkActive="bg-bg text-foreground shadow-sm"
          [routerLinkActiveOptions]="{ exact: true }"
          class="rounded-full px-3 py-1.5 text-foreground-faint transition-colors hover:text-foreground"
          >Playground</a
        >
        <a
          routerLink="/diff"
          routerLinkActive="bg-bg text-foreground shadow-sm"
          class="rounded-full px-3 py-1.5 text-foreground-faint transition-colors hover:text-foreground"
          >Diff</a
        >
      </nav>
      <div class="ml-auto">
        <app-theme-toggle />
      </div>
    </header>
    <router-outlet />
  `,
})
export class App {}
