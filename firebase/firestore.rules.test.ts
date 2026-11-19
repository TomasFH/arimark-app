/**
 * Prueba mínima del emulador contra las reglas vigentes.
 * Los casos por rol se agregan en el paso siguiente.
 * No publica nada: corre solo con `pnpm test:rules`.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, it } from 'vitest'
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc } from 'firebase/firestore'

const rulesPath = fileURLToPath(new URL('./firestore.rules', import.meta.url))

describe('emulador de reglas', () => {
  let env: RulesTestEnvironment

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-carniceria',
      firestore: {
        rules: readFileSync(rulesPath, 'utf8'),
      },
    })
  })

  afterAll(async () => {
    await env.cleanup()
  })

  it('sin sesión no lee un turno', async () => {
    const db = env.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, 'licenses/lic-a/shifts/s1')))
  })
})
