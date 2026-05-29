const path = require('path')
const fs = require('fs')

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.carniceria-app.desktop',
  productName: 'Carniceria App',
  directories: {
    output: 'release',
    buildResources: 'build-resources',
  },
  files: [
    'dist/**/*',
    'dist-electron/**/*',
    'drizzle/**/*',
    '!dist-electron/**/__mocks__/**',
    '!dist-electron/**/__tests__/**',
  ],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build-resources/icon.ico',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: 'build-resources/icon.ico',
    uninstallerIcon: 'build-resources/icon.ico',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },
  publish: {
    provider: 'github',
    private: true,
  },
  afterPack: async context => {
    await verifyProductionBuild(context)
  },
}

/**
 * Verifica que el build de producción no contenga artefactos de desarrollo.
 * Si encuentra alguno, falla el build inmediatamente.
 */
async function verifyProductionBuild(context) {
  const appEnv = process.env.APP_ENV

  if (appEnv !== 'production') {
    console.log('[afterPack] APP_ENV != production — skip production checks')
    return
  }

  const resourcesDir = context.appOutDir
  const violations = []

  const FORBIDDEN_PATTERNS = [
    // Tokens de Cloudflare Tunnel
    /cloudflare/i,
    /tunnel.*token/i,
    /CF_TUNNEL/i,
    // Artefactos de sandbox
    /sandbox.*mock/i,
    /APP_ENV.*sandbox/i,
    /__mocks__/,
    /kretzDriver\.mock/i,
    /fiscalDriver\.mock/i,
  ]

  const FORBIDDEN_FILES = [
    '__mocks__',
    'cloudflared',
    '.env.sandbox',
    'sandbox.sqlite',
  ]

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (FORBIDDEN_FILES.some(f => entry.name.includes(f))) {
        violations.push(`Archivo/directorio prohibido en producción: ${fullPath}`)
      }
      if (entry.isDirectory()) {
        scanDir(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        const content = fs.readFileSync(fullPath, 'utf-8')
        for (const pattern of FORBIDDEN_PATTERNS) {
          if (pattern.test(content)) {
            violations.push(`Patrón prohibido "${pattern}" en ${fullPath}`)
            break
          }
        }
      }
    }
  }

  scanDir(resourcesDir)

  if (violations.length > 0) {
    console.error('\n[afterPack] ❌ BUILD DE PRODUCCIÓN INVÁLIDO — se encontraron artefactos prohibidos:')
    violations.forEach(v => console.error(`  - ${v}`))
    throw new Error('Build de producción contiene artefactos de desarrollo. Abortando.')
  }

  console.log('[afterPack] ✅ Build de producción verificado — sin artefactos prohibidos')
}
