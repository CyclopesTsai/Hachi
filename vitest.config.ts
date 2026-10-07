import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'src/shared'),
      '@renderer': resolve(import.meta.dirname, 'src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // CI machines are slower (local servers, the script sandbox); 5 s is too tight there.
    // Windows runners start processes (git, the sandbox) and touch files much more slowly.
    testTimeout: !process.env.CI ? 5_000 : process.platform === 'win32' ? 60_000 : 15_000,
    hookTimeout: !process.env.CI ? 10_000 : process.platform === 'win32' ? 60_000 : 10_000
  }
})
