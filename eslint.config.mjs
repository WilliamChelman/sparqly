import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc', '**/vitest.config.*.timestamp*'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      'max-lines': [
        'error',
        { max: 500, skipBlankLines: true, skipComments: false },
      ],
    },
  },
  {
    files: [
      '**/*.spec.ts',
      '**/*.golden.spec.ts',
      '**/test/**',
      '**/__fixtures__/**',
      '**/dist/**',
    ],
    rules: {
      'max-lines': 'off',
    },
  },
  // Grandfathered offenders for the max-lines rule. Each entry is the
  // migration backlog for issue #253 — sweep PRs delete entries from this list.
  // Patterns use trailing-segment matching so they resolve correctly whether
  // ESLint runs from the repo root or from an Nx project root.
  {
    files: [
      '**/app/commands/diff.ts',
      '**/lib/diff/group-rdf-diff-by-entity.ts',
      '**/lib/bootstrap/create-server.ts',
      '**/lib/formatter.ts',
      '**/lib/sources/source-spec.ts',
    ],
    rules: {
      'max-lines': 'off',
    },
  },
];
