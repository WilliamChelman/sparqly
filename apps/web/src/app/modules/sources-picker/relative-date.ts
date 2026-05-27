const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

function unit(n: number, label: string): string {
  return `${n} ${label}${n === 1 ? '' : 's'} ago`;
}

export function relativeDate(isoDate: string, now: Date): string {
  const then = new Date(isoDate).getTime();
  const seconds = Math.floor((now.getTime() - then) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < MINUTE) return unit(seconds, 'second');
  if (seconds < HOUR) return unit(Math.floor(seconds / MINUTE), 'minute');
  if (seconds < DAY) return unit(Math.floor(seconds / HOUR), 'hour');
  if (seconds < MONTH) return unit(Math.floor(seconds / DAY), 'day');
  if (seconds < YEAR) return unit(Math.floor(seconds / MONTH), 'month');
  return unit(Math.floor(seconds / YEAR), 'year');
}
