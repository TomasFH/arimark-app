import type { ProductRow, SaleItemDraft } from '../types/hw-api'

type BagLine = {
  productId: string | null
  weightKg: number
  unitPrice: number
  subtotal: number
  unit: 'kg' | 'unit'
}

/** Ítem de bolsa con el precio de lista. Sin precio, no inventa uno. */
export function addBagItem(product: ProductRow, quantity: number): SaleItemDraft | null {
  if (product.category !== 'bags') return null
  const price = product.price
  if (price == null || price <= 0) return null
  const qty = product.unit === 'unit' ? Math.round(quantity) : quantity
  if (!Number.isFinite(qty) || qty <= 0) return null
  return {
    pluNumber: product.pluNumber,
    productId: product.id,
    productName: product.name,
    unit: product.unit,
    weightKg: qty,
    unitPrice: price,
    subtotal: Math.round(qty * price),
    manualEntry: false,
  }
}

/**
 * Suma bolsas del mismo producto en un solo renglón.
 * Otro producto, aunque también sea bolsa, queda en su propia línea.
 */
export function addBagToCart<T extends BagLine & { localId: string }>(
  items: readonly T[],
  product: ProductRow,
  quantity: number,
  localId: string,
): T[] {
  const addition = addBagItem(product, quantity)
  if (!addition) return [...items]

  const firstIndex = items.findIndex(item => item.productId === product.id)
  if (firstIndex < 0) {
    return [...items, { ...addition, localId } as T]
  }

  let qty = addition.weightKg
  for (const item of items) {
    if (item.productId === product.id) qty += item.weightKg
  }
  const unit = items[firstIndex]?.unit ?? addition.unit
  const rounded = unit === 'unit' ? Math.round(qty) : qty
  const merged = {
    ...items[firstIndex],
    weightKg: rounded,
    unitPrice: addition.unitPrice,
    subtotal: Math.round(rounded * addition.unitPrice),
  } as T

  let placed = false
  const next: T[] = []
  for (const item of items) {
    if (item.productId !== product.id) {
      next.push(item)
      continue
    }
    if (!placed) {
      next.push(merged)
      placed = true
    }
  }
  return next
}

/** Junta renglones repetidos del mismo tipo de bolsa. Otro tipo queda aparte. */
export function collapseDuplicateBags<T extends BagLine & { localId: string }>(
  items: readonly T[],
  bagIds: ReadonlySet<string>,
): T[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    if (!item.productId || !bagIds.has(item.productId)) continue
    counts.set(item.productId, (counts.get(item.productId) ?? 0) + 1)
  }
  if (![...counts.values()].some(count => count > 1)) return items as T[]

  const seen = new Set<string>()
  const next: T[] = []
  for (const item of items) {
    if (!item.productId || !bagIds.has(item.productId)) {
      next.push(item)
      continue
    }
    if (seen.has(item.productId)) continue
    seen.add(item.productId)
    let qty = 0
    for (const line of items) {
      if (line.productId === item.productId) qty += line.weightKg
    }
    const rounded = item.unit === 'unit' ? Math.round(qty) : qty
    next.push({
      ...item,
      weightKg: rounded,
      subtotal: Math.round(rounded * item.unitPrice),
    })
  }
  return next
}

/** Saca cantidad de un producto del carrito, desde la última línea. */
export function removeBagQuantity<T extends BagLine>(
  items: readonly T[],
  productId: string,
  quantity: number,
): T[] {
  let left = quantity
  if (!Number.isFinite(left) || left <= 0) return [...items]
  const next = items.map(item => ({ ...item }))
  for (let i = next.length - 1; i >= 0 && left > 0.0005; i--) {
    const item = next[i]
    if (!item || item.productId !== productId) continue
    if (item.weightKg <= left + 0.0005) {
      left -= item.weightKg
      next.splice(i, 1)
      continue
    }
    const qty = item.unit === 'unit'
      ? Math.max(0, Math.round(item.weightKg - left))
      : item.weightKg - left
    left = 0
    if (qty <= 0.0005) {
      next.splice(i, 1)
      continue
    }
    next[i] = { ...item, weightKg: qty, subtotal: Math.round(qty * item.unitPrice) }
  }
  return next
}

export function bagQuantityInCart(items: readonly BagLine[], productId: string): number {
  return items.reduce((sum, item) => (
    item.productId === productId ? sum + item.weightKg : sum
  ), 0)
}
