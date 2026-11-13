/**
 * Geometría de la torta. El trazo lo pinta cada app con los tokens que ya tiene.
 * Ángulo 0 arriba, sentido horario. Fracción 1 es el círculo entero.
 */

function polar(cx: number, cy: number, radius: number, turn: number): [number, number] {
  const angle = (turn - 0.25) * Math.PI * 2
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]
}

function round(value: number): string {
  return (Math.round(value * 1000) / 1000).toString()
}

/** Anillo entre outer e inner. start/end son vueltas 0–1, end > start. */
export function donutSlicePath(
  outer: number,
  inner: number,
  start: number,
  end: number,
): string {
  const span = end - start
  if (span <= 0) return ''
  if (span >= 0.999) {
    return [
      donutSlicePath(outer, inner, 0, 0.5),
      donutSlicePath(outer, inner, 0.5, 0.999),
    ].join(' ')
  }
  const [ox0, oy0] = polar(0, 0, outer, start)
  const [ox1, oy1] = polar(0, 0, outer, end)
  const [ix0, iy0] = polar(0, 0, inner, start)
  const [ix1, iy1] = polar(0, 0, inner, end)
  const large = span > 0.5 ? 1 : 0
  return [
    `M ${round(ox0)} ${round(oy0)}`,
    `A ${outer} ${outer} 0 ${large} 1 ${round(ox1)} ${round(oy1)}`,
    `L ${round(ix1)} ${round(iy1)}`,
    `A ${inner} ${inner} 0 ${large} 0 ${round(ix0)} ${round(iy0)}`,
    'Z',
  ].join(' ')
}

export function donutSlices(
  fractions: number[],
  outer = 40,
  inner = 24,
): string[] {
  const usable = fractions.map(value => (Number.isFinite(value) && value > 0 ? value : 0))
  const total = usable.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return []
  let cursor = 0
  return usable.map(value => {
    if (value <= 0) return ''
    const start = cursor / total
    cursor += value
    const end = cursor / total
    return donutSlicePath(outer, inner, start, Math.min(end, 0.9999))
  })
}
