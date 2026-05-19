import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { IconSwapHorizontalComponent } from './icon-swap-horizontal.component';

@Component({
  standalone: true,
  imports: [IconSwapHorizontalComponent],
  template: `<app-icon-swap-horizontal />`,
})
class Host {}

describe('IconSwapHorizontalComponent', () => {
  it('renders an inline SVG sized 1em that strokes with currentColor', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const svg = (fixture.nativeElement as HTMLElement).querySelector('svg')!;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('width')).toBe('1em');
    expect(svg.getAttribute('height')).toBe('1em');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
  });

  it('marks itself aria-hidden so it does not pollute the accessibility tree', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const svg = (fixture.nativeElement as HTMLElement).querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });
});
