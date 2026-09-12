import { describe, it, expect, afterEach } from 'vitest'
import { applyColorScheme, isColorScheme } from '../theme'

describe('theme', () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme
    document.documentElement.style.colorScheme = ''
  })

  it('isColorScheme acepta solo light y dark', () => {
    expect(isColorScheme('light')).toBe(true)
    expect(isColorScheme('dark')).toBe(true)
    expect(isColorScheme('system')).toBe(false)
    expect(isColorScheme(null)).toBe(false)
  })

  it('applyColorScheme setea dataset.theme y color-scheme', () => {
    applyColorScheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')

    applyColorScheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })
})
