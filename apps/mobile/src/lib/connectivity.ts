/**
 * Detección de conectividad, unificada para app nativa (Capacitor) y web.
 *
 * Usa el plugin @capacitor/network, que en la app nativa consulta el estado
 * real del sistema y en la web cae automáticamente a navigator.onLine +
 * eventos 'online'/'offline'. Si el plugin no estuviera disponible, hay un
 * fallback explícito a la API del navegador.
 */
import { Network } from '@capacitor/network'
import { useEffect, useRef, useState } from 'react'

/** Estado de conexión actual (async porque el plugin nativo lo consulta al SO). */
export async function isOnline(): Promise<boolean> {
  try {
    const status = await Network.getStatus()
    return status.connected
  } catch {
    return navigator.onLine
  }
}

type ConnectivityListener = (online: boolean) => void

/**
 * Suscribe cambios de conectividad. Devuelve una función para desuscribirse.
 */
export function onConnectivityChange(listener: ConnectivityListener): () => void {
  let handle: { remove: () => void } | null = null
  let cancelled = false

  Network.addListener('networkStatusChange', (status) => listener(status.connected))
    .then((h) => {
      if (cancelled) h.remove()
      else handle = h
    })
    .catch(() => {
      const onl = () => listener(true)
      const off = () => listener(false)
      window.addEventListener('online', onl)
      window.addEventListener('offline', off)
      handle = {
        remove: () => {
          window.removeEventListener('online', onl)
          window.removeEventListener('offline', off)
        },
      }
    })

  return () => {
    cancelled = true
    handle?.remove()
  }
}

/** Hook de React que refleja el estado de conexión en tiempo real. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    isOnline().then((o) => {
      if (mounted.current) setOnline(o)
    })
    const unsub = onConnectivityChange((o) => {
      if (mounted.current) setOnline(o)
    })
    return () => {
      mounted.current = false
      unsub()
    }
  }, [])

  return online
}
