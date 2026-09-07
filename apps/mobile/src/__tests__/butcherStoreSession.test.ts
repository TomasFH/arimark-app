import { describe, it, expect, beforeEach } from 'vitest'
import {
  BACKGROUND_RECONFIRM_MS,
  clearPersistedStore,
  clearStoreSessionConfirmed,
  displayStoreName,
  initialButcherStore,
  isStoreSessionConfirmed,
  markStoreSessionConfirmed,
  readPersistedStore,
  shouldReconfirmStore,
  writePersistedStore,
} from '../lib/butcherStoreSession'

describe('butcherStoreSession', () => {
  beforeEach(() => {
    localStorage.clear()
    clearStoreSessionConfirmed()
  })

  it('un solo local entra directo, sin picker', () => {
    writePersistedStore('a')
    expect(initialButcherStore({
      authorizedStores: ['a'],
      persistedId: 'a',
      todayYmd: '2026-09-04',
    })).toEqual({ storeId: 'a', showPicker: false })
  })

  it('varios locales: al abrir el proceso pide confirmación y no activa el anterior', () => {
    expect(initialButcherStore({
      authorizedStores: ['a', 'b'],
      persistedId: 'a',
      todayYmd: '2026-09-04',
    })).toEqual({ storeId: '', showPicker: true })
  })

  it('varios locales: si ya confirmó hoy, reusa el persistido', () => {
    markStoreSessionConfirmed('2026-09-04')
    expect(initialButcherStore({
      authorizedStores: ['a', 'b'],
      persistedId: 'b',
      todayYmd: '2026-09-04',
    })).toEqual({ storeId: 'b', showPicker: false })
  })

  it('confirmación de ayer no vale para hoy', () => {
    markStoreSessionConfirmed('2026-09-03')
    expect(isStoreSessionConfirmed('2026-09-04')).toBe(false)
    expect(shouldReconfirmStore({
      authorizedCount: 2,
      todayYmd: '2026-09-04',
      hiddenForMs: 1_000,
    })).toBe(true)
  })

  it('no repregunta si volvió al frente en menos de 2 h', () => {
    markStoreSessionConfirmed('2026-09-04')
    expect(shouldReconfirmStore({
      authorizedCount: 2,
      todayYmd: '2026-09-04',
      hiddenForMs: BACKGROUND_RECONFIRM_MS - 1,
    })).toBe(false)
  })

  it('repregunta si estuvo 2 h o más en segundo plano', () => {
    markStoreSessionConfirmed('2026-09-04')
    expect(shouldReconfirmStore({
      authorizedCount: 2,
      todayYmd: '2026-09-04',
      hiddenForMs: BACKGROUND_RECONFIRM_MS,
    })).toBe(true)
  })

  it('un solo local nunca repregunta por segundo plano', () => {
    expect(shouldReconfirmStore({
      authorizedCount: 1,
      todayYmd: '2026-09-04',
      hiddenForMs: BACKGROUND_RECONFIRM_MS * 3,
    })).toBe(false)
  })

  it('displayStoreName no muestra el id mientras carga', () => {
    expect(displayStoreName(undefined, true)).toBe('Cargando…')
    expect(displayStoreName({ id: 'local1', name: 'local1' }, true)).toBe('Cargando…')
    expect(displayStoreName({ id: 'local1', name: 'San Martín' }, false)).toBe('San Martín')
  })

  it('persiste el último local para preseleccionar', () => {
    writePersistedStore('abc')
    expect(readPersistedStore()).toBe('abc')
    clearPersistedStore()
    expect(readPersistedStore()).toBeNull()
  })
})
