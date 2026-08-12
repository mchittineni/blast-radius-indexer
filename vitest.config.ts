import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**', 'shared/**'],
      // main.ts is a thin @actions/core adapter, verified by the bundle smoke test in CI.
      exclude: ['src/main.ts'],
      thresholds: {
        lines: 95,
        functions: 90,
        branches: 85,
        statements: 95,
      },
    },
  },
});
