import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { StateCard } from './state-card';

@Component({
  standalone: true,
  imports: [StateCard],
  template: `
    <app-state-card data-testid="card">
      <div data-testid="slot-illustration" illustration>ILLO</div>
      <div title>The title</div>
      <div copy>The copy</div>
    </app-state-card>
  `,
})
class Host {}

describe('StateCard', () => {
  it('renders an article wrapper with slotted illustration / title / copy', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const card = el.querySelector('[data-testid="card"]');
    expect(card).toBeTruthy();
    expect(card?.querySelector('[data-testid="slot-illustration"]')?.textContent).toBe('ILLO');
    expect(card?.textContent).toContain('The title');
    expect(card?.textContent).toContain('The copy');
  });
});
