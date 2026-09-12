/**
 * Tema claro/oscuro del POS desktop.
 * Las preferencias viven en userData/ui-settings.json (IPC get/setUiSettings).
 * Este módulo solo aplica el esquema al documento; no persiste.
 */
export type ColorScheme = 'light' | 'dark'

export function isColorScheme(value: unknown): value is ColorScheme {
  return value === 'light' || value === 'dark'
}

/** Fija data-theme y color-scheme en <html> para que los tokens CSS y el chrome nativo coincidan. */
export function applyColorScheme(scheme: ColorScheme): void {
  const root = document.documentElement
  root.dataset.theme = scheme
  root.style.colorScheme = scheme
}
