import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@carniceria/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
})
