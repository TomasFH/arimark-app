/**
 * Cifra los DNI y teléfonos heredados que se hubieran guardado antes de que
 * existiera la protección de campos. Es idempotente y corre tras migraciones.
 */
import { getDb } from '../db/client'
import { customers } from '../db/schema'
import { eq } from 'drizzle-orm'
import log from 'electron-log'
import { encryptCustomerIdentifier } from './customerDataEncryption'

function needsEncryption(value: string | null): value is string {
  return Boolean(value && !value.startsWith('enc:v1:'))
}

export function encryptLegacyCustomerIdentifiers(): void {
  const db = getDb()
  const rows = db.select({
    id: customers.id,
    dni: customers.dni,
    phone: customers.phone,
  }).from(customers).all()

  let migrated = 0
  db.transaction(() => {
    for (const row of rows) {
      if (!needsEncryption(row.dni) && !needsEncryption(row.phone)) continue
      db.update(customers)
        .set({
          dni: needsEncryption(row.dni) ? encryptCustomerIdentifier(row.dni) : row.dni,
          phone: needsEncryption(row.phone) ? encryptCustomerIdentifier(row.phone) : row.phone,
        })
        .where(eq(customers.id, row.id))
        .run()
      migrated += 1
    }
  })

  if (migrated > 0) {
    log.info('[privacy] Identificadores de clientes cifrados', { migrated })
  }
}
