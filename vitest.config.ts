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
        // Entry points y scripts CLI — no son reglas de negocio
        'electron/main.ts',
        'electron/preload.ts',
        'electron/envMode.ts',
        'electron/db/migrate-cli.ts',
        'electron/db/seed-sandbox.ts',
        'electron/ipc/index.ts',
        'electron/licensing/firebase.ts',
        'electron/licensing/installation.ts',
        'electron/hardware/kretz/kretzDriver.interface.ts',
      ],
      thresholds: {
        lines: 80,
        'electron/ipc/**': { lines: 80 },
        'electron/db/**': { lines: 80 },
        'electron/hardware/**': { lines: 80 },
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
