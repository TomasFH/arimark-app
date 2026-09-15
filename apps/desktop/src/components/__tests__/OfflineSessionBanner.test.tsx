import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OfflineSessionBanner } from '../OfflineSessionBanner'

describe('OfflineSessionBanner', () => {
  it('muestra el aviso de sesión local sin conexión', () => {
    render(<OfflineSessionBanner />)
    expect(screen.getByRole('status', { name: 'Sesión sin conexión' })).toBeInTheDocument()
    expect(screen.getByText('Sin conexión — sesión guardada localmente')).toBeInTheDocument()
  })
})
