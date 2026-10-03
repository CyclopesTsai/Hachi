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
    testTimeout: process.env.CI ? 15_000 : 5_000
  }
})
