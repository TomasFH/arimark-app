/**
 * Backfill de `createdAtServer` en eventos de deuda (proveedor y cliente).
 *
 * Default: DRY-RUN (solo lee y reporta). No escribe nada.
 * `--apply` escribe `createdAtServer` y actualiza tails. No usar contra
 * producción hasta revisar el reporte.
 *
 * Cómo se asigna (misma regla que `planCreatedAtServerBackfill` en shared):
 *   1. Si ya hay createdAtServer → skip
 *   2. Si `createdAt` es ISO parseable → Timestamp de ese instante (reloj de
 *      negocio, NO now)
 *   3. Si no, `date` ISO (eventos viejos de proveedor)
 *   4. Si no hay nada parseable → se deja SIN createdAtServer. Ese evento
 *      no entra al checkpoint ni a la cola en vivo.
 *
 * Uso:
 *   node scripts/backfillCreatedAtServer.mjs
 *   node scripts/backfillCreatedAtServer.mjs --license arimark-001
 *   node scripts/backfillCreatedAtServer.mjs --apply
 *
 * Requisito: `firebase login` con acceso al proyecto.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const PROJECT_ID = 'arimark-7f418'
const DEFAULT_LICENSE = 'arimark-001'
const FIREBASE_TOOLS_CONFIG_CANDIDATES = [
  path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'configstore', 'firebase-tools.json'),
]

function firebaseToolsConfigPath() {
  return FIREBASE_TOOLS_CONFIG_CANDIDATES.find(p => fs.existsSync(p)) ?? FIREBASE_TOOLS_CONFIG_CANDIDATES[0]
}

const FIREBASE_TOOLS_OAUTH = {
  client_id: '563584335869-fgrhgmd47bqnek1034g9rev76qskpop8.apps.googleusercontent.com',
  client_secret: 'jQRWCN-XfakrfbuEYXXLXJrC',
}

const COLLECTIONS = [
  { name: 'providerDebtEvents', kind: 'provider', idField: 'providerId' },
  { name: 'customerDebtEvents', kind: 'customer', idField: 'customerId' },
]

function parseArgs(argv) {
  let licenseKey = DEFAULT_LICENSE
  let apply = false
  let assignSample = 30
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
    if (arg === '--assign-sample') {
      assignSample = Number(argv[++i])
      if (!Number.isFinite(assignSample) || assignSample < 0) {
        throw new Error('--assign-sample requiere un número ≥ 0')
      }
      continue
    }
    if (arg.startsWith('-')) throw new Error(`Flag desconocido: ${arg}`)
    throw new Error(`Argumento inesperado: ${arg}`)
  }
  return { licenseKey, apply, assignSample }
}

async function getAccessToken() {
  const configPath = firebaseToolsConfigPath()
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `No se encontró firebase-tools.json. Ejecutá \`firebase login\` primero.`,
    )
  }
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'))
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
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2))
  return data.access_token
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
  return null
}

function decodeFields(fields) {
  const out = {}
  for (const [key, value] of Object.entries(fields ?? {})) {
    out[key] = decodeValue(value)
  }
  return out
}

function msToRank(ms) {
  return {
    seconds: Math.floor(ms / 1000),
    nanos: Math.floor((ms % 1000) * 1e6),
  }
}

function timestampToRank(value) {
  if (value == null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return msToRank(value)
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    if (!Number.isFinite(ms)) return null
    return msToRank(ms)
  }
  if (typeof value === 'object') {
    const rec = value
    if (typeof rec.seconds === 'number') {
      return {
        seconds: rec.seconds,
        nanos: typeof rec.nanoseconds === 'number' ? rec.nanoseconds : 0,
      }
    }
  }
  return null
}

function isoToRank(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const ms = Date.parse(trimmed)
  if (!Number.isFinite(ms)) return null
  return { iso: trimmed, rank: msToRank(ms), rfc3339: new Date(ms).toISOString() }
}

function planCreatedAtServerBackfill(data) {
  if (timestampToRank(data.createdAtServer) != null) {
    return { action: 'skip', reason: 'already-has-server-ts' }
  }
  const fromCreated = isoToRank(data.createdAt)
  if (fromCreated) {
    return { action: 'assign', source: 'createdAt', iso: fromCreated.iso, rfc3339: fromCreated.rfc3339, rank: fromCreated.rank }
  }
  const fromDate = isoToRank(data.date)
  if (fromDate) {
    return { action: 'assign', source: 'date', iso: fromDate.iso, rfc3339: fromDate.rfc3339, rank: fromDate.rank }
  }
  const raw = data.createdAt ?? data.date ?? null
  if (raw == null || raw === '') return { action: 'leave-unset', reason: 'missing', raw }
  return { action: 'leave-unset', reason: 'unparseable', raw }
}

function compareRank(a, b) {
  if (a.seconds !== b.seconds) return a.seconds - b.seconds
  return a.nanos - b.nanos
}

function rankToRfc3339(rank) {
  return new Date(rank.seconds * 1000 + Math.floor(rank.nanos / 1e6)).toISOString()
}

function docIdFromName(name) {
  const parts = name.split('/')
  return decodeURIComponent(parts[parts.length - 1] ?? name)
}

async function listDocuments(accessToken, licenseKey, collectionName) {
  const docs = []
  let pageToken = ''
  const base =
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents` +
    `/licenses/${licenseKey}/${collectionName}`

  do {
    const url = new URL(base)
    url.searchParams.set('pageSize', '300')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) {
      throw new Error(`${collectionName}: HTTP ${res.status} — ${(await res.text()).slice(0, 400)}`)
    }
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

async function patchCreatedAtServer(accessToken, docName, rfc3339) {
  const url = `https://firestore.googleapis.com/v1/${docName}?updateMask.fieldPaths=createdAtServer`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        createdAtServer: { timestampValue: rfc3339 },
      },
    }),
  })
  if (!res.ok) {
    throw new Error(`PATCH ${docName}: HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`)
  }
}

function debtCheckpointDocId(entityId, storeId) {
  const clean = s => String(s).replace(/\//g, '_')
  return `${clean(entityId)}__${clean(storeId)}`
}

async function patchTail(accessToken, licenseKey, pair) {
  const docId = debtCheckpointDocId(pair.entityId, pair.storeId)
  const docPath =
    `projects/${PROJECT_ID}/databases/(default)/documents` +
    `/licenses/${licenseKey}/debtCheckpointTails/${docId}`
  const url =
    `https://firestore.googleapis.com/v1/${docPath}` +
    `?updateMask.fieldPaths=kind` +
    `&updateMask.fieldPaths=entityId` +
    `&updateMask.fieldPaths=storeId` +
    `&updateMask.fieldPaths=firstEventAt` +
    `&updateMask.fieldPaths=lastEventAt` +
    `&updateMask.fieldPaths=updatedAt`
  const now = new Date().toISOString()
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        kind: { stringValue: pair.kind },
        entityId: { stringValue: pair.entityId },
        storeId: { stringValue: pair.storeId },
        firstEventAt: { timestampValue: rankToRfc3339(pair.first) },
        lastEventAt: { timestampValue: rankToRfc3339(pair.last) },
        updatedAt: { timestampValue: now },
      },
    }),
  })
  if (!res.ok) {
    throw new Error(`tail ${docId}: HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`)
  }
}

function notePair(map, kind, entityId, storeId, rank) {
  if (!entityId || !storeId || !rank) return
  const key = `${kind}:${entityId}::${storeId}`
  const prev = map.get(key)
  if (!prev) {
    map.set(key, { kind, entityId, storeId, first: rank, last: rank })
    return
  }
  if (compareRank(rank, prev.first) < 0) prev.first = rank
  if (compareRank(rank, prev.last) > 0) prev.last = rank
}

async function main() {
  const { licenseKey, apply, assignSample } = parseArgs(process.argv.slice(2))
  const token = await getAccessToken()

  console.log(`Proyecto: ${PROJECT_ID}`)
  console.log(`Licencia: ${licenseKey}`)
  console.log(`Modo:     ${apply ? 'APPLY (escribe createdAtServer + tails)' : 'DRY-RUN (solo lectura)'}`)
  console.log('')
  console.log('Regla de asignación:')
  console.log('  skip         → el doc ya tiene createdAtServer')
  console.log('  assign       → Timestamp copiado de createdAt ISO, o de date si createdAt falta')
  console.log('  leave-unset  → no hay ISO parseable; el evento queda fuera del checkpoint')
  console.log('')

  const summary = {
    skip: 0,
    assignCreatedAt: 0,
    assignDate: 0,
    leaveMissing: 0,
    leaveUnparseable: 0,
  }
  const leaveUnset = []
  const assignPreview = []
  const tails = new Map()
  let scanned = 0

  for (const col of COLLECTIONS) {
    const docs = await listDocuments(token, licenseKey, col.name)
    console.log(`Colección ${col.name}: ${docs.length} documentos (lecturas de listado)`)
    scanned += docs.length

    for (const doc of docs) {
      const plan = planCreatedAtServerBackfill(doc.data)
      const entityId = typeof doc.data[col.idField] === 'string' ? doc.data[col.idField] : ''
      const storeId = typeof doc.data.storeId === 'string' ? doc.data.storeId : ''

      if (plan.action === 'skip') {
        summary.skip += 1
        notePair(tails, col.kind, entityId, storeId, timestampToRank(doc.data.createdAtServer))
        continue
      }

      if (plan.action === 'assign') {
        if (plan.source === 'createdAt') summary.assignCreatedAt += 1
        else summary.assignDate += 1
        if (assignPreview.length < assignSample) {
          assignPreview.push({
            collection: col.name,
            id: doc.id,
            source: plan.source,
            from: plan.iso,
            createdAtServer: plan.rfc3339,
            entityId,
            storeId,
          })
        }
        notePair(tails, col.kind, entityId, storeId, plan.rank)
        if (apply) {
          await patchCreatedAtServer(token, doc.name, plan.rfc3339)
        }
        continue
      }

      if (plan.reason === 'missing') summary.leaveMissing += 1
      else summary.leaveUnparseable += 1
      leaveUnset.push({
        collection: col.name,
        id: doc.id,
        reason: plan.reason,
        createdAt: doc.data.createdAt ?? null,
        date: doc.data.date ?? null,
        entityId,
        storeId,
        type: doc.data.type ?? doc.data.eventType ?? null,
        amount: doc.data.amount ?? null,
      })
    }
  }

  console.log('')
  console.log('Resumen')
  console.log(`  documentos leídos:           ${scanned}`)
  console.log(`  skip (ya tenían el campo):   ${summary.skip}`)
  console.log(`  assign desde createdAt:      ${summary.assignCreatedAt}`)
  console.log(`  assign desde date:           ${summary.assignDate}`)
  console.log(`  leave-unset missing:         ${summary.leaveMissing}`)
  console.log(`  leave-unset unparseable:     ${summary.leaveUnparseable}`)
  console.log(`  tails que se armarían:       ${tails.size}`)

  if (tails.size > 0) {
    console.log('')
    console.log('Pares (entity+local) para debtCheckpointTails:')
    for (const pair of [...tails.values()].sort((a, b) => {
      const k = a.kind.localeCompare(b.kind)
      if (k !== 0) return k
      const e = a.entityId.localeCompare(b.entityId)
      return e !== 0 ? e : a.storeId.localeCompare(b.storeId)
    })) {
      console.log(
        `  ${pair.kind.padEnd(8)} ${pair.entityId}/${pair.storeId}` +
        `  first=${rankToRfc3339(pair.first)}  last=${rankToRfc3339(pair.last)}`,
      )
    }
  }

  if (assignPreview.length > 0) {
    const totalAssign = summary.assignCreatedAt + summary.assignDate
    console.log('')
    console.log(`Muestra de asignaciones (${assignPreview.length} de ${totalAssign}):`)
    for (const row of assignPreview) {
      console.log(
        `  [${row.collection}] ${row.id}  ${row.source}=${row.from}  → createdAtServer=${row.createdAtServer}` +
        `  ${row.entityId}/${row.storeId}`,
      )
    }
  }

  console.log('')
  if (leaveUnset.length === 0) {
    console.log('Ningún evento queda sin createdAtServer.')
  } else {
    console.log(`Eventos que QUEDAN SIN createdAtServer (${leaveUnset.length}):`)
    for (const row of leaveUnset) {
      console.log(
        `  [${row.collection}] ${row.id}  reason=${row.reason}` +
        `  createdAt=${JSON.stringify(row.createdAt)}  date=${JSON.stringify(row.date)}` +
        `  ${row.entityId}/${row.storeId}  type=${row.type}  amount=${row.amount}`,
      )
    }
  }

  if (apply) {
    console.log('')
    console.log(`Escribiendo ${tails.size} tails…`)
    for (const pair of tails.values()) {
      await patchTail(token, licenseKey, pair)
    }
    console.log('Apply terminado.')
  } else {
    console.log('')
    console.log('Dry-run: no se escribió nada. Para aplicar: --apply')
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
