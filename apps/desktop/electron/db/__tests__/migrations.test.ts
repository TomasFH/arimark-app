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
      'catalog_audit_events',
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

    it('tiene kind en expenses (migración 0033)', async () => {
      const { sqlite } = await createInMemoryDb()
      const cols = sqlite.prepare('PRAGMA table_info(expenses)').all() as { name: string }[]
      expect(cols.map(c => c.name)).toContain('kind')
    })

    it('tiene columnas de catalog_audit_events (migración 0035)', async () => {
      const { sqlite } = await createInMemoryDb()
      const cols = sqlite.prepare('PRAGMA table_info(catalog_audit_events)').all() as { name: string }[]
      const names = cols.map(c => c.name)
      expect(names).toEqual(expect.arrayContaining([
        'id',
        'product_id',
        'store_id',
        'action',
        'actor_user_id',
        'summary',
        'created_at',
      ]))
    })

    it('tiene home_store_id en employees y store_id en attendance (migración 0034)', async () => {
      const { sqlite } = await createInMemoryDb()
      const empCols = sqlite.prepare('PRAGMA table_info(employees)').all() as { name: string }[]
      const attCols = sqlite.prepare('PRAGMA table_info(attendance)').all() as { name: string }[]
      expect(empCols.map(c => c.name)).toContain('home_store_id')
      expect(attCols.map(c => c.name)).toContain('store_id')
    })

    it('tiene ready_at/ready_by/budget_items en orders (migración 0036)', async () => {
      const { sqlite } = await createInMemoryDb()
      const cols = sqlite.prepare('PRAGMA table_info(orders)').all() as { name: string }[]
      const names = cols.map(c => c.name)
      expect(names).toContain('ready_at')
      expect(names).toContain('ready_by')
      expect(names).toContain('ready_by_name')
      expect(names).toContain('budget_items')
    })

    it('tiene firebase_uid en employees (migración 0037)', async () => {
      const { sqlite } = await createInMemoryDb()
      const cols = sqlite.prepare('PRAGMA table_info(employees)').all() as { name: string }[]
      expect(cols.map(c => c.name)).toContain('firebase_uid')
    })

    it('tiene hours_schedule en stores (migración 0038)', async () => {
      const { sqlite } = await createInMemoryDb()
      const cols = sqlite.prepare('PRAGMA table_info(stores)').all() as { name: string }[]
      expect(cols.map(c => c.name)).toContain('hours_schedule')
    })

  it('tiene el índice idx_debt_events_customer', async () => {
    const { db } = await createInMemoryDb()
    const indexes = db.all(
      sql`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_debt_events_customer'`
    )
    expect(indexes.length).toBe(1)
  })
})
