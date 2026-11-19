// pnpm test:rules necesita Java 21 (firebase-tools 15). Java 17 no alcanza.
// PowerShell: $env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-21.0.13.102-hotspot"
//             $env:Path = "$env:JAVA_HOME\bin;" + $env:Path
// No publica reglas: el emulador es local (--project demo-carniceria).
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['firebase/**/*.rules.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
