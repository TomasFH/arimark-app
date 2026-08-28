import { describe, it, expect } from 'vitest'
import { createInMemoryDb } from './helpers/inMemoryDb'
import { sql } from 'drizzle-orm'

describe('migrations', () => {
  it('aplica todas las migraciones sin error', async () => {
    await expect(createInMemoryDb()).resolves.toBeDefined()
  })

  it('crea todas las tablas esperadas', async () => {
    const { sqlite } = await createInMemoryDb()

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
      'providers',
      'expenses',
      'bill_denominations',
      'stock_entries',
      'orders',
      'employees',
      'employee_vales',
      'attendance',
      'salary_payments',
      'stock_counts',
      'stock_count_items',
    ]

    for (const table of expected) {
      expect(tableNames, `Tabla "${table}" debe existir`).toContain(table)
    }
  })

  it('activa foreign_keys', async () => {
    const { sqlite } = await createInMemoryDb()
    const result = sqlite.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }
    expect(result.foreign_keys).toBe(1)
  })

  it('tiene el índice idx_sales_store', async () => {
    const { db } = await createInMemoryDb()
    const indexes = db.all(
      sql`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_sales_store'`
    )
    expect(indexes.length).toBe(1)
  })

    it('tiene products.updated_at (migración 0025)', async () => {
      const { sqlite } = await createInMemoryDb()
      const cols = sqlite.prepare('PRAGMA table_info(products)').all() as { name: string }[]
      expect(cols.map(c => c.name)).toContain('updated_at')
    })

    it('tiene notes en provider_debt_events (migración 0028)', async () => {
      const { sqlite } = await createInMemoryDb()
      const cols = sqlite.prepare('PRAGMA table_info(provider_debt_events)').all() as { name: string }[]
      expect(cols.map(c => c.name)).toContain('notes')
    })

    it('tiene notes y vales_snapshot en salary_payments (migración 0029)', async () => {
      const { sqlite } = await createInMemoryDb()
      const cols = sqlite.prepare('PRAGMA table_info(salary_payments)').all() as { name: string }[]
      expect(cols.map(c => c.name)).toContain('notes')
      expect(cols.map(c => c.name)).toContain('vales_snapshot')
    })

    it('tiene kind en employees (migración 0030)', async () => {
      const { sqlite } = await createInMemoryDb()
      const cols = sqlite.prepare('PRAGMA table_info(employees)').all() as { name: string }[]
      expect(cols.map(c => c.name)).toContain('kind')
    })

    it('tiene status y updated_at en stock_counts (migración 0031)', async () => {
      const { sqlite } = await createInMemoryDb()
      const cols = sqlite.prepare('PRAGMA table_info(stock_counts)').all() as { name: string }[]
      expect(cols.map(c => c.name)).toContain('status')
      expect(cols.map(c => c.name)).toContain('updated_at')
    })

    it('tiene original_items y last_edited_by en stock_counts (migración 0032)', async () => {
      const { sqlite } = await createInMemoryDb()
      const cols = sqlite.prepare('PRAGMA table_info(stock_counts)').all() as { name: string }[]
      expect(cols.map(c => c.name)).toContain('original_items')
      expect(cols.map(c => c.name)).toContain('last_edited_by')
      expect(cols.map(c => c.name)).toContain('last_edited_at')
    })

  it('tiene el índice idx_debt_events_customer', async () => {
    const { db } = await createInMemoryDb()
    const indexes = db.all(
      sql`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_debt_events_customer'`
    )
    expect(indexes.length).toBe(1)
  })
})
