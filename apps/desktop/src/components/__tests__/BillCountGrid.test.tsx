import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import BillCountGrid from '../BillCountGrid'
import { emptyBillRows } from '../../lib/billCountUi'

function renderGrid(columns?: 1 | 2) {
  return render(
    <BillCountGrid
      rows={emptyBillRows()}
      mode="quantity"
      onModeChange={vi.fn()}
      onUpdate={vi.fn()}
      countedTotal={0}
      columns={columns}
    />,
  )
}

describe('BillCountGrid — columnas de denominaciones', () => {
  it('queda en una columna si no se pide otra cosa', () => {
    const { container } = renderGrid()
    const grid = container.querySelector('[data-bill-columns="1"]')
    expect(grid).not.toBeNull()
    expect(grid).toHaveClass('grid-cols-1')
    expect(grid).not.toHaveClass('grid-cols-2')
  })

  it('reparte las denominaciones en dos columnas al abrirlo así', () => {
    const { container } = renderGrid(2)
    const grid = container.querySelector('[data-bill-columns="2"]')
    expect(grid).not.toBeNull()
    expect(grid).toHaveClass('grid-cols-2')
    expect(grid).not.toHaveClass('grid-cols-1')
  })
})
