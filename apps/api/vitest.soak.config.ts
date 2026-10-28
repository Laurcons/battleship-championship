import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.soak.test.ts'],
    globalSetup: ['test/helpers/globalSetup.ts'],
    testTimeout: 600_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    execArgv: ['--expose-gc'],
  },
});
