/**
 * Soft-delete de eventos de deuda en Firestore (deleted:true + deletedAt).
 *
 * Usa el token de la Firebase CLI (`firebase login`) — no requiere service account
 * ni contraseña de admin. No versiona secretos.
 *
 * Uso:
 *   node scripts/softDeleteDebtEvents.mjs <eventId> [eventId...]
 *   node scripts/softDeleteDebtEvents.mjs --license arimark-001 <eventId>
 *
 * Requisito: `firebase login` activo con acceso al proyecto.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const PROJECT_ID = 'arimark-7f418'
const DEFAULT_LICENSE = 'arimark-001'
const FIREBASE_TOOLS_CONFIG = path.join(
  os.homedir(),
  '.config',
  'configstore',
  'firebase-tools.json',
)

/** Client ID/secret públicos de firebase-tools (mismo que usa la CLI). */
const FIREBASE_TOOLS_OAUTH = {
  client_id: '563584335869-fgrhgmd47bqnek1034g9rev76qskpop8.apps.googleusercontent.com',
  client_secret: 'jQRWCN-XfakrfbuEYXXLXJrC',
}

function parseArgs(argv) {
  let licenseKey = DEFAULT_LICENSE
  const eventIds = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--license') {
      licenseKey = argv[++i]
      if (!licenseKey) throw new Error('--license requiere un valor')
      continue
    }
    if (arg.startsWith('-')) throw new Error(`Flag desconocido: ${arg}`)
    eventIds.push(arg)
  }
  return { licenseKey, eventIds }
}

async function getAccessToken() {
  if (!fs.existsSync(FIREBASE_TOOLS_CONFIG)) {
    throw new Error(
      `No se encontró ${FIREBASE_TOOLS_CONFIG}. Ejecutá \`firebase login\` primero.`,
    )
  }
  const cfg = JSON.parse(fs.readFileSync(FIREBASE_TOOLS_CONFIG, 'utf8'))
  const tokens = cfg.tokens
  if (!tokens?.refresh_token) {
    throw new Error('Firebase CLI sin tokens. Ejecutá `firebase login`.')
  }

  if (tokens.access_token && tokens.expires_at && Date.now() < tokens.expires_at - 60_000) {
    return tokens.access_token
  }

  const body = new URLSearchParams({
    ...FIREBASE_TOOLS_OAUTH,
    refresh_token: tokens.refresh_token,
    grant_type: 'refresh_token',
  })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    throw new Error(`No se pudo refrescar el token OAuth: ${await res.text()}`)
  }
  const data = await res.json()
  cfg.tokens.access_token = data.access_token
  cfg.tokens.expires_at = Date.now() + data.expires_in * 1000
  fs.writeFileSync(FIREBASE_TOOLS_CONFIG, JSON.stringify(cfg, null, 2))
  return data.access_token
}

async function softDeleteEvent(accessToken, licenseKey, eventId) {
  const docPath =
    `projects/${PROJECT_ID}/databases/(default)/documents` +
    `/licenses/${licenseKey}/providerDebtEvents/${eventId}`
  const now = new Date().toISOString()
  const url =
    `https://firestore.googleapis.com/v1/${docPath}` +
    `?updateMask.fieldPaths=deleted&updateMask.fieldPaths=deletedAt`

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        deleted: { booleanValue: true },
        deletedAt: { stringValue: now },
      },
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${eventId}: HTTP ${res.status} — ${text.slice(0, 300)}`)
  }
  return now
}

async function main() {
  const { licenseKey, eventIds } = parseArgs(process.argv.slice(2))
  if (eventIds.length === 0) {
    console.error(
      'Uso: node scripts/softDeleteDebtEvents.mjs [--license KEY] <eventId> [eventId...]',
    )
    process.exit(1)
  }

  const token = await getAccessToken()
  for (const id of eventIds) {
    const deletedAt = await softDeleteEvent(token, licenseKey, id)
    console.log(`OK  ${id}  deleted:true  deletedAt=${deletedAt}`)
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
