/**
 * Día 0 en Firestore + Auth: deja admin(s) + instalaciones.
 * Borra locales, catálogos por local, operación, cajeras y carniceros.
 *
 * Conserva:
 *   - documento licenses/{key}
 *   - installations/*
 *   - users con role == "admin"
 *   - cuentas Auth de esos admins + anónimas (instalaciones)
 *
 * Default: dry-run. `--apply` escribe.
 *
 *   node scripts/firestoreDay0Wipe.mjs
 *   node scripts/firestoreDay0Wipe.mjs --apply
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PROJECT_ID = 'arimark-7f418'
const DEFAULT_LICENSE = 'arimark-001'
const KEEP_COLLECTIONS = new Set(['installations'])
const FIREBASE_TOOLS_CONFIG_CANDIDATES = [
  path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'configstore', 'firebase-tools.json'),
]

function parseArgs(argv) {
  let licenseKey = DEFAULT_LICENSE
  let apply = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--license') {
      licenseKey = argv[++i]
      if (!licenseKey) throw new Error('--license requiere un valor')
      continue
    }
    if (arg === '--apply') {
      apply = true
      continue
    }
    if (arg.startsWith('-')) throw new Error(`Flag desconocido: ${arg}`)
    throw new Error(`Argumento inesperado: ${arg}`)
  }
  return { licenseKey, apply }
}

function firebaseToolsConfigPath() {
  return FIREBASE_TOOLS_CONFIG_CANDIDATES.find(p => fs.existsSync(p)) ?? FIREBASE_TOOLS_CONFIG_CANDIDATES[0]
}

async function getAccessToken() {
  const configPath = firebaseToolsConfigPath()
  if (!fs.existsSync(configPath)) {
    throw new Error('No se encontró firebase-tools.json. Ejecutá `firebase login` primero.')
  }
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const tokens = cfg.tokens
  if (!tokens?.refresh_token) {
    throw new Error('Firebase CLI sin tokens. Ejecutá `firebase login`.')
  }
  if (tokens.access_token && tokens.expires_at && Date.now() < tokens.expires_at - 60_000) {
    return tokens.access_token
  }
  throw new Error(
    'El token de Firebase CLI está vencido. Corré `npx firebase-tools projects:list` y reintentá.',
  )
}

function licenseParent(licenseKey) {
  return `projects/${PROJECT_ID}/databases/(default)/documents/licenses/${licenseKey}`
}

function decodeValue(value) {
  if (value == null || typeof value !== 'object') return null
  if ('stringValue' in value) return value.stringValue
  if ('timestampValue' in value) return value.timestampValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return value.doubleValue
  if ('booleanValue' in value) return value.booleanValue
  if ('nullValue' in value) return null
  if ('mapValue' in value) return decodeFields(value.mapValue.fields ?? {})
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decodeValue)
  return null
}

function decodeFields(fields) {
  const out = {}
  for (const [key, value] of Object.entries(fields ?? {})) {
    out[key] = decodeValue(value)
  }
  return out
}

function docIdFromName(name) {
  const parts = name.split('/')
  return decodeURIComponent(parts[parts.length - 1] ?? name)
}

async function listCollectionIds(token, parent) {
  const url = `https://firestore.googleapis.com/v1/${parent}:listCollectionIds`
  const ids = []
  let pageToken = ''
  do {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pageSize: 300, pageToken: pageToken || undefined }),
    })
    if (!res.ok) throw new Error(`listCollectionIds ${parent}: HTTP ${res.status} — ${(await res.text()).slice(0, 400)}`)
    const body = await res.json()
    ids.push(...(body.collectionIds ?? []))
    pageToken = body.nextPageToken ?? ''
  } while (pageToken)
  return ids
}

async function listDocuments(token, parent, collectionId) {
  const docs = []
  let pageToken = ''
  const base = `https://firestore.googleapis.com/v1/${parent}/${collectionId}`
  do {
    const url = new URL(base)
    url.searchParams.set('pageSize', '300')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`list ${collectionId}: HTTP ${res.status} — ${(await res.text()).slice(0, 400)}`)
    const body = await res.json()
    for (const doc of body.documents ?? []) {
      docs.push({
        id: docIdFromName(doc.name),
        name: doc.name,
        data: decodeFields(doc.fields),
      })
    }
    pageToken = body.nextPageToken ?? ''
  } while (pageToken)
  return docs
}

async function deleteDocument(token, name) {
  const url = `https://firestore.googleapis.com/v1/${name}`
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok && res.status !== 404) {
    throw new Error(`DELETE ${name}: HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`)
  }
}

async function deleteRecursive(token, docName, stats) {
  const cols = await listCollectionIds(token, docName)
  for (const col of cols) {
    const children = await listDocuments(token, docName, col)
    for (const child of children) {
      await deleteRecursive(token, child.name, stats)
    }
  }
  await deleteDocument(token, docName)
  stats.deleted += 1
}

async function downloadAuthUsers(token) {
  const users = []
  let nextPageToken = ''
  do {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:batchGet?maxResults=1000${nextPageToken ? `&nextPageToken=${encodeURIComponent(nextPageToken)}` : ''}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      throw new Error(`auth batchGet: HTTP ${res.status} — ${(await res.text()).slice(0, 400)}`)
    }
    const body = await res.json()
    users.push(...(body.users ?? []))
    nextPageToken = body.nextPageToken ?? ''
  } while (nextPageToken)
  return users
}

async function deleteAuthUsers(token, localIds) {
  for (let i = 0; i < localIds.length; i += 100) {
    const chunk = localIds.slice(i, i + 100)
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:batchDelete`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ localIds: chunk, force: true }),
    })
    if (!res.ok) {
      throw new Error(`auth batchDelete: HTTP ${res.status} — ${(await res.text()).slice(0, 400)}`)
    }
  }
}

async function main() {
  const { licenseKey, apply } = parseArgs(process.argv.slice(2))
  const token = await getAccessToken()
  const parent = licenseParent(licenseKey)
  const stats = { deleted: 0, keptUsers: [], deleteUsers: [], skipAuth: [] }

  console.log(`Proyecto: ${PROJECT_ID}`)
  console.log(`Licencia: ${licenseKey}`)
  console.log(`Modo:     ${apply ? 'APPLY' : 'DRY-RUN'}`)
  console.log('')

  const rootCols = await listCollectionIds(token, parent)
  console.log('Colecciones:', rootCols.join(', ') || '(ninguna)')

  const userDocs = await listDocuments(token, parent, 'users')
  const adminUids = new Set(
    userDocs.filter(u => u.data.role === 'admin').map(u => u.id),
  )
  console.log('\nAdmins a conservar:')
  for (const u of userDocs.filter(d => adminUids.has(d.id))) {
    console.log(`  - ${u.id}  ${u.data.email ?? u.data.displayName ?? ''}  role=${u.data.role}`)
    stats.keptUsers.push(u)
  }
  if (adminUids.size === 0) {
    throw new Error('No hay ningún user con role=admin. Abortando para no dejar el tenant sin admin.')
  }

  for (const col of rootCols) {
    if (KEEP_COLLECTIONS.has(col)) {
      console.log(`\nKEEP ${col}`)
      continue
    }
    const docs = await listDocuments(token, parent, col)
    if (col === 'users') {
      const drop = docs.filter(d => !adminUids.has(d.id))
      console.log(`\nusers: borrar ${drop.length}, conservar ${docs.length - drop.length}`)
      for (const d of drop) {
        console.log(`  DEL user ${d.id}  role=${d.data.role ?? '?'}  ${d.data.email ?? d.data.displayName ?? ''}`)
        if (apply) await deleteRecursive(token, d.name, stats)
      }
      continue
    }
    console.log(`\n${col}: ${docs.length} docs`)
    for (const d of docs) {
      if (apply) await deleteRecursive(token, d.name, stats)
    }
    if (!apply) stats.deleted += docs.length
  }

  console.log('\nAuth…')
  let authUsers = []
  try {
    authUsers = await downloadAuthUsers(token)
  } catch (err) {
    console.warn('No se pudo listar Auth (el token CLI a veces no alcanza). Cajeras hay que borrarlas a mano en la consola.')
    console.warn(String(err))
  }

  for (const u of authUsers) {
    const uid = u.localId
    const email = u.email ?? ''
    const providers = (u.providerUserInfo ?? []).map(p => p.providerId)
    const isAnonymous = !email && (providers.length === 0 || providers.includes('anonymous'))
    if (adminUids.has(uid)) {
      stats.skipAuth.push(`${uid} admin ${email}`)
      continue
    }
    if (isAnonymous) {
      stats.skipAuth.push(`${uid} anonymous (instalación)`)
      continue
    }
    stats.deleteUsers.push({ uid, email, providers })
  }

  console.log('Auth a conservar:')
  for (const line of stats.skipAuth) console.log(`  KEEP ${line}`)
  console.log('Auth a borrar:')
  for (const u of stats.deleteUsers) console.log(`  DEL  ${u.uid}  ${u.email}  [${u.providers.join(',')}]`)

  if (apply && stats.deleteUsers.length > 0) {
    await deleteAuthUsers(token, stats.deleteUsers.map(u => u.uid))
  }

  console.log('')
  console.log(apply
    ? `✓ Apply listo. Firestore docs borrados (recursivo): ${stats.deleted}. Auth borrados: ${stats.deleteUsers.length}.`
    : `Dry-run. Volvé a correr con --apply para borrar. (Estimado raíz ${stats.deleted} docs; el recuento recursivo es mayor en apply.)`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
