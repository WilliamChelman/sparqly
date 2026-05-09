import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-state-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      class="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-12 text-center"
    >
      <div class="h-32 w-full max-w-xs">
        <ng-content select="[illustration]" />
      </div>
      <h2 class="font-serif text-2xl italic text-foreground">
        <ng-content select="[title]" />
      </h2>
      <p class="text-sm text-foreground-muted">
        <ng-content select="[copy]" />
      </p>
    </article>
  `,
})
export class StateCard {}
