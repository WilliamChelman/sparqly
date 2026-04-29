import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/cli-e2e',
  test: {
    name: 'cli-e2e',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.{e2e,spec}.ts'],
    reporters: ['default'],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
  },
});
