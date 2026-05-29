import { describe, it, expect } from 'vitest'
import { createInMemoryDb } from './helpers/inMemoryDb'
import { sql } from 'drizzle-orm'

describe('migrations', () => {
  it('aplica todas las migraciones sin error', () => {
    expect(() => createInMemoryDb()).not.toThrow()
  })

  it('crea todas las tablas esperadas', () => {
    const { sqlite } = createInMemoryDb()

    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations'")
      .all() as { name: string }[]

    const tableNames = tables.map(t => t.name)

    const expected = [
      'stores',
      'users',
      'admin_devices',
      'products',
      'store_products',
      'product_prices',
      'customers',
      'customer_prices',
      'shifts',
      'sales',
      'sale_items',
      'sale_payments',
      'scale_tickets',
      'debt_events',
      'pending_fiscal_payments',
      'expenses',
      'bill_denominations',
      'stock_entries',
      'orders',
      'employees',
      'employee_advances',
      'attendance',
    ]

    for (const table of expected) {
      expect(tableNames, `Tabla "${table}" debe existir`).toContain(table)
    }
  })

  it('activa foreign_keys', () => {
    const { sqlite } = createInMemoryDb()
    const result = sqlite.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }
    expect(result.foreign_keys).toBe(1)
  })

  it('tiene el índice idx_sales_store', () => {
    const { db } = createInMemoryDb()
    const indexes = db.all(
      sql`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_sales_store'`
    )
    expect(indexes.length).toBe(1)
  })

  it('tiene el índice idx_debt_events_customer', () => {
    const { db } = createInMemoryDb()
    const indexes = db.all(
      sql`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_debt_events_customer'`
    )
    expect(indexes.length).toBe(1)
  })
})
