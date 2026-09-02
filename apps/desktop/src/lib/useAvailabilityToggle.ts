import { useCallback, useRef, useState } from 'react'
import type { AdminProductRow } from '../types/hw-api'

/**
 * Toggle de disponibilidad por local: ignora clics mientras hay un IPC en vuelo
 * para ese producto, así no se pisan respuestas ni el estado visual queda al revés.
 */
export function useAvailabilityToggle(
  storeId: string,
  setProducts: React.Dispatch<React.SetStateAction<AdminProductRow[]>>,
  setError: (msg: string | null) => void,
) {
  const pendingRef = useRef(new Set<string>())
  const [pendingTick, setPendingTick] = useState(0)

  const isAvailabilityPending = useCallback((productId: string) => {
    return pendingRef.current.has(productId)
  }, [pendingTick])

  const hasAvailabilityPending = useCallback(() => pendingRef.current.size > 0, [])

  const toggleAvailability = useCallback(async (p: AdminProductRow) => {
    if (!storeId || pendingRef.current.has(p.id)) return
    const next = !p.available
    pendingRef.current.add(p.id)
    setPendingTick(t => t + 1)
    setProducts(prev => prev.map(x => x.id === p.id ? { ...x, available: next } : x))
    const r = await window.hw.setProductAvailability({
      productId: p.id,
      storeId,
      available: next,
    })
    pendingRef.current.delete(p.id)
    setPendingTick(t => t + 1)
    if (!r.ok) {
      setProducts(prev => prev.map(x => x.id === p.id ? { ...x, available: p.available } : x))
      setError(r.error)
    }
  }, [storeId, setProducts, setError])

  return { toggleAvailability, isAvailabilityPending, hasAvailabilityPending }
}
