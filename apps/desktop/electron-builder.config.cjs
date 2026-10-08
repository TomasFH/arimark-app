const path = require('path')
const fs = require('fs')
const { createRequire } = require('module')

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.carniceria-app.desktop',
  productName: 'Arimark App',
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
  // Fuera del asar: business.json, catálogo maestro y env de Firebase (proceso main).
  extraResources: [
    { from: 'build-resources/icon.ico', to: 'icon.ico' },
    { from: 'config/business.json', to: 'business.json' },
    { from: 'scripts/catalog-2026-08.json', to: 'catalog-2026-08.json' },
    { from: '.env.production', to: '.env.production' },
  ],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build-resources/icon.ico',
    // false evita bajar winCodeSign: en Windows sin privilegio de symlinks
    // esa descarga falla y corta el build. El ícono del .exe lo graba
    // embedWindowsIcon en afterPack. La firma sigue omitida
    // (CSC_IDENTITY_AUTO_DISCOVERY=false).
    signAndEditExecutable: false,
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },
  // Auto-update deshabilitado hasta que se configure un servidor de distribución.
  // Cuando se active, agregar owner/repo explícitos aquí.
  publish: null,
  afterPack: async context => {
    await verifyProductionBuild(context)
    await embedWindowsIcon(context)
  },
}

/**
 * Graba el ícono y el nombre en el .exe ya empaquetado.
 * Hay que hacerlo después del hash de integridad del asar, y reescribir
 * la tabla de recursos completa para no perder ese hash.
 */
async function embedWindowsIcon(context) {
  if (context.electronPlatformName !== 'win32') return

  const requireFromBuilder = createRequire(require.resolve('electron-builder/package.json'))
  const resedit = requireFromBuilder('resedit')
  const productName = context.packager.appInfo.productName
  const exeName = `${context.packager.appInfo.productFilename}.exe`
  const exePath = path.join(context.appOutDir, exeName)
  const iconPath = path.join(__dirname, 'build-resources', 'icon.ico')

  if (!fs.existsSync(iconPath)) {
    throw new Error(`[afterPack] Falta el ícono: ${iconPath}`)
  }

  const exe = resedit.NtExecutable.from(fs.readFileSync(exePath))
  const resources = resedit.NtExecutableResource.from(exe)
  const integrityBefore = integrityPayloads(resources.entries)
  if (integrityBefore.length === 0) {
    throw new Error('[afterPack] El .exe no tiene el recurso de integridad del asar')
  }

  const iconFile = resedit.Data.IconFile.from(fs.readFileSync(iconPath))
  const icons = iconFile.icons.map(item => item.data)
  const groups = resedit.Resource.IconGroupEntry.fromEntries(resources.entries)
  if (groups.length === 0) {
    resedit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, 1, 1033, icons)
  } else {
    for (const group of groups) {
      resedit.Resource.IconGroupEntry.replaceIconsForResource(
        resources.entries,
        group.id,
        group.lang,
        icons,
      )
    }
  }

  const versionInfo = resedit.Resource.VersionInfo.fromEntries(resources.entries)[0]
  if (versionInfo) {
    const language = versionInfo.getAllLanguagesForStringValues()[0] ?? { lang: 1033, codepage: 1200 }
    versionInfo.setStringValues(language, {
      ProductName: productName,
      FileDescription: productName,
      InternalName: productName,
      OriginalFilename: exeName,
      CompanyName: 'Arimark',
    })
    versionInfo.removeStringValue(language, 'LegalCopyright')
    const [major, minor, patch] = String(context.packager.appInfo.version).split('.').map(part => Number(part) || 0)
    versionInfo.setFileVersion(major, minor, patch, 0, language.lang)
    versionInfo.setProductVersion(major, minor, patch, 0, language.lang)
    versionInfo.outputToResourceEntries(resources.entries)
  }

  const integrityAfter = integrityPayloads(resources.entries)
  if (integrityAfter.join('\n') !== integrityBefore.join('\n')) {
    throw new Error('[afterPack] Se alteró la integridad del asar al grabar el ícono')
  }

  resources.outputResource(exe)
  fs.writeFileSync(exePath, Buffer.from(exe.generate()))
  console.log(`[afterPack] Ícono y nombre aplicados en ${exePath}`)
}

function integrityPayloads(entries) {
  return entries
    .filter(entry => String(entry.type).toUpperCase() === 'INTEGRITY')
    .map(entry => Buffer.from(entry.bin).toString('utf8'))
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
