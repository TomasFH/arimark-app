import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    name: 'main',
    environment: 'node',
    include: ['electron/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist', 'dist-electron'],
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['electron/**/*.ts'],
      exclude: [
        'electron/**/*.{test,spec}.ts',
        'electron/**/__tests__/**',
        'electron/**/__mocks__/**',
      ],
      thresholds: {
        lines: 80,
      },
      reporter: ['text', 'lcov'],
    },
  },
  resolve: {
    alias: {
      '@electron': path.resolve(__dirname, 'electron'),
    },
  },
})
