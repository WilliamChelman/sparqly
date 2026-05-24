import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { IconDisclosureComponent } from './icon-disclosure.component';

@Component({
  standalone: true,
  imports: [IconDisclosureComponent],
  template: `<app-icon-disclosure [expanded]="expanded()" />`,
})
class Host {
  readonly expanded = signal(false);
}

describe('IconDisclosureComponent', () => {
  it('renders a 1em inline SVG marked aria-hidden', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const svg = (fixture.nativeElement as HTMLElement).querySelector('svg')!;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('width')).toBe('1em');
    expect(svg.getAttribute('height')).toBe('1em');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });

  it('does not apply the rotate-90 class when collapsed', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const svg = (fixture.nativeElement as HTMLElement).querySelector('svg')!;
    expect(svg.classList.contains('rotate-90')).toBe(false);
  });

  it('applies the rotate-90 class when expanded', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.expanded.set(true);
    fixture.detectChanges();
    const svg = (fixture.nativeElement as HTMLElement).querySelector('svg')!;
    expect(svg.classList.contains('rotate-90')).toBe(true);
  });
});
