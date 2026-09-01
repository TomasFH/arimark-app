/**
 * Recarga el catálogo en el renderer cuando el main aplica un merge remoto.
 * POS / lista / vales / clientes especiales / conteo ya lo usan.
 * AdminScreen (BLOQUE I-B): `useCatalogSyncReload(() => { void loadProducts() })`.
 * No mutar ítems ya en el ticket: solo re-leer la lista para el próximo alta.
 */
import { useEffect, useRef } from 'react'

export function useCatalogSyncReload(onReload: () => void | Promise<void>): void {
  const onReloadRef = useRef(onReload)
  onReloadRef.current = onReload

  useEffect(() => {
    const hw = window.hw
    if (typeof hw?.onCatalogSyncUpdated !== 'function') return undefined
    return hw.onCatalogSyncUpdated(() => {
      void onReloadRef.current()
    })
  }, [])
}
