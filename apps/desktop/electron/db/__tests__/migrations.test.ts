import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { createInMemoryDb } from './helpers/inMemoryDb'
import { sql } from 'drizzle-orm'
import {
  stores,
  users,
  shifts,
  expenses,
  providerDebtEvents,
  merchandiseIntakes,
  merchandiseIntakeLines,
  providers,
  providerPurchasePrices,
  products,
} from '../schema'

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

  it('suma la deuda vieja pagada al gasto y no toca pay-from-shift (migración 0050)', async () => {
    const { db, sqlite } = await createInMemoryDb()
    const now = '2026-10-11T12:00:00.000Z'
    db.insert(stores).values({ id: 'store-001', name: 'Local 1', createdAt: now }).run()
    db.insert(users).values({ id: 'user-001', name: 'Cajera', storeId: 'store-001', createdAt: now }).run()
    db.insert(shifts).values({
      id: 'shift-001',
      storeId: 'store-001',
      userId: 'user-001',
      shiftType: 'morning',
      startedAt: now,
      openingCash: 10_040_001,
      source: 'desktop',
    }).run()

    db.insert(expenses).values([
      {
        id: 'exp-visit',
        storeId: 'store-001',
        shiftId: 'shift-001',
        amount: 100_000,
        createdAt: now,
        createdBy: 'user-001',
        syncedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'exp-pay-shift',
        storeId: 'store-001',
        shiftId: 'shift-001',
        amount: 350_000,
        createdAt: now,
        createdBy: 'user-001',
        syncedAt: '2026-02-01T00:00:00.000Z',
      },
      {
        id: 'exp-intake',
        storeId: 'store-001',
        shiftId: 'shift-001',
        amount: 5_000,
        createdAt: now,
        createdBy: 'user-001',
        syncedAt: '2026-03-01T00:00:00.000Z',
      },
      {
        id: 'exp-with-debt',
        storeId: 'store-001',
        shiftId: 'shift-001',
        amount: 20_000,
        createdAt: now,
        createdBy: 'user-001',
        syncedAt: '2026-04-01T00:00:00.000Z',
      },
      {
        id: 'exp-plain',
        storeId: 'store-001',
        shiftId: 'shift-001',
        amount: 1_000,
        createdAt: now,
        createdBy: 'user-001',
        syncedAt: '2026-05-01T00:00:00.000Z',
      },
    ]).run()

    db.insert(providerDebtEvents).values([
      {
        id: 'pay-visit',
        storeId: 'store-001',
        provider: 'Guido',
        type: 'payment',
        amount: 2_634_642,
        expenseId: 'exp-visit',
        shiftId: 'shift-001',
        createdAt: now,
        createdBy: 'user-001',
      },
      {
        id: 'pay-shift-a',
        storeId: 'store-001',
        provider: 'Guido',
        type: 'payment',
        amount: 50_000,
        expenseId: 'exp-pay-shift',
        shiftId: 'shift-001',
        createdAt: now,
        createdBy: 'user-001',
      },
      {
        id: 'pay-shift-b',
        storeId: 'store-001',
        provider: 'Guido',
        type: 'payment',
        amount: 300_000,
        expenseId: 'exp-pay-shift',
        shiftId: 'shift-001',
        createdAt: now,
        createdBy: 'user-001',
      },
      {
        id: 'pay-intake',
        storeId: 'store-001',
        provider: 'Guido',
        type: 'payment',
        amount: 5_000,
        expenseId: 'exp-intake',
        shiftId: 'shift-001',
        createdAt: now,
        createdBy: 'user-001',
      },
      {
        id: 'debt-with',
        storeId: 'store-001',
        provider: 'Guido',
        type: 'debt',
        amount: 5_000,
        expenseId: 'exp-with-debt',
        shiftId: 'shift-001',
        createdAt: now,
        createdBy: 'user-001',
      },
      {
        id: 'pay-with-debt',
        storeId: 'store-001',
        provider: 'Guido',
        type: 'payment',
        amount: 20_000,
        expenseId: 'exp-with-debt',
        shiftId: 'shift-001',
        createdAt: now,
        createdBy: 'user-001',
      },
    ]).run()

    db.insert(merchandiseIntakes).values({
      id: 'intake-1',
      storeId: 'store-001',
      shiftId: 'shift-001',
      paymentKind: 'paid_now',
      paidAmount: 5_000,
      debtAmount: 0,
      expenseId: 'exp-intake',
      status: 'confirmed',
      createdBy: 'user-001',
      createdAt: now,
    }).run()

    const migrationSql = fs.readFileSync(
      path.resolve(__dirname, '../../../drizzle/0050_expense_old_debt_cash.sql'),
      'utf8',
    )
    sqlite.exec(migrationSql)

    const rows = sqlite.prepare(
      'SELECT id, amount, synced_at AS syncedAt FROM expenses ORDER BY id',
    ).all() as Array<{ id: string; amount: number; syncedAt: string | null }>
    const byId = new Map(rows.map(row => [row.id, row]))

    expect(byId.get('exp-visit')).toMatchObject({ amount: 2_734_642, syncedAt: null })
    expect(byId.get('exp-pay-shift')).toMatchObject({
      amount: 350_000,
      syncedAt: '2026-02-01T00:00:00.000Z',
    })
    expect(byId.get('exp-intake')).toMatchObject({ amount: 10_000, syncedAt: null })
    expect(byId.get('exp-with-debt')).toMatchObject({ amount: 40_000, syncedAt: null })
    expect(byId.get('exp-plain')).toMatchObject({
      amount: 1_000,
      syncedAt: '2026-05-01T00:00:00.000Z',
    })
  })

  it('pasa unit_cost de compra a REAL sin reescalar (migración 0051)', async () => {
    const { db, sqlite } = await createInMemoryDb()
    const now = '2026-10-11T12:00:00.000Z'
    db.insert(stores).values({ id: 'store-001', name: 'Local 1', createdAt: now }).run()
    db.insert(users).values({ id: 'user-001', name: 'Cajera', storeId: 'store-001', createdAt: now }).run()
    db.insert(shifts).values({
      id: 'shift-001',
      storeId: 'store-001',
      userId: 'user-001',
      shiftType: 'morning',
      startedAt: now,
      openingCash: 0,
      source: 'desktop',
    }).run()
    db.insert(merchandiseIntakes).values({
      id: 'intake-1',
      storeId: 'store-001',
      shiftId: 'shift-001',
      paymentKind: 'paid_now',
      paidAmount: 9_000,
      debtAmount: 0,
      status: 'confirmed',
      createdBy: 'user-001',
      createdAt: now,
    }).run()
    db.insert(merchandiseIntakeLines).values({
      id: 'line-1',
      intakeId: 'intake-1',
      rubroId: 'rubro_bondiola',
      rubroName: 'Bondiola',
      template: 'weight',
      sortOrder: 0,
      count: 1,
      hasIce: false,
      unitCost: 9000,
      costTotal: 9000,
    }).run()
    db.insert(providers).values({
      id: 'prov-1',
      name: 'Oso',
      nameKey: 'oso',
      createdAt: now,
      createdBy: 'user-001',
    }).run()
    db.insert(providerPurchasePrices).values({
      providerId: 'prov-1',
      productKey: 'p:bondiola',
      name: 'Bondiola',
      costUnit: 'kg',
      unitCost: 4800.5,
      updatedAt: now,
    }).run()

    const migrationSql = fs.readFileSync(
      path.resolve(__dirname, '../../../drizzle/0051_purchase_unit_cost_cents.sql'),
      'utf8',
    ).replaceAll('--> statement-breakpoint', '')
    expect(migrationSql).not.toMatch(/unit_cost\s*[*\/]\s*100/)
    sqlite.exec(migrationSql)

    const lineCols = sqlite.prepare('PRAGMA table_info(merchandise_intake_lines)').all() as Array<{ name: string; type: string }>
    expect(lineCols.find(c => c.name === 'unit_cost')?.type.toUpperCase()).toBe('REAL')
    expect(lineCols.find(c => c.name === 'cost_total')?.type.toUpperCase()).toBe('INTEGER')
    const priceCols = sqlite.prepare('PRAGMA table_info(provider_purchase_prices)').all() as Array<{ name: string; type: string }>
    expect(priceCols.find(c => c.name === 'unit_cost')?.type.toUpperCase()).toBe('REAL')
    const intakeCols = sqlite.prepare('PRAGMA table_info(merchandise_intakes)').all() as Array<{ name: string; type: string }>
    expect(intakeCols.find(c => c.name === 'paid_amount')?.type.toUpperCase()).toBe('INTEGER')
    expect(intakeCols.find(c => c.name === 'debt_amount')?.type.toUpperCase()).toBe('INTEGER')

    const line = sqlite.prepare('SELECT unit_cost AS unitCost, cost_total AS costTotal FROM merchandise_intake_lines').get() as {
      unitCost: number
      costTotal: number
    }
    expect(line.unitCost).toBe(9000)
    expect(line.costTotal).toBe(9000)
    const price = sqlite.prepare('SELECT unit_cost AS unitCost FROM provider_purchase_prices').get() as { unitCost: number }
    expect(price.unitCost).toBe(4800.5)
    const intake = sqlite.prepare('SELECT paid_amount AS paidAmount FROM merchandise_intakes').get() as { paidAmount: number }
    expect(intake.paidAmount).toBe(9000)
  })

  it('agrega forma de compra e idempotencia (migración 0052)', async () => {
    const { sqlite } = await createInMemoryDb()
    const priceCols = sqlite.prepare('PRAGMA table_info(provider_purchase_prices)').all() as { name: string }[]
    const lineCols = sqlite.prepare('PRAGMA table_info(merchandise_intake_lines)').all() as { name: string }[]
    const intakeCols = sqlite.prepare('PRAGMA table_info(merchandise_intakes)').all() as { name: string }[]
    expect(priceCols.map(c => c.name)).toEqual(expect.arrayContaining(['pack_contents', 'weigh_mode']))
    expect(lineCols.map(c => c.name)).toEqual(expect.arrayContaining(['weigh_mode', 'money_role', 'not_for_sale']))
    expect(intakeCols.map(c => c.name)).toEqual(expect.arrayContaining(['client_request_id', 'payment_channel']))
  })

  it('agrega el peso de referencia por unidad (migración 0053)', async () => {
    const { sqlite } = await createInMemoryDb()
    const cols = sqlite.prepare('PRAGMA table_info(product_piece_weights)').all() as { name: string }[]
    expect(cols.map(c => c.name)).toEqual(expect.arrayContaining(['product_id', 'kg_per_unit', 'updated_at']))
  })

  it('agrega el concepto recordado de insumos (migración 0054)', async () => {
    const { sqlite } = await createInMemoryDb()
    const cols = sqlite.prepare('PRAGMA table_info(providers)').all() as { name: string }[]
    expect(cols.map(c => c.name)).toContain('supply_concept')
  })

  it('enlaza ofertas al corte suelto por PLU (migración 0055)', async () => {
    const { db, sqlite } = await createInMemoryDb()
    const cols = sqlite.prepare('PRAGMA table_info(products)').all() as { name: string }[]
    expect(cols.map(c => c.name)).toContain('base_product_id')

    const now = '2026-01-01T00:00:00.000Z'
    const row = (id: string, name: string, plu: number, category: 'beef_cut' | 'pork' = 'beef_cut') => ({
      id,
      name,
      category,
      unit: 'kg' as const,
      pluNumber: plu,
      active: true,
      createdAt: now,
    })
    db.insert(products).values([
      row('asado', 'Asado', 1),
      row('pack', 'Asado x2kg', 301),
      row('vacio', 'Vacío', 4),
      row('vacio-pack', 'Vacío x2kg', 303),
      row('vacio-pieza', 'Vacío pieza entera', 401),
      row('bondiola', 'Bondiola', 154, 'pork'),
      row('bondiola-u', 'Bondiola c/3 u. $/kg', 341, 'pork'),
      row('bondiola-x2', 'Bondiola x2kg', 342, 'pork'),
      row('puchero', 'Falda puchero x2kg', 313),
      row('bola', 'Bola/cuadrada pieza', 406),
      row('rinonada', 'Riñonada', 24),
      row('tapa-pack', 'Tapa de asado x2kg', 302),
    ]).run()

    const migrationSql = fs.readFileSync(
      path.resolve(__dirname, '../../../drizzle/0055_product_base_product.sql'),
      'utf8',
    )
    const updateSql = migrationSql.split('--> statement-breakpoint')[1]?.trim()
    expect(updateSql).toMatch(/^WITH links/)
    sqlite.exec(updateSql!)
    sqlite.exec(updateSql!)

    const linked = (id: string) => sqlite.prepare(
      'SELECT base_product_id AS base FROM products WHERE id = ?',
    ).get(id) as { base: string | null }

    expect(linked('pack').base).toBe('asado')
    expect(linked('vacio-pack').base).toBe('vacio')
    expect(linked('vacio-pieza').base).toBe('vacio')
    expect(linked('bondiola-u').base).toBe('bondiola')
    expect(linked('bondiola-x2').base).toBe('bondiola')
    expect(linked('asado').base).toBeNull()
    expect(linked('vacio').base).toBeNull()
    expect(linked('bondiola').base).toBeNull()
    expect(linked('puchero').base).toBeNull()
    expect(linked('bola').base).toBeNull()
    expect(linked('rinonada').base).toBeNull()
    expect(linked('tapa-pack').base).toBeNull()
  })

  it('tiene el índice idx_debt_events_customer', async () => {
    const { db } = await createInMemoryDb()
    const indexes = db.all(
      sql`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_debt_events_customer'`
    )
    expect(indexes.length).toBe(1)
  })
})
