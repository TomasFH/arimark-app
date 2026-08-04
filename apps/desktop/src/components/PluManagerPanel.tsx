/**
 * Panel de gestión de PLUs — disponible solo para admins y en fieldtest/sandbox.
 *
 * Permite crear y actualizar productos (PLUs) en la balanza KRETZ sin tocar
 * el equipo ni usar iTegra. La balanza debe estar conectada por USB.
 */

import { useState } from 'react'
import NumericInput from './NumericInput'
import { parseNumericInput } from '../lib/numericInput'
import type { SendPluPayload, PluRow } from '../types/hw-api'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * REPORT NX/iTegra guardan precio PLU en 6 dígitos con 1 decimal implícito.
 * Ej: "210000" = $21.000,0. El formulario trabaja con pesos enteros.
 */
function rawScalePriceToPesos(rawPrice: string): string {
  const raw = parseInt(rawPrice, 10)
  if (isNaN(raw)) return ''
  return String(Math.floor(raw / 10))
}

function formatPesoPreview(pesosStr: string): string {
  const n = parseNumericInput(pesosStr)
  if (n === null) return ''
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n)
}

// ---------------------------------------------------------------------------
// Sub-componentes
// ---------------------------------------------------------------------------

function StatusBadge({ linked }: { linked: boolean | null }) {
  if (linked === null) return null
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
        linked ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${linked ? 'bg-green-400' : 'bg-red-400'}`} />
      {linked ? 'Balanza conectada' : 'Balanza sin respuesta'}
    </span>
  )
}

function PluResultCard({ plu }: { plu: PluRow }) {
  const pesosStr = rawScalePriceToPesos(plu.price)
  const pesosNum = parseInt(pesosStr, 10)
  const formattedPrice = !isNaN(pesosNum)
    ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(pesosNum)
    : '—'

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800/60 p-3 text-xs space-y-1">
      <div className="flex justify-between">
        <span className="text-zinc-400">PLU</span>
        <span className="font-mono text-white">{parseInt(plu.number, 10)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-zinc-400">Nombre</span>
        <span className="text-white">{plu.name || '—'}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-zinc-400">Código artículo</span>
        <span className="font-mono text-white">{plu.code || '—'}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-zinc-400">Precio</span>
        <span className="font-semibold text-zinc-200">{formattedPrice}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-zinc-400 text-[10px]">Precio raw (diagnóstico)</span>
        <span className="font-mono text-[10px] text-zinc-500">{plu.price}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-zinc-400">Tipo</span>
        <span className={plu.type === 'pesable' ? 'text-zinc-300' : 'text-zinc-300'}>
          {plu.type === 'pesable' ? 'Pesable (P)' : 'Normal (N)'}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Panel principal
// ---------------------------------------------------------------------------

export default function PluManagerPanel() {
  // --- Conexión ---
  const [linked, setLinked] = useState<boolean | null>(null)
  const [testingLink, setTestingLink] = useState(false)

  // --- Formulario de PLU ---
  const [pluNumber, setPluNumber] = useState('')
  const [pluName, setPluName] = useState('')
  const [pluCode, setPluCode] = useState('')
  const [pluPrice, setPluPrice] = useState('')
  const [pesable, setPesable] = useState(true)
  // La balanza comprobada con iTegra usa payload de 135 bytes:
  // campo precio de 6 dígitos con 1 decimal implícito ($21.000 -> "210000").
  const [priceDigits, setPriceDigits] = useState<6 | 7>(6)

  // Precio máximo según dígitos configurados
  const maxPriceForDigits = (digits: 6 | 7) => digits === 6 ? 99999 : 999999

  // --- Búsqueda ---
  const [searchNumber, setSearchNumber] = useState('')
  const [searchResult, setSearchResult] = useState<PluRow | null | 'not_found'>('not_found' as const)
  const [searching, setSearching] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteCandidate, setDeleteCandidate] = useState<PluRow | null>(null)

  // --- Estado de operación ---
  const [sending, setSending] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'error'; message: string } | null>(null)
  const [pluCount, setPluCount] = useState<number | null>(null)

  function showFeedback(type: 'ok' | 'error', message: string) {
    setFeedback({ type, message })
    setTimeout(() => setFeedback(null), 5000)
  }

  // --- Handlers ---
  async function handleTestLink() {
    setTestingLink(true)
    setLinked(null)
    setFeedback(null)
    try {
      const r = await window.hw.kretzTestLink()
      if (!r.ok) {
        setLinked(false)
        showFeedback('error', r.error ?? 'Error al verificar enlace con la balanza.')
        return
      }
      setLinked(r.data.linked)
      if (r.data.linked) {
        const countR = await window.hw.kretzReadPluCount()
        if (countR.ok) setPluCount(countR.data.count)
        showFeedback('ok', 'Protocolo R30 OK — la balanza respondió al comando de enlace.')
      } else {
        showFeedback(
          'error',
          'El puerto COM8 está abierto (pestaña Hardware), pero la balanza no respondió OK al protocolo R30. ' +
            'Cerrá iTegra, la mini app u otro programa que use COM8 e intentá de nuevo.'
        )
      }
    } catch {
      setLinked(false)
      showFeedback('error', 'Error de comunicación con la balanza.')
    } finally {
      setTestingLink(false)
    }
  }

  async function handleSendPlu() {
    if (!pluNumber.trim()) {
      showFeedback('error', 'Ingresá un número de PLU.')
      return
    }
    if (!pluName.trim()) {
      showFeedback('error', 'El nombre del producto es obligatorio.')
      return
    }
    const precioEnPesos = parseNumericInput(pluPrice)
    if (precioEnPesos === null || precioEnPesos <= 0) {
      showFeedback('error', 'Ingresá un precio válido (en pesos, sin centavos).')
      return
    }
    const maxPesos = maxPriceForDigits(priceDigits)
    if (precioEnPesos > maxPesos) {
      showFeedback(
        'error',
        `El precio máximo para ${priceDigits} dígitos es $${maxPesos.toLocaleString('es-AR')}. ` +
          (priceDigits === 6
            ? 'Cambiá a "7 dígitos (≥ $10.000)" en el selector de rango de precio.'
            : 'El precio supera $99.999 que es el límite absoluto de la balanza.')
      )
      return
    }
    // iTegra almacena el precio con 1 decimal implícito.
    // El usuario ingresa pesos enteros -> se multiplica x10 para la representación raw.
    const priceCents = precioEnPesos * 10

    const normalizedPluNumber = pluNumber.trim()
    const articleCodeSource = pluCode.trim() || normalizedPluNumber

    setSending(true)
    setFeedback(null)
    const payloadByteCount = priceDigits === 7 ? 138 : 135

    try {
      const payload: SendPluPayload = {
        pluNumber: normalizedPluNumber,
        name: pluName.trim().slice(0, 26),
        description: pluName.trim().slice(0, 26),
        articleCode: articleCodeSource.padStart(5, '0').slice(-5),
        pesable,
        priceCents,
        priceDigits,
        department: '001',
        family: '000',
      }
      const r = await window.hw.kretzSendPlu(payload)
      if (r.ok) {
        showFeedback('ok', `PLU ${r.data.pluNumber} guardado en la balanza (payload ${payloadByteCount} bytes, ${priceDigits} dígitos).`)
        // Actualizar conteo
        const countR = await window.hw.kretzReadPluCount()
        if (countR.ok) setPluCount(countR.data.count)
      } else {
        const isLengthError = r.error?.includes('longitud')
        showFeedback(
          'error',
          isLengthError
            ? `Error de longitud (payload ${payloadByteCount} bytes, ${priceDigits} dígitos). ` +
              (priceDigits === 7
                ? 'La balanza rechazó el payload de 138 bytes. Usá "iTegra compatible" (135 bytes).'
                : 'La balanza rechazó el payload iTegra-compatible de 135 bytes. Revisá la terminal para diagnóstico.')
            : (r.error ?? 'Error al enviar PLU.')
        )
      }
    } catch {
      showFeedback('error', 'Error de comunicación con la balanza.')
    } finally {
      setSending(false)
    }
  }

  async function handleSearch() {
    if (!searchNumber.trim()) return
    setSearching(true)
    setSearchResult('not_found')
    try {
      const r = await window.hw.kretzReadPlu({ pluNumber: searchNumber.trim(), priceDigits })
      if (r.ok) {
        setSearchResult(r.data)
        // Pre-cargar en el formulario para editar fácilmente
        if (r.data) {
          setPluNumber(String(parseInt(r.data.number, 10)))
          setPluName(r.data.name)
          setPluCode(r.data.code)
          setPluPrice(rawScalePriceToPesos(r.data.price))
          setPesable(r.data.type === 'pesable')
        }
      } else {
        setSearchResult(null)
        showFeedback('error', r.error ?? 'Error al leer PLU.')
      }
    } catch {
      setSearchResult(null)
      showFeedback('error', 'Error de comunicación.')
    } finally {
      setSearching(false)
    }
  }

  function handleLoadIntoForm(plu: PluRow) {
    setPluNumber(String(parseInt(plu.number, 10)))
    setPluName(plu.name)
    setPluCode(plu.code)
    // Convertir precio raw de la balanza (1 decimal implícito) a pesos enteros para el formulario
    setPluPrice(rawScalePriceToPesos(plu.price))
    setPesable(plu.type === 'pesable')
  }

  async function handleDeletePlu(plu: PluRow) {
    const pluNumberToDelete = String(parseInt(plu.number, 10))

    setDeleting(true)
    setFeedback(null)
    try {
      const r = await window.hw.kretzDeletePlu({ pluNumber: pluNumberToDelete })
      if (r.ok) {
        showFeedback('ok', `PLU ${r.data.pluNumber} borrado de la balanza.`)
        setDeleteCandidate(null)
        setSearchResult(null)
        if (searchNumber.trim() === pluNumberToDelete) setSearchNumber('')
        if (pluNumber.trim() === pluNumberToDelete) {
          setPluNumber('')
          setPluName('')
          setPluCode('')
          setPluPrice('')
        }
        const countR = await window.hw.kretzReadPluCount()
        if (countR.ok) setPluCount(countR.data.count)
      } else {
        showFeedback('error', r.error ?? 'Error al borrar PLU.')
      }
    } catch {
      showFeedback('error', 'Error de comunicación al borrar PLU.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-5">

      {/* Encabezado */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">Gestión de PLUs</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Crea o modifica productos directamente en la balanza KRETZ.
          </p>
        </div>
        {pluCount !== null && (
          <span className="text-xs text-zinc-400">
            {pluCount} PLU{pluCount !== 1 ? 's' : ''} en balanza
          </span>
        )}
      </div>

      {/* Conexión */}
      <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-zinc-300">Estado de conexión</p>
          <StatusBadge linked={linked} />
        </div>
        <p className="text-xs text-zinc-500">
          Conectá la balanza por USB (COM8). El punto verde en la pestaña Hardware solo indica que el
          puerto serial está abierto; acá se prueba que la balanza responda al protocolo R30.
        </p>
        <button
          onClick={handleTestLink}
          disabled={testingLink}
          className="rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-600 disabled:opacity-50 transition-colors"
        >
          {testingLink ? 'Verificando…' : 'Verificar conexión'}
        </button>
      </div>

      {/* Buscador */}
      <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-4 space-y-3">
        <p className="text-sm font-medium text-zinc-300">Buscar PLU existente</p>
        <p className="text-xs text-zinc-500">
          Si el producto ya existe, se carga en el formulario para que lo edites.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={searchNumber}
            onChange={e => setSearchNumber(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="Nº de PLU (ej. 1)"
            inputMode="numeric"
            className="flex-1 rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          />
          <button
            onClick={handleSearch}
            disabled={searching || !searchNumber.trim()}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
          >
            {searching ? 'Buscando…' : 'Buscar'}
          </button>
        </div>
        {searchResult !== 'not_found' && searchResult !== null && (
          <div className="space-y-2">
            <PluResultCard plu={searchResult} />
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleLoadIntoForm(searchResult)}
                className="text-xs text-amber-400 hover:text-amber-300 underline"
              >
                Cargar en formulario para editar
              </button>
              <button
                onClick={() => setDeleteCandidate(searchResult)}
                disabled={deleting}
                className="text-xs text-red-400 hover:text-red-300 underline disabled:opacity-50"
              >
                {deleting ? 'Borrando…' : 'Borrar PLU de balanza'}
              </button>
            </div>
          </div>
        )}
        {searchResult === null && (
          <p className="text-xs text-zinc-500 italic">PLU no encontrado en la balanza.</p>
        )}
      </div>

      {/* Formulario */}
      <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-4 space-y-4">
        <div>
          <p className="text-sm font-medium text-zinc-300">Crear / actualizar PLU</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            Si el número ya existe en la balanza, se sobreescribe.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Número */}
          <div className="col-span-1">
            <label className="text-xs text-zinc-400">Número de PLU *</label>
            <input
              type="text"
              value={pluNumber}
              onChange={e => setPluNumber(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="ej. 1"
              inputMode="numeric"
              className="mt-1 w-full rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            />
          </div>

          {/* Código artículo */}
          <div className="col-span-1">
            <label className="text-xs text-zinc-400">Código artículo (5 díg.)</label>
            <input
              type="text"
              value={pluCode}
              onChange={e => setPluCode(e.target.value.replace(/\D/g, '').slice(0, 5))}
              placeholder="00001"
              inputMode="numeric"
              className="mt-1 w-full rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            />
          </div>

          {/* Nombre */}
          <div className="col-span-2">
            <label className="text-xs text-zinc-400">Nombre del producto * (máx. 26 caracteres)</label>
            <input
              type="text"
              value={pluName}
              onChange={e => setPluName(e.target.value.slice(0, 26))}
              placeholder="ej. ASADO"
              className="mt-1 w-full rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            />
            <p className="mt-0.5 text-right text-[10px] text-zinc-600">{pluName.length}/26</p>
          </div>

          {/* Precio */}
          <div className="col-span-1">
            <label className="text-xs text-zinc-400">
              Precio {pesable ? '$/kg' : '$'} * — pesos enteros (hasta $99.999)
            </label>
            <NumericInput
              value={pluPrice}
              onChange={setPluPrice}
              placeholder="8500"
              className="mt-1 w-full rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            />
            {pluPrice && parseNumericInput(pluPrice) !== null && (
              <p className="mt-0.5 text-[10px] text-zinc-500">
                {formatPesoPreview(pluPrice)}
              </p>
            )}
          </div>

          {/* Dígitos precio — refleja la configuración de la balanza */}
          <div className="col-span-1">
            <label className="text-xs text-zinc-400">
              Formato de precio
            </label>
            <select
              value={priceDigits}
              onChange={e => setPriceDigits(Number(e.target.value) as 6 | 7)}
              className="mt-1 w-full rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-zinc-500"
            >
              <option value={6}>iTegra compatible: 135 bytes — recomendado</option>
              <option value={7}>138 bytes — diagnóstico</option>
            </select>
            <p className="mt-0.5 text-[10px] text-zinc-600">
              La lectura de iTegra mostró campo de 6 dígitos con 1 decimal: $21.000 {'->'} 210000.
            </p>
          </div>

          {/* Tipo */}
          <div className="col-span-2 flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={pesable}
                onChange={e => setPesable(e.target.checked)}
                className="h-4 w-4 accent-emerald-500"
              />
              <span className="text-sm text-zinc-300">
                Pesable (se vende por kg)
              </span>
            </label>
            <span className="text-xs text-zinc-600">
              Desmarcá para productos de precio fijo (por unidad).
            </span>
          </div>
        </div>

        {/* Feedback */}
        {feedback && (
          <p
            className={`rounded-lg px-3 py-2 text-xs font-medium ${
              feedback.type === 'ok'
                ? 'bg-green-900/40 text-green-300'
                : 'bg-red-900/40 text-red-300'
            }`}
          >
            {feedback.type === 'ok' ? '✓ ' : '✗ '}
            {feedback.message}
          </p>
        )}

        {/* Botón enviar */}
        <button
          onClick={handleSendPlu}
          disabled={sending || linked === false}
          className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-40 transition-colors"
        >
          {sending ? 'Enviando a la balanza…' : 'Guardar PLU en balanza'}
        </button>

        {linked === false && (
          <p className="text-center text-xs text-zinc-500">
            Verificá la conexión con la balanza primero.
          </p>
        )}
      </div>

      {deleteCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-red-900/60 bg-zinc-950 p-5 shadow-2xl">
            <p className="text-sm font-semibold text-white">Confirmar borrado de PLU</p>
            <p className="mt-2 text-xs leading-relaxed text-zinc-400">
              Vas a borrar el PLU{' '}
              <span className="font-mono text-red-300">{parseInt(deleteCandidate.number, 10)}</span>
              {' '}({deleteCandidate.name || 'sin nombre'}) de la balanza.
            </p>
            <p className="mt-2 text-xs text-red-300">
              Esta acción no se puede deshacer desde la app.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setDeleteCandidate(null)}
                disabled={deleting}
                className="flex-1 rounded-lg bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDeletePlu(deleteCandidate)}
                disabled={deleting}
                className="flex-1 rounded-lg bg-red-700 px-3 py-2 text-sm font-bold text-white hover:bg-red-600 disabled:opacity-50"
              >
                {deleting ? 'Borrando…' : 'Borrar definitivamente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
