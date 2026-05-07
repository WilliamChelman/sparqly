const ESC = '\x1b';
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const TEAL = `${ESC}[38;5;43m`;
const INDIGO = `${ESC}[38;5;99m`;
const AMBER = `${ESC}[38;5;214m`;
const SPARKLE = `${ESC}[38;5;226m`;
const TITLE = `${ESC}[38;5;81m`;

export interface SplashOptions {
  quiet?: boolean;
}

function colorEnabled(): boolean {
  if (process.env['NO_COLOR']) return false;
  if (process.env['FORCE_COLOR']) return true;
  return Boolean((process.stderr as { isTTY?: boolean }).isTTY);
}

export function printServeSplash(options: SplashOptions = {}): void {
  if (options.quiet) return;
  const color = colorEnabled();
  const paint = (code: string, text: string): string =>
    color ? `${code}${text}${RESET}` : text;

  const apex = paint(TEAL, '●');
  const bl = paint(INDIGO, '●');
  const br = paint(AMBER, '●');
  const stroke = (s: string): string => paint(INDIGO, s);
  const star = paint(SPARKLE, '✦');
  const title = paint(`${BOLD}${TITLE}`, 'Sparqly');
  const tagline = paint(
    DIM,
    'declarative SPARQL: query, hash, diff, format, serve',
  );

  const lines = [
    '',
    `     ${star}`,
    `     ${apex}        ${title}`,
    `    ${stroke('╱')} ${stroke('╲')}       ${tagline}`,
    `   ${bl}${stroke('───')}${br}  ${star}`,
    '',
  ];
  for (const line of lines) process.stderr.write(`${line}\n`);
}
