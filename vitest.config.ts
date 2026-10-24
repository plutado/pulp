import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The end-to-end files each build the app into out/; running files in parallel would race on it.
    fileParallelism: false,
    // On CI, name every test as it starts, so a stalled job says where it is (tests/ci-reporter.ts).
    reporters: process.env.CI ? ['./tests/ci-reporter.ts'] : ['default'],
    // A worker that will not close (a child process holding its pipes) is given this long, then dropped.
    teardownTimeout: 30_000,
  },
});
