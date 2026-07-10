import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ['__tests__/*.{test,spec}.{js,mjs,cjs,ts}'],
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: '../../coverage',
      include: ['src/**/*.mjs'],
      thresholds: {
        lines: 61,
        functions: 69,
        statements: 58,
        branches: 53,
      },
    },
  },
});
