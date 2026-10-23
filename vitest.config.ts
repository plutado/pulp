import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The end-to-end files each build the app into out/; running files in parallel would race on it.
    fileParallelism: false,
  },
});
