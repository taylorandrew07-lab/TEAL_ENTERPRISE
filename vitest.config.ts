import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Resolve the '@/...' path alias (mirrors tsconfig paths) so tests can import
// app/core modules the same way the application does.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
