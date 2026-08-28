/**
 * La PWA de Hosting (web.app) queda en el service worker. El navegador
 * no siempre busca un SW nuevo al reabrir: puede tardar horas o exigir
 * un pull-to-refresh. Esto consulta al abrir y al volver al frente, y
 * recarga cuando el SW nuevo toma el control.
 *
 * En el APK Capacitor no aplica: los assets van empaquetados en el
 * instalador, no en Firebase Hosting.
 */
function askServiceWorkerToUpdate(): void {
  if (!('serviceWorker' in navigator)) return
  void navigator.serviceWorker.getRegistration().then(reg => {
    void reg?.update()
  })
}

export function installPwaAutoUpdate(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })

  askServiceWorkerToUpdate()

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') askServiceWorkerToUpdate()
  })
  window.addEventListener('focus', askServiceWorkerToUpdate)

  void import('@capacitor/app').then(({ App }) => {
    void App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) askServiceWorkerToUpdate()
    })
  })
}
