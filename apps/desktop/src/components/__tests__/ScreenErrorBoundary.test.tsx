import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import ScreenErrorBoundary from '../ScreenErrorBoundary'

function Boom(): ReactNode {
  throw new Error('fallo de prueba')
}

function Ok(): ReactNode {
  return <p>ok</p>
}

describe('ScreenErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('muestra recuperación en vez de dejar la ventana en blanco', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ScreenErrorBoundary resetKey="providers">
        <Boom />
      </ScreenErrorBoundary>,
    )
    expect(screen.getByText('Esta pantalla no se pudo mostrar.')).toBeInTheDocument()
    expect(screen.getByText('fallo de prueba')).toBeInTheDocument()
    expect(screen.queryByText('ok')).not.toBeInTheDocument()
  })

  it('Reintentar vuelve a montar los hijos', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let shouldThrow = true
    function Flaky(): ReactNode {
      if (shouldThrow) throw new Error('una vez')
      return <p>recuperado</p>
    }
    render(
      <ScreenErrorBoundary resetKey="a">
        <Flaky />
      </ScreenErrorBoundary>,
    )
    expect(screen.getByText('Esta pantalla no se pudo mostrar.')).toBeInTheDocument()
    shouldThrow = false
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(screen.getByText('recuperado')).toBeInTheDocument()
  })

  it('Volver llama onReset', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onReset = vi.fn()
    render(
      <ScreenErrorBoundary resetKey="providers" onReset={onReset}>
        <Boom />
      </ScreenErrorBoundary>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Volver' }))
    expect(onReset).toHaveBeenCalledOnce()
  })

  it('cambiar de pantalla limpia el error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { rerender } = render(
      <ScreenErrorBoundary resetKey="providers">
        <Boom />
      </ScreenErrorBoundary>,
    )
    expect(screen.getByText('Esta pantalla no se pudo mostrar.')).toBeInTheDocument()
    rerender(
      <ScreenErrorBoundary resetKey="hub">
        <Ok />
      </ScreenErrorBoundary>,
    )
    expect(screen.getByText('ok')).toBeInTheDocument()
  })
})
