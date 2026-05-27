import { describe, expect, it } from 'vitest';
import { relativeDate } from './relative-date';

const NOW = new Date('2026-05-27T12:00:00Z');

function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

describe('relativeDate', () => {
  it('renders seconds for under a minute', () => {
    expect(relativeDate(ago(30 * 1000), NOW)).toBe('30 seconds ago');
  });

  it('renders "just now" for very recent timestamps', () => {
    expect(relativeDate(ago(500), NOW)).toBe('just now');
  });

  it('renders minutes', () => {
    expect(relativeDate(ago(5 * 60 * 1000), NOW)).toBe('5 minutes ago');
  });

  it('renders hours', () => {
    expect(relativeDate(ago(3 * 60 * 60 * 1000), NOW)).toBe('3 hours ago');
  });

  it('renders days', () => {
    expect(relativeDate(ago(2 * 24 * 60 * 60 * 1000), NOW)).toBe('2 days ago');
  });

  it('renders months for roughly 30-day spans', () => {
    expect(relativeDate(ago(60 * 24 * 60 * 60 * 1000), NOW)).toBe(
      '2 months ago',
    );
  });

  it('renders years for spans of 365+ days', () => {
    expect(relativeDate(ago(2 * 365 * 24 * 60 * 60 * 1000), NOW)).toBe(
      '2 years ago',
    );
  });

  it('renders singular forms', () => {
    expect(relativeDate(ago(60 * 1000), NOW)).toBe('1 minute ago');
    expect(relativeDate(ago(60 * 60 * 1000), NOW)).toBe('1 hour ago');
    expect(relativeDate(ago(24 * 60 * 60 * 1000), NOW)).toBe('1 day ago');
  });
});
