import { readFile, writeFile } from 'node:fs/promises';

const version = process.argv[2];
if (!version) {
  console.error('Usage: sync-cli-version.mjs <version>');
  process.exit(1);
}

const path = 'apps/cli/package.json';
const pkg = JSON.parse(await readFile(path, 'utf8'));
pkg.version = version;
await writeFile(path, JSON.stringify(pkg, null, 2) + '\n');
console.log(`Set ${path} version to ${version}`);
