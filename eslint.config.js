import js from '@eslint/js';

export default [
  {
    ignores: [
      'node_modules/',
      'dist/',
      'coverage/',
      '*.tgz',
      '*.log',
      '.DS_Store',
      '*.min.js',
      'bun.lock',
      'bun.lockb',
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      '.git/',
      '.env',
      '.env.*',
    ],
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...js.configs.recommended.globals,
        console: 'readonly',
      },
    },
    plugins: {},
    rules: {
      // Let Prettier handle formatting
      indent: 'off',
      'no-console': ['warn', { allow: ['log', 'warn', 'error', 'info', 'debug'] }],
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      semi: ['error', 'always'],
      quotes: ['error', 'single', { avoidEscape: true }],
      'no-mixed-spaces-and-tabs': 'error',
      'no-extra-semi': 'error',
      'no-unexpected-multiline': 'error',
    },
  },
];
