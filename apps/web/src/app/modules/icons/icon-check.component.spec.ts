import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { IconCheckComponent } from './icon-check.component';

@Component({
  standalone: true,
  imports: [IconCheckComponent],
  template: `<app-icon-check />`,
})
class Host {}

describe('IconCheckComponent', () => {
  it('renders an inline SVG sized 1em with currentColor fill', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const svg = (fixture.nativeElement as HTMLElement).querySelector('svg')!;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('width')).toBe('1em');
    expect(svg.getAttribute('height')).toBe('1em');
    expect(svg.getAttribute('fill')).toBe('currentColor');
  });

  it('marks itself aria-hidden so it does not pollute the accessibility tree', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const svg = (fixture.nativeElement as HTMLElement).querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });
});
