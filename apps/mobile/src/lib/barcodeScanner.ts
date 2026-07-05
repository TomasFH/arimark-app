/**
 * Motor de escaneo de códigos de barras con estrategia híbrida.
 *
 * 1. BarcodeDetector nativo (preferido): usa el motor del SO (en Android,
 *    el mismo que usan las apps nativas — muy rápido y tolerante a tickets
 *    de baja calidad). Disponible en Chrome/Edge Android y algunos desktop.
 * 2. @zxing/browser (respaldo): decodificador puro en JS para navegadores
 *    sin BarcodeDetector (ej. Firefox, iOS Safari).
 *
 * Ambos caminos:
 *  - Comparten el mismo stream de cámara (una sola llamada a getUserMedia)
 *    para poder exponer control de linterna (torch).
 *  - Analizan SOLO la región central del frame (ROI) para evitar leer códigos
 *    que están fuera del recuadro visible. Esto se logra recortando el frame
 *    a un canvas antes de pasarlo al decodificador.
 */
import { BrowserMultiFormatReader } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'

/** Formato único que emiten los tickets KRETZ. */
const EAN_13 = 'ean_13'

/**
 * Región de interés (ROI): fracción central del frame que se analiza.
 * El resto del frame se ignora, de modo que solo se lee el código colocado
 * dentro del recuadro visible. Estos valores deben coincidir con el overlay
 * dibujado en PosScreen (SCAN_ROI exportado).
 */
export const SCAN_ROI = { widthFrac: 0.85, heightFrac: 0.35 }

export interface ScanController {
  stop: () => void
  /** true si el hardware/stream soporta linterna. */
  supportsTorch: boolean
  /** Enciende/apaga la linterna. No-op si no está soportada. */
  setTorch: (on: boolean) => Promise<void>
  /** Motor en uso, para diagnóstico/UI. */
  engine: 'native' | 'zxing'
}

// ── Tipos mínimos de BarcodeDetector (no están en lib.dom estándar) ──────────
interface DetectedBarcode {
  rawValue: string
}
interface BarcodeDetectorInstance {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>
}
interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorInstance
  getSupportedFormats?: () => Promise<string[]>
}

function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  return ctor ?? null
}

/** Constraints de cámara: trasera + alta resolución para códigos finos. */
const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: 'environment' },
  width: { ideal: 1920 },
  height: { ideal: 1080 },
}

// torch no está en los tipos estándar de lib.dom; se accede vía capacidades ampliadas.
type CapabilitiesWithTorch = MediaTrackCapabilities & { torch?: boolean }

function buildTorchControls(stream: MediaStream): Pick<ScanController, 'supportsTorch' | 'setTorch'> {
  const track = stream.getVideoTracks()[0]
  const caps = track?.getCapabilities?.() as CapabilitiesWithTorch | undefined
  const supportsTorch = Boolean(caps?.torch)

  return {
    supportsTorch,
    setTorch: async (on: boolean) => {
      if (!track || !supportsTorch) return
      const constraints = { advanced: [{ torch: on }] } as unknown as MediaTrackConstraints
      await track.applyConstraints(constraints)
    },
  }
}

/**
 * Recorta la región central del video a un canvas. Retorna false si el video
 * todavía no tiene dimensiones (no listo). El canvas queda con solo la ROI,
 * de modo que el decodificador nunca ve el resto del frame.
 */
function drawRoiToCanvas(video: HTMLVideoElement, canvas: HTMLCanvasElement): boolean {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return false

  const rw = Math.max(1, Math.round(vw * SCAN_ROI.widthFrac))
  const rh = Math.max(1, Math.round(vh * SCAN_ROI.heightFrac))
  const sx = Math.round((vw - rw) / 2)
  const sy = Math.round((vh - rh) / 2)

  if (canvas.width !== rw) canvas.width = rw
  if (canvas.height !== rh) canvas.height = rh

  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  ctx.drawImage(video, sx, sy, rw, rh, 0, 0, rw, rh)
  return true
}

/** Abre la cámara y la conecta al elemento <video>. */
async function openCameraStream(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS })
  video.srcObject = stream
  await video.play()
  return stream
}

/**
 * Inicia el escaneo sobre el elemento <video> dado.
 * Llama a onResult con el texto crudo cada vez que detecta un código dentro
 * de la ROI. El consumidor debe deduplicar/filtrar (ej. ignorar mientras procesa).
 */
export async function startBarcodeScanning(
  video: HTMLVideoElement,
  onResult: (text: string) => void
): Promise<ScanController> {
  const detectorCtor = getBarcodeDetectorCtor()

  // Confirmar que el motor nativo soporta EAN-13 antes de comprometerse.
  let nativeSupportsEan13 = false
  if (detectorCtor) {
    try {
      const formats = (await detectorCtor.getSupportedFormats?.()) ?? []
      nativeSupportsEan13 = formats.includes(EAN_13)
    } catch {
      nativeSupportsEan13 = false
    }
  }

  if (detectorCtor && nativeSupportsEan13) {
    return startNativeScanning(video, onResult, detectorCtor)
  }
  return startZxingScanning(video, onResult)
}

/** Camino nativo: BarcodeDetector sobre la ROI recortada en canvas. */
async function startNativeScanning(
  video: HTMLVideoElement,
  onResult: (text: string) => void,
  detectorCtor: BarcodeDetectorCtor
): Promise<ScanController> {
  const stream = await openCameraStream(video)
  const detector = new detectorCtor({ formats: [EAN_13] })
  const canvas = document.createElement('canvas')
  let stopped = false

  const loop = async () => {
    if (stopped) return
    if (drawRoiToCanvas(video, canvas)) {
      try {
        const codes = await detector.detect(canvas)
        if (codes.length > 0 && codes[0]?.rawValue) {
          onResult(codes[0].rawValue)
        }
      } catch {
        // Frame no decodificable — continuar en silencio.
      }
    }
    if (!stopped) requestAnimationFrame(() => void loop())
  }
  requestAnimationFrame(() => void loop())

  return {
    engine: 'native',
    stop: () => {
      stopped = true
      stream.getTracks().forEach(t => t.stop())
      video.srcObject = null
    },
    ...buildTorchControls(stream),
  }
}

/** Camino de respaldo: @zxing decodifica la ROI recortada en canvas. */
async function startZxingScanning(
  video: HTMLVideoElement,
  onResult: (text: string) => void
): Promise<ScanController> {
  const hints = new Map<DecodeHintType, unknown>()
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13])
  hints.set(DecodeHintType.TRY_HARDER, true)

  const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 100 })
  const stream = await openCameraStream(video)
  const canvas = document.createElement('canvas')
  let stopped = false

  const loop = () => {
    if (stopped) return
    if (drawRoiToCanvas(video, canvas)) {
      try {
        const result = reader.decodeFromCanvas(canvas)
        if (result) onResult(result.getText())
      } catch {
        // NotFoundException u otro: no hay código en la ROI este frame.
      }
    }
    if (!stopped) setTimeout(loop, 120)
  }
  loop()

  return {
    engine: 'zxing',
    stop: () => {
      stopped = true
      stream.getTracks().forEach(t => t.stop())
      video.srcObject = null
    },
    ...buildTorchControls(stream),
  }
}
