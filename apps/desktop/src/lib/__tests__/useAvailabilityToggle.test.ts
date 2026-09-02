import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAvailabilityToggle } from '../useAvailabilityToggle'
import type { AdminProductRow } from '../../types/hw-api'
import { useState } from 'react'

const PRODUCT: AdminProductRow = {
  id: 'p1',
  name: 'Asado',
  category: 'beef_cut',
  unit: 'kg',
  pluNumber: 1,
  active: true,
  price: 18000,
  available: true,
}

function useHarness() {
  const [products, setProducts] = useState<AdminProductRow[]>([PRODUCT])
  const [error, setError] = useState<string | null>(null)
  const api = useAvailabilityToggle('s1', setProducts, setError)
  return { products, error, ...api }
}

describe('useAvailabilityToggle', () => {
  beforeEach(() => {
    window.hw = {
      setProductAvailability: vi.fn(),
    } as unknown as typeof window.hw
  })

  it('un segundo toggle del mismo producto no dispara otro IPC mientras el primero está en vuelo', async () => {
    let resolveFirst: (value: { ok: true; data: undefined }) => void = () => {}
    vi.mocked(window.hw.setProductAvailability).mockReturnValue(
      new Promise(resolve => { resolveFirst = resolve }),
    )

    const { result } = renderHook(() => useHarness())

    await act(async () => {
      void result.current.toggleAvailability(PRODUCT)
    })
    await act(async () => {
      void result.current.toggleAvailability({ ...PRODUCT, available: false })
    })

    expect(window.hw.setProductAvailability).toHaveBeenCalledTimes(1)
    expect(result.current.isAvailabilityPending('p1')).toBe(true)

    await act(async () => {
      resolveFirst({ ok: true, data: undefined })
    })
  })

  it('revierte el estado si el IPC falla', async () => {
    vi.mocked(window.hw.setProductAvailability).mockResolvedValue({
      ok: false,
      error: 'falló',
    })

    const { result } = renderHook(() => useHarness())

    await act(async () => {
      await result.current.toggleAvailability(PRODUCT)
    })

    expect(result.current.products[0]?.available).toBe(true)
    expect(result.current.error).toBe('falló')
  })
})
