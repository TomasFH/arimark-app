/**
 * Detección automática del puerto serial de la balanza KRETZ.
 *
 * Dos balanzas KRETZ del mismo modelo son indistinguibles por nombre, fabricante
 * o VID/PID del adaptador USB-serie. El único método fiable para saber en qué
 * puerto COM quedó enumerada una balanza es *hablarle el protocolo R30*: se abre
 * cada puerto, se envía el test de enlace (0002) y se conserva el que responde OK.
 *
 * Este módulo solo hace I/O de sondeo — no mantiene estado ni conexión persistente.
 * La conexión real la maneja `KretzRealDriver` una vez detectado el puerto.
 */

import { SerialPort } from 'serialport'
import log from 'electron-log'
import { encodeFrame, takeResponseFrame, parseResponse } from './r30Protocol'

const BAUD_RATE = 115200
const DEFAULT_PROBE_TIMEOUT_MS = 1_200

export interface SerialPortInfo {
  path: string
  manufacturer?: string
  serialNumber?: string
  pnpId?: string
  vendorId?: string
  productId?: string
  friendlyName?: string
}

/** Lista los puertos serie disponibles en el sistema. */
export async function listSerialPorts(): Promise<SerialPortInfo[]> {
  const ports = await SerialPort.list()
  return ports.map(p => ({
    path: p.path,
    manufacturer: p.manufacturer,
    serialNumber: p.serialNumber,
    pnpId: p.pnpId,
    vendorId: p.vendorId,
    productId: p.productId,
    // Campo específico de Windows, no siempre presente en el tipo de serialport.
    friendlyName: (p as { friendlyName?: string }).friendlyName,
  }))
}

/**
 * Abre un puerto, envía el test de enlace R30 (0002) y espera una respuesta OK.
 * Devuelve true solo si la balanza contesta con código '01'. Nunca lanza: cualquier
 * fallo (puerto ocupado, sin respuesta, trama inválida) resuelve en false.
 * El puerto se cierra siempre antes de resolver.
 */
export function probeKretzPort(
  path: string,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS
): Promise<boolean> {
  return new Promise(resolve => {
    let settled = false
    let rx: Buffer = Buffer.alloc(0)

    const port = new SerialPort({ path, baudRate: BAUD_RATE, autoOpen: false })

    const finish = (result: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        if (port.isOpen) {
          port.close(() => resolve(result))
          return
        }
      } catch {
        // Ignorar errores de cierre — igual resolvemos.
      }
      resolve(result)
    }

    const timer = setTimeout(() => finish(false), timeoutMs)

    port.on('data', (chunk: Buffer) => {
      rx = Buffer.concat([rx, chunk])
      const taken = takeResponseFrame(rx)
      if (!taken) return
      try {
        const parsed = parseResponse(taken[0])
        finish(parsed.responseCode === '01')
      } catch {
        finish(false)
      }
    })

    port.on('error', () => finish(false))

    port.open(err => {
      if (err) {
        log.debug('[kretz] Puerto no disponible para sondeo', { path, err: err.message })
        finish(false)
        return
      }
      try {
        port.write(encodeFrame('0002', ''))
      } catch {
        finish(false)
      }
    })
  })
}

/**
 * Puntaje heurístico para ordenar los candidatos a sondear primero. No decide
 * la detección (eso lo hace el sondeo R30), solo prioriza los puertos que
 * *parecen* un adaptador USB-serie para encontrar la balanza más rápido.
 */
function candidateScore(info: SerialPortInfo): number {
  const hay = `${info.manufacturer ?? ''} ${info.friendlyName ?? ''} ${info.pnpId ?? ''}`.toLowerCase()
  let score = 0
  if (/kretz|jdata|jgate|prolific|ftdi|ch340|ch341|silicon labs|cp210|usb.?serial/.test(hay)) {
    score += 10
  }
  // Los adaptadores USB suelen enumerar en COM altos; COM1/COM2 suelen ser internos.
  const num = parseInt(info.path.replace(/\D/g, ''), 10)
  if (Number.isFinite(num) && num >= 3) score += 1
  return score
}

/**
 * Recorre los puertos serie y devuelve el primero que responde al protocolo R30
 * de la balanza KRETZ. Devuelve null si ninguno responde (balanza desconectada,
 * puerto ocupado por iTegra, etc.). Sondea de a uno: nunca abre dos puertos a la vez.
 */
export async function detectKretzPort(
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS
): Promise<string | null> {
  const ports = await listSerialPorts()
  if (ports.length === 0) {
    log.info('[kretz] No hay puertos serie disponibles para detectar')
    return null
  }

  const ordered = [...ports].sort((a, b) => candidateScore(b) - candidateScore(a))
  log.info('[kretz] Detectando balanza — puertos a sondear', {
    ports: ordered.map(p => p.path),
  })

  for (const p of ordered) {
    log.debug('[kretz] Sondeando puerto', { path: p.path })
    const responds = await probeKretzPort(p.path, timeoutMs)
    if (responds) {
      log.info('[kretz] Balanza detectada', { path: p.path })
      return p.path
    }
  }

  log.info('[kretz] Ninguna balanza respondió al protocolo R30')
  return null
}
