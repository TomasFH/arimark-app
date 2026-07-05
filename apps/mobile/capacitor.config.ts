import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Configuración de Capacitor para empaquetar el POS móvil como app nativa
 * (Android .apk / proyecto iOS).
 *
 * `webDir: 'dist'` hace que los assets web construidos por Vite se copien
 * DENTRO del instalador nativo. Por eso la app siempre abre offline, incluso
 * la primera vez tras instalarla y sin haber tenido internet nunca.
 *
 * No se define `server.url`: la app carga siempre desde los archivos locales
 * empaquetados, nunca desde un servidor remoto.
 */
const config: CapacitorConfig = {
  appId: 'com.carniceria.pos',
  appName: 'POS Móvil',
  webDir: 'dist',
  android: {
    // Permite que el WebView reconozca el esquema local como origen seguro
    // (necesario para cámara, IndexedDB y persistencia de sesión Firebase).
    allowMixedContent: false,
  },
}

export default config
