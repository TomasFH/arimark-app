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
      'cash_discount_audits',
      'cebo_entries',
      'merchandise_intakes',
      'merchandise_intake_rubros',
      'merchandise_intake_lines',
      'provider_purchase_prices',
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

    it('tiene inject_reason en expenses (migración 0039)', async () => {
      const { sqlite } = await createInMemoryDb()
      const cols = sqlite.prepare('PRAGMA table_info(expenses)').all() as { name: string }[]
      expect(cols.map(c => c.name)).toContain('inject_reason')
    })

    it('tiene descuento efectivo en stores/sales y tabla de auditoría (migración 0040)', async () => {
      const { sqlite } = await createInMemoryDb()
      const storeCols = sqlite.prepare('PRAGMA table_info(stores)').all() as { name: string }[]
      const saleCols = sqlite.prepare('PRAGMA table_info(sales)').all() as { name: string }[]
      const auditCols = sqlite.prepare('PRAGMA table_info(cash_discount_audits)').all() as { name: string }[]
      expect(storeCols.map(c => c.name)).toEqual(expect.arrayContaining([
        'cash_discount_min_amount',
        'cash_discount_percent',
      ]))
      expect(saleCols.map(c => c.name)).toEqual(expect.arrayContaining([
        'discount_amount',
        'discount_percent',
      ]))
      expect(auditCols.map(c => c.name)).toEqual(expect.arrayContaining([
        'id',
        'store_id',
        'actor_user_id',
        'actor_name',
        'created_at',
        'previous_min_amount',
        'previous_percent',
        'next_min_amount',
        'next_percent',
      ]))
    })

    it('tiene cebo_entries (migración 0041) y sale_id (migración 0048)', async () => {
      const { sqlite } = await createInMemoryDb()
      const cols = sqlite.prepare('PRAGMA table_info(cebo_entries)').all() as { name: string }[]
      expect(cols.map(c => c.name)).toEqual(expect.arrayContaining([
        'id',
        'store_id',
        'shift_id',
        'quantity_kg',
        'notes',
        'created_by',
        'created_at',
        'updated_by',
        'updated_at',
        'synced_at',
        'sale_id',
      ]))
    })

    it('tiene merchandise_intakes (migración 0044)', async () => {
      const { sqlite } = await createInMemoryDb()
      const cols = sqlite.prepare('PRAGMA table_info(merchandise_intakes)').all() as { name: string }[]
      expect(cols.map(c => c.name)).toEqual(expect.arrayContaining([
        'id',
        'store_id',
        'shift_id',
        'notes',
        'payment_kind',
        'paid_amount',
        'debt_amount',
        'provider_id',
        'provider_name',
        'expense_id',
        'created_by',
        'created_at',
        'updated_by',
        'updated_at',
        'synced_at',
      ]))
      expect(cols.map(c => c.name)).not.toContain('category')
    })

    it('tiene handover de caja en shifts y kind en bill_denominations (migración 0042)', async () => {
      const { sqlite } = await createInMemoryDb()
      const shiftCols = sqlite.prepare('PRAGMA table_info(shifts)').all() as { name: string }[]
      const billCols = sqlite.prepare('PRAGMA table_info(bill_denominations)').all() as { name: string }[]
      expect(shiftCols.map(c => c.name)).toEqual(expect.arrayContaining([
        'opening_counted',
        'closing_counted',
        'handover_from_shift_id',
        'handover_from_cashier_name',
        'handover_from_closed_at',
      ]))
      expect(billCols.map(c => c.name)).toContain('kind')
      const indexes = sqlite.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_bill_denoms_shift_kind'",
      ).all() as { name: string }[]
      expect(indexes.length).toBe(1)
    })

    it('tiene rubros y líneas de mercadería (migración 0045)', async () => {
      const { sqlite } = await createInMemoryDb()
      const headerCols = sqlite.prepare('PRAGMA table_info(merchandise_intakes)').all() as { name: string }[]
      const names = headerCols.map(c => c.name)
      expect(names).not.toContain('category')
      expect(names).not.toContain('unit')
      expect(names).not.toContain('quantity')
      expect(names).toEqual(expect.arrayContaining(['payment_kind', 'created_at', 'store_id']))
      const rubros = sqlite.prepare('SELECT COUNT(*) AS n FROM merchandise_intake_rubros').get() as { n: number }
      expect(rubros.n).toBeGreaterThanOrEqual(12)
      const lineCols = sqlite.prepare('PRAGMA table_info(merchandise_intake_lines)').all() as { name: string }[]
      expect(lineCols.map(c => c.name)).toEqual(expect.arrayContaining([
        'intake_id', 'rubro_id', 'net_kg', 'unit_count', 'kg_per_unit', 'weights_json',
      ]))
    })

    it('tiene visita de mercadería y último costo (migración 0046)', async () => {
      const { sqlite } = await createInMemoryDb()
      const productCols = sqlite.prepare('PRAGMA table_info(products)').all() as { name: string }[]
      expect(productCols.map(c => c.name)).toEqual(expect.arrayContaining([
        'purchase_pack_label',
        'purchase_pack_contents',
      ]))
      const headerCols = sqlite.prepare('PRAGMA table_info(merchandise_intakes)').all() as { name: string }[]
      expect(headerCols.map(c => c.name)).toEqual(expect.arrayContaining(['status', 'draft_json']))
      const lineCols = sqlite.prepare('PRAGMA table_info(merchandise_intake_lines)').all() as { name: string }[]
      expect(lineCols.map(c => c.name)).toEqual(expect.arrayContaining([
        'product_id', 'name_key', 'cost_unit', 'unit_cost', 'cost_total', 'pack_count',
      ]))
      const priceCols = sqlite.prepare('PRAGMA table_info(provider_purchase_prices)').all() as { name: string }[]
      expect(priceCols.map(c => c.name)).toEqual(expect.arrayContaining([
        'provider_id', 'product_key', 'unit_cost',
      ]))
    })

    it('tiene discount_exception en sales (migración 0049)', async () => {
      const { sqlite } = await createInMemoryDb()
      const cols = sqlite.prepare('PRAGMA table_info(sales)').all() as { name: string }[]
      expect(cols.map(c => c.name)).toContain('discount_exception')
    })

    it('tiene intake_kind en providers (migración 0047)', async () => {
      const { sqlite } = await createInMemoryDb()
      const cols = sqlite.prepare('PRAGMA table_info(providers)').all() as { name: string }[]
      expect(cols.map(c => c.name)).toContain('intake_kind')
    })

  it('tiene el índice idx_debt_events_customer', async () => {
    const { db } = await createInMemoryDb()
    const indexes = db.all(
      sql`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_debt_events_customer'`
    )
    expect(indexes.length).toBe(1)
  })
})
