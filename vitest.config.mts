import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the pure data layer (event de-duplication, London time,
 * venue resolution). These are the launch tripwires for the bugs the client
 * hit: duplicate fixtures, wrong kick-off times, wrong venue pins.
 *
 * Nothing here touches React Native — only modules that are safe in Node.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
