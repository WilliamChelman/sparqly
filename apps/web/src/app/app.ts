import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { HeaderDrift } from './header-drift';
import { Logomark } from './logomark';
import { ThemeToggle } from './theme-toggle';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    HeaderDrift,
    Logomark,
    ThemeToggle,
  ],
  template: `
    <header
      class="relative flex items-center gap-6 overflow-hidden border-b border-border-muted bg-surface/80 px-6 py-3 backdrop-blur"
    >
      <div
        class="pointer-events-none absolute inset-0 opacity-55 dark:opacity-85"
      >
        <app-header-drift />
      </div>
      <a
        routerLink="/"
        class="group relative z-[1] flex items-center gap-3 text-foreground no-underline"
      >
        <app-logomark class="h-7 w-7" />
        <span
          class="font-serif text-2xl italic leading-none tracking-tight"
          style="font-variation-settings: 'opsz' 36, 'SOFT' 100"
          >sparqly<span
            class="ml-1 align-[0.85em] font-sans not-italic text-[0.32em] text-accent"
            >✦</span
          ></span
        >
      </a>
      <nav class="relative z-[1] flex gap-1 text-xs uppercase tracking-[0.14em]">
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
      <div class="relative z-[1] ml-auto">
        <app-theme-toggle />
      </div>
    </header>
    <router-outlet />
  `,
})
export class App {}
