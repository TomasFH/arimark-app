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

function priceCentsToDisplay(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',')
}

function displayToPriceCents(raw: string): number | null {
  const n = parseNumericInput(raw)
  return n !== null ? n : null
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
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/60 p-3 text-xs space-y-1">
      <div className="flex justify-between">
        <span className="text-gray-400">PLU</span>
        <span className="font-mono text-white">{plu.number}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-gray-400">Nombre</span>
        <span className="text-white">{plu.name || '—'}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-gray-400">Código artículo</span>
        <span className="font-mono text-white">{plu.code || '—'}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-gray-400">Precio (raw)</span>
        <span className="font-mono text-amber-400">{plu.price}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-gray-400">Tipo</span>
        <span className={plu.type === 'pesable' ? 'text-blue-300' : 'text-gray-300'}>
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
  const [priceDigits, setPriceDigits] = useState<6 | 7>(6)

  // --- Búsqueda ---
  const [searchNumber, setSearchNumber] = useState('')
  const [searchResult, setSearchResult] = useState<PluRow | null | 'not_found'>('not_found' as const)
  const [searching, setSearching] = useState(false)

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
    try {
      const r = await window.hw.kretzTestLink()
      setLinked(r.ok ? r.data.linked : false)
      if (r.ok && r.data.linked) {
        const countR = await window.hw.kretzReadPluCount()
        if (countR.ok) setPluCount(countR.data.count)
      }
    } catch {
      setLinked(false)
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
    const priceCents = displayToPriceCents(pluPrice)
    if (priceCents === null) {
      showFeedback('error', 'Ingresá un precio válido.')
      return
    }

    setSending(true)
    setFeedback(null)
    try {
      const payload: SendPluPayload = {
        pluNumber: pluNumber.trim(),
        name: pluName.trim().slice(0, 26),
        description: pluName.trim().slice(0, 26),
        articleCode: pluCode.trim().padStart(5, '0').slice(-5),
        pesable,
        priceCents,
        priceDigits,
        department: '001',
        family: '001',
      }
      const r = await window.hw.kretzSendPlu(payload)
      if (r.ok) {
        showFeedback('ok', `PLU ${r.data.pluNumber} guardado en la balanza.`)
        // Actualizar conteo
        const countR = await window.hw.kretzReadPluCount()
        if (countR.ok) setPluCount(countR.data.count)
      } else {
        showFeedback('error', r.error ?? 'Error al enviar PLU.')
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
          setPluNumber(r.data.number.replace(/^0+/, '') || r.data.number)
          setPluName(r.data.name)
          setPluCode(r.data.code)
          setPluPrice(r.data.price)
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
    setPluNumber(plu.number.replace(/^0+/, '') || plu.number)
    setPluName(plu.name)
    setPluCode(plu.code)
    setPluPrice(plu.price)
    setPesable(plu.type === 'pesable')
  }

  return (
    <div className="space-y-5">

      {/* Encabezado */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">Gestión de PLUs</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Crea o modifica productos directamente en la balanza KRETZ.
          </p>
        </div>
        {pluCount !== null && (
          <span className="text-xs text-gray-400">
            {pluCount} PLU{pluCount !== 1 ? 's' : ''} en balanza
          </span>
        )}
      </div>

      {/* Conexión */}
      <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-300">Estado de conexión</p>
          <StatusBadge linked={linked} />
        </div>
        <p className="text-xs text-gray-500">
          Conectá la balanza por USB (COM8). Luego presioná "Verificar" para confirmar la comunicación.
        </p>
        <button
          onClick={handleTestLink}
          disabled={testingLink}
          className="rounded-lg bg-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-600 disabled:opacity-50 transition-colors"
        >
          {testingLink ? 'Verificando…' : 'Verificar conexión'}
        </button>
      </div>

      {/* Buscador */}
      <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-4 space-y-3">
        <p className="text-sm font-medium text-gray-300">Buscar PLU existente</p>
        <p className="text-xs text-gray-500">
          Si el producto ya existe, se carga en el formulario para que lo edites.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={searchNumber}
            onChange={e => setSearchNumber(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="Nº de PLU (ej. 1)"
            inputMode="numeric"
            className="flex-1 rounded-lg bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
          <button
            onClick={handleSearch}
            disabled={searching || !searchNumber.trim()}
            className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
          >
            {searching ? 'Buscando…' : 'Buscar'}
          </button>
        </div>
        {searchResult !== 'not_found' && searchResult !== null && (
          <div className="space-y-2">
            <PluResultCard plu={searchResult} />
            <button
              onClick={() => handleLoadIntoForm(searchResult)}
              className="text-xs text-amber-400 hover:text-amber-300 underline"
            >
              Cargar en formulario para editar
            </button>
          </div>
        )}
        {searchResult === null && (
          <p className="text-xs text-gray-500 italic">PLU no encontrado en la balanza.</p>
        )}
      </div>

      {/* Formulario */}
      <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-4 space-y-4">
        <div>
          <p className="text-sm font-medium text-gray-300">Crear / actualizar PLU</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Si el número ya existe en la balanza, se sobreescribe.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Número */}
          <div className="col-span-1">
            <label className="text-xs text-gray-400">Número de PLU *</label>
            <input
              type="text"
              value={pluNumber}
              onChange={e => setPluNumber(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="ej. 1"
              inputMode="numeric"
              className="mt-1 w-full rounded-lg bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>

          {/* Código artículo */}
          <div className="col-span-1">
            <label className="text-xs text-gray-400">Código artículo (5 díg.)</label>
            <input
              type="text"
              value={pluCode}
              onChange={e => setPluCode(e.target.value.replace(/\D/g, '').slice(0, 5))}
              placeholder="00001"
              inputMode="numeric"
              className="mt-1 w-full rounded-lg bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
          </div>

          {/* Nombre */}
          <div className="col-span-2">
            <label className="text-xs text-gray-400">Nombre del producto * (máx. 26 caracteres)</label>
            <input
              type="text"
              value={pluName}
              onChange={e => setPluName(e.target.value.slice(0, 26))}
              placeholder="ej. ASADO"
              className="mt-1 w-full rounded-lg bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
            <p className="mt-0.5 text-right text-[10px] text-gray-600">{pluName.length}/26</p>
          </div>

          {/* Precio */}
          <div className="col-span-1">
            <label className="text-xs text-gray-400">
              Precio {pesable ? '$/kg' : '$'} * (en pesos, sin decimales)
            </label>
            <NumericInput
              value={pluPrice}
              onChange={setPluPrice}
              placeholder="0"
              className="mt-1 w-full rounded-lg bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
            {pluPrice && displayToPriceCents(pluPrice) !== null && (
              <p className="mt-0.5 text-[10px] text-gray-500">
                = {priceCentsToDisplay(displayToPriceCents(pluPrice)! * 100)} ARS (en balanza: centavos × 100)
              </p>
            )}
          </div>

          {/* Dígitos precio */}
          <div className="col-span-1">
            <label className="text-xs text-gray-400">Dígitos precio (6 = REPORT NX)</label>
            <select
              value={priceDigits}
              onChange={e => setPriceDigits(Number(e.target.value) as 6 | 7)}
              className="mt-1 w-full rounded-lg bg-gray-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
            >
              <option value={6}>6 dígitos</option>
              <option value={7}>7 dígitos</option>
            </select>
          </div>

          {/* Tipo */}
          <div className="col-span-2 flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={pesable}
                onChange={e => setPesable(e.target.checked)}
                className="h-4 w-4 accent-amber-500"
              />
              <span className="text-sm text-gray-300">
                Pesable (se vende por kg)
              </span>
            </label>
            <span className="text-xs text-gray-600">
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
          className="w-full rounded-xl bg-amber-500 py-3 text-sm font-bold text-white hover:bg-amber-400 disabled:opacity-40 transition-colors"
        >
          {sending ? 'Enviando a la balanza…' : 'Guardar PLU en balanza'}
        </button>

        {linked === false && (
          <p className="text-center text-xs text-gray-500">
            Verificá la conexión con la balanza primero.
          </p>
        )}
      </div>
    </div>
  )
}
