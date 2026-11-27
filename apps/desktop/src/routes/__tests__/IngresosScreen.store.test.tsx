import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import IngresosScreen from '../IngresosScreen'

const EMPTY_BOOK = {
  rubros: [],
  paid: 0,
  cashOut: 0,
  debt: 0,
  providers: [],
  warning: null,
}

describe('IngresosScreen — local inicial', () => {
  beforeEach(() => {
    window.hw = {
      getStores: vi.fn().mockResolvedValue({
        ok: true,
        data: [
          { id: 'store-sm', name: 'San Martín' },
          { id: 'store-cam', name: 'Camarones' },
        ],
      }),
      listMerchWeek: vi.fn().mockResolvedValue({ ok: true, data: EMPTY_BOOK }),
      getUiSettings: vi.fn().mockResolvedValue({ ok: true, data: { zoomFactor: 1, colorScheme: 'light' } }),
      setUiSettings: vi.fn().mockResolvedValue({ ok: true }),
      onUiSettingsChanged: vi.fn(() => () => undefined),
    } as unknown as typeof window.hw
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('desde el POS abre en el local del turno y se puede pasar a Todos', async () => {
    const user = userEvent.setup()
    render(
      <IngresosScreen
        onBack={vi.fn()}
        onLogout={vi.fn()}
        canPriceMediaRes={false}
        initialStoreId="store-sm"
      />,
    )

    const storeButton = await screen.findByRole('button', { name: 'Local' })
    expect(storeButton).toHaveTextContent('San Martín')
    expect(window.hw.listMerchWeek).toHaveBeenCalledWith(expect.objectContaining({ storeIdFilter: 'store-sm' }))

    await user.click(storeButton)
    await user.click(screen.getByRole('option', { name: 'Todos los locales' }))
    expect(window.hw.listMerchWeek).toHaveBeenCalledWith(expect.objectContaining({ storeIdFilter: 'all' }))
  })

  it('desde el hub abre en Todos los locales', async () => {
    render(<IngresosScreen onBack={vi.fn()} onLogout={vi.fn()} canPriceMediaRes />)
    expect(await screen.findByRole('button', { name: 'Local' })).toHaveTextContent('Todos los locales')
    expect(window.hw.listMerchWeek).toHaveBeenCalledWith(expect.objectContaining({ storeIdFilter: 'all' }))
  })

  it('una visita puntual no queda escondida por el local del turno', async () => {
    render(
      <IngresosScreen
        onBack={vi.fn()}
        onLogout={vi.fn()}
        canPriceMediaRes={false}
        initialStoreId="store-sm"
        focusVisit={{ id: 'visita-1', createdAt: new Date().toISOString() }}
      />,
    )
    expect(await screen.findByRole('button', { name: 'Local' })).toHaveTextContent('Todos los locales')
    expect(window.hw.listMerchWeek).toHaveBeenCalledWith(expect.objectContaining({ storeIdFilter: 'all' }))
  })
})
