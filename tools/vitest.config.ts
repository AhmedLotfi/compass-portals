import { defineConfig } from 'vitest/config';

// Tests for the build tooling (content sync, media, post-build). The app's tests run through `ng test`.
export default defineConfig({
  test: {
    include: ['tools/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
