import { describe, expect, it } from 'vitest'
import { clampHistoryRange, planHistoryFetch } from '../historyRange'

describe('clampHistoryRange', () => {
  it('no deja pasar de hoy y corrige un desde posterior al hasta', () => {
    expect(clampHistoryRange('2026-10-20', '2026-11-01', '2026-10-15')).toEqual({
      from: '2026-10-15',
      to: '2026-10-15',
    })
    expect(clampHistoryRange('2026-10-10', '2026-10-01', '2026-10-15')).toEqual({
      from: '2026-10-01',
      to: '2026-10-01',
    })
    expect(clampHistoryRange('2026-10-01', '2026-10-15', '2026-10-15')).toEqual({
      from: '2026-10-01',
      to: '2026-10-15',
    })
  })
})

describe('planHistoryFetch', () => {
  const loaded = { from: '2026-10-08', to: '2026-10-15' }

  it('la primera carga pide como máximo 14 días, los más nuevos', () => {
    expect(planHistoryFetch('2025-10-15', '2026-10-15', null)).toEqual({
      kind: 'replace',
      from: '2026-10-02',
      to: '2026-10-15',
    })
  })

  it('si el rango ya está cargado no pide nada', () => {
    expect(planHistoryFetch('2026-10-10', '2026-10-12', loaded)).toEqual({ kind: 'none' })
  })

  it('ampliar una semana hacia atrás pide solo esos días', () => {
    expect(planHistoryFetch('2026-10-01', '2026-10-15', loaded)).toEqual({
      kind: 'extend',
      from: '2026-10-01',
      to: '2026-10-07',
    })
  })

  it('un desde de hace un año pide solo 14 días previos a lo ya cargado', () => {
    expect(planHistoryFetch('2025-10-15', '2026-10-15', loaded)).toEqual({
      kind: 'extend',
      from: '2026-09-24',
      to: '2026-10-07',
    })
  })

  it('un salto a otro período no reconsulta la semana ya cargada', () => {
    expect(planHistoryFetch('2026-01-01', '2026-01-31', loaded)).toEqual({
      kind: 'replace',
      from: '2026-01-18',
      to: '2026-01-31',
    })
  })
})
