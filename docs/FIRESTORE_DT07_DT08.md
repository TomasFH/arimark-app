# DT-07 / DT-08 — Checkpoint de deuda y recortes Spark

Fecha del código: 2026-09-04.
Auditoría de partida: `firestore-audit.md` (diagnóstico, no se reescribió).
Producto: `PLAN.md` DT-07 y DT-08.

Este documento describe **qué se encontró**, **qué se implementó** y **qué falta para producción**. No sustituye el principio de Spark en `AGENTS.md` ni el diagnóstico línea a línea de la auditoría.

Spark (plan gratis): **50.000 lecturas/día**, **20.000 escrituras/día**. Si se pasa el cupo, **corta** el sync hasta el día siguiente; no factura.

---

## 1. Auditoría (2026-09-04)

Se recorrió el código de producción (`apps/desktop/electron`, `apps/mobile/src`) para listar cada `getDocs` / `onSnapshot` / `setDoc` y marcar si bajaba una colección que **crece todos los días**.

Hallazgos que movieron esta oleada:

1. **Listeners permanentes sobre ledgers enteros** (`providerDebtEvents`, `customerDebtEvents`, `orders` históricos). Cada login/PC cobraba N lecturas del archivo completo.
2. **Historial admin (PC remota y celu)** pedía varias colecciones enteras y filtraba fechas en memoria. Abrir “el martes” bajaba enero–agosto.
3. **Lista de proveedores con deuda** (PC) hacía `getDocs` de todo `providerDebtEvents`.
4. **Reconcile de turnos** bajaba todos los `shifts` del local/usuario/tenant.
5. **Import móvil** releía las 4 subcolecciones hijas enteras de cada turno abierto.

El catálogo **ya estaba bien**: 1 documento por local, no 1 por producto.

Detalle tabla por archivo: `firestore-audit.md`. Ese archivo es una foto del código **antes** de los recortes; varias filas de ahí ya no aplican.

---

## 2. Principio (igual que DT-08)

Las personas que usan la app no dosifican clics ni saben qué es Firebase. Si el uso normal (o un mash humano de ↻) puede agotar Spark, **la consulta está mal**.

- Colecciones chicas (`stores`, `employees`, `providers` fichas, `catalog/{storeId}`): `getDocs` / `onSnapshot` de la colección está bien.
- Colecciones que crecen (`sales`, `shifts`, `expenses`, `orders`, `providerDebtEvents`, `customerDebtEvents`, `employeeVales`): **prohibido** bajarlas enteras. Pedir por turno, fecha, estado activo o página.
- Los eventos **no se borran**. Lo que no se hace es **bajarlos** hasta que alguien pide ese recorte.
- El celu no es el archivo histórico.

---

## 3. Checkpoint de saldo (DT-07, y fiados con el mismo patrón)

El saldo vigente **no** se arma recorriendo todo el ledger. Un documento por **(entidad + local)**:

```
licenses/{tenant}/providerDebtCheckpoints/{entityId}__{storeId}
licenses/{tenant}/customerDebtCheckpoints/{entityId}__{storeId}
```

Campos:

| Campo | Significado |
|---|---|
| `kind` | `provider` \| `customer` |
| `entityId` / `storeId` | par |
| `saldoAcumulado` | suma ya plegada |
| `checkpointAt` | Timestamp de servidor del **último evento plegado** (frontera). No es `serverTimestamp()` del momento de la transacción. |
| `foldedCount` | cuántos eventos ya consumió esa frontera |
| `updatedAt` | `serverTimestamp()` de la última escritura del doc |

Saldo en vivo = `saldoAcumulado` + eventos con `createdAtServer` **estrictamente posterior** a `checkpointAt`.

### Relojes

- `createdAt` (ISO del cliente): día de negocio, lo que se muestra en pantalla.
- `createdAtServer` (Timestamp de servidor): único campo para ordenar, plegar y armar la cola. Los writes nuevos lo ponen con `serverTimestamp()`.

### Margen de 5 días

No se pliegan eventos con `createdAtServer > now − 5 días`. Cubre sync offline: un gasto de ayer puede subir hoy con Timestamp de servidor de hoy; no debe quedar detrás de un checkpoint escrito anoche.

### Deleted

Un evento `deleted: true` **no** cambia el saldo, **sí** mueve la frontera. Si no, el job relería el mismo doc para siempre.

### Transacción (`advanceDebtCheckpoint`)

Firestore no permite queries dentro de `runTransaction`.

1. Query **fuera** del tx: eventos del par con `createdAtServer > checkpointAt` y `<= now−5d`, `orderBy` + `limit 400`.
2. Tx: relee el checkpoint; si la frontera cambió, conflicto y reintento. Relee cada evento candidato (lock). Pliega. Escribe el checkpoint.

Eventos **sin** `createdAtServer` no se pliegan ni entran a la cola en vivo.

Lógica pura (sin Firebase): `packages/shared/src/debtCheckpoint.ts`.
Main Electron: `apps/desktop/electron/licensing/debtCheckpoint.ts`.

Constantes:

| Constante | Valor |
|---|---|
| `CHECKPOINT_FOLD_LIMIT` | 400 eventos / pasada |
| `CHECKPOINT_JOB_MAX_PASSES` | 8 pasadas / corrida |
| `CHECKPOINT_JOB_MAX_READS` | ~4000 lecturas estimadas / corrida |
| `CHECKPOINT_JOB_MIN_INTERVAL_MS` | 20 h |
| `CHECKPOINT_LEASE_MS` | 15 min |
| `CHECKPOINT_SAFETY_MS` | 5 días |

El backlog que no entra en el tope espera a la corrida siguiente. Importante la primera vez después del backfill, si un par tuviera miles de eventos.

---

## 4. Worklist y job único (desktop)

No se recorren “todos los proveedores/clientes”. Solo pares con **actividad pendiente real**.

Cola: `licenses/{tenant}/debtCheckpointTails/{entityId}__{storeId}`  
Campos: `kind`, `entityId`, `storeId`, `firstEventAt`, `lastEventAt`.

Cada write de evento (PC y celu) hace `touchDebtCheckpointTail`.

Un par entra al worklist si:

- hay tail (`firstEventAt` y `lastEventAt`);
- el último evento es posterior al checkpoint;
- el primero es anterior o igual al corte de 5 días;
- un probe `limit 1` confirma que hay algo compactable (evita noops).

**Quién corre el job:** solo el proceso main de una PC. El celu **nunca** llama `advanceDebtCheckpoint`.

Lease en `licenses/{tenant}/ops/debtCheckpointJob`. Holder = UID anónimo de la instalación. Si otra PC tiene el lease vigente, esta salta. Intervalo mínimo 20 h entre corridas exitosas.

Arranque: login admin o cajera (`auth.handler.ts` → `startDebtCheckpointJob` + `startDebtBalanceLiveSync`). Logout lo detiene.

Código: `apps/desktop/electron/licensing/debtCheckpointJob.ts`, `debtCheckpointTail.ts`.

---

## 5. Listener padre/hijo de saldo

Padre: `onSnapshot` de checkpoints (y tails sin checkpoint todavía).  
Hijo: eventos del par con `createdAtServer > checkpointAt`.

Si cambia la frontera: **unsub del hijo, vaciar la cola, generation++**. Nunca se combina un checkpoint nuevo con eventos de la query anterior (doble conteo).

PC: `apps/desktop/electron/licensing/debtBalanceLive.ts`  
Celu: `apps/mobile/src/lib/debtBalanceLive.ts`

La lista admin de proveedores con deuda (`GET_PROVIDERS_WITH_DEBT`) usa ese cache (o, si el listener aún no listó, los docs de checkpoint). **Ya no** baja `providerDebtEvents` entero. Se mezclan eventos locales con `syncedAt=null`.

Pantallas móviles de Proveedores / Fiados: saldos por este listener; el detalle de un seleccionado sigue pidiendo eventos de **ese** id (`where providerId` / `where customerId`).

---

## 6. Recortes de queries (DT-08)

| Superficie | Antes (auditoría) | Ahora |
|---|---|---|
| Pedidos PC (`orderSync`) | `onSnapshot` / pull de toda `orders` | `status in ['pending','ready']`. Un pedido que sale de esos estados se lee con `getDoc`. |
| Pedidos celu admin | colección entera | misma query `pending`/`ready`. |
| Turnos (`shiftSync` reconcile) | todos los shifts del filtro | `closedAt == null` + `getDoc` de los turnos **locales abiertos** que no vinieron en el query (para aplicar un cierre remoto). |
| Staging móvil (`mobileSync`) | 4 `getDocs` de hijos enteros por turno | hijos con `importedAt == null`; al importar, `updateDoc({ importedAt })`. El create móvil escribe `importedAt: null`. |
| Historial PC remota | 5 colecciones enteras | `shifts` por `startedAt` (default **últimos 7 días**) y opcional `storeId`; totales por `shiftId in (...)` (chunks de 30). |
| Historial celu | `sales`/`expenses` enteras al abrir un turno | turnos por fecha; ventas/gastos/deudas por `shiftId`. |
| Vales PC remota | `employeeVales` + **todos** los `shifts` para resolver `storeId` | query por `storeId` si hay filtro; docs viejos **sin** `storeId` no aparecen en el filtro por local. |
| Restaurar/purgar proveedor (celu) | `getDocs` de todo el ledger | `where providerId == id`. |

UI Historial (PC y celu): rango default últimos 7 días.

Índices compuestos en `firebase/firestore.indexes.json` (deuda: `entityId+storeId+createdAtServer`; turnos: `storeId+startedAt`, `storeId+closedAt`, `userId+closedAt`; más orders/vales/salary del carnicero).

Reglas nuevas: `debtCheckpointTails/{id}` y `ops/{id}` en `firebase/firestore.rules`.

---

## 7. Backfill de `createdAtServer`

Los eventos viejos no tienen el campo. Sin él, el job no pliega y el listener de cola ve vacío → saldo 0.

Script: `apps/desktop/scripts/backfillCreatedAtServer.mjs`  
Default: **dry-run** (solo lectura). `--apply` escribe.

Regla (misma que `planCreatedAtServerBackfill` en shared):

1. Si ya hay `createdAtServer` → skip.
2. Si `createdAt` es ISO parseable → Timestamp de **ese** instante (reloj de negocio, no `now`).
3. Si no, campo viejo `date`.
4. Si no hay nada parseable → **se deja sin campo** (no entra a checkpoint ni a la cola).

Dry-run contra `arimark-001` (2026-09-04):

| | |
|---|---|
| Docs leídos | 129 (105 proveedor + 24 cliente) |
| Assign desde `createdAt` | 127 |
| Assign desde `date` | 2 |
| Leave-unset | **0** |
| Tails a armar | 14 pares |

Los dos que caen a `date`:

- `095c63f1-c527-4c63-b43c-2df4489c9f1f` → `2026-08-18T08:18:17.377Z`
- `31487fdd-87bb-4738-8f95-2ecbb2950951` → `2026-08-18T08:19:04.426Z`

**`--apply` no se corrió.** Tampoco se hizo `mobile:deploy` a propósito: sin el campo, el saldo en vivo saldría 0.

---

## 8. Archivos tocados (mapa)

| Área | Archivos |
|---|---|
| Reglas de fold / backfill / worklist | `packages/shared/src/debtCheckpoint.ts` |
| Avance + job + tail + listener PC | `apps/desktop/electron/licensing/debtCheckpoint.ts`, `debtCheckpointJob.ts`, `debtCheckpointTail.ts`, `debtBalanceLive.ts` |
| Writes de eventos | `providerSync.ts`, `customerDebtSync.ts`, `apps/mobile/src/lib/adminFirestore.ts`, `sync.ts`, `debtCheckpointWrite.ts` |
| Recortes | `orderSync.ts`, `shiftSync.ts`, `mobileSync.ts`, `historyFirestore.ts`, `adminHistory.ts` |
| Lista proveedores | `apps/desktop/electron/ipc/providers.handler.ts` |
| Arranque | `apps/desktop/electron/ipc/auth.handler.ts` |
| Firebase | `firebase/firestore.rules`, `firebase/firestore.indexes.json` |
| Script | `apps/desktop/scripts/backfillCreatedAtServer.mjs` |

---

## 9. Orden para producción (pendiente de OK)

1. Deploy de **índices + reglas** (`firestore:indexes` y `firestore:rules`). Sin los índices, las queries nuevas fallan en runtime.
2. `node apps/desktop/scripts/backfillCreatedAtServer.mjs --apply`
3. Recién ahí usar la app con job + listeners (`pnpm dev:prod` / build).
4. `pnpm mobile:deploy` cuando el celu deba re-probar.

Hasta (2), el job es no-op y el saldo en vivo puede verse en 0.

---

## 10. Qué sigue fuera de esta oleada

- **Palanca 2 de DT-08:** cache de sesión del detalle de Historial + debounce del ↻. El recorte por fecha/turno ya está; un mash de ↻ sobre un turno grande todavía cobra de nuevo.
- **Historial de un proveedor/cliente** (detalle): sigue pidiendo todos los eventos de **ese** id. No es el boot ni la lista combinada. Con 129 eventos actuales es irrelevante; a escala haría falta rango/cursor.
- **`refreshRemoteData` en cada cambio de pantalla** (hallazgo 2 de la auditoría): no se tocó. Sigue pudiendo repetir pulls de colecciones chicas y de las que aún se piden enteras (`customers`, `specialCustomers`, etc.).
- Login **pull + después listener** de colecciones chicas: sigue duplicando el snapshot inicial. Costo chico.
- Mensaje de UI cuando Spark corta por cuota: no hay copy dedicado.
- DT-05 (`daily_summaries` en SQLite): otro dominio; no es lecturas Firestore.

---

## 11. Cómo verificar

- Suite: `pnpm --filter @carniceria/shared test`, `pnpm --filter @carniceria/desktop test`, `pnpm --filter @carniceria/mobile test`.
- Job: una sola PC compacta; las otras loguean `lease-held` o `interval`.
- Tras backfill + una corrida: docs en `providerDebtCheckpoints` / `customerDebtCheckpoints`; saldos de cards coinciden con ledger (checkpoint + cola de 5 días).
- Historial remoto: default 7 días; alargar el rango no debe bajar `sales` entero.
- Proveedores admin PC: abrir la lista no dispara `getDocs` de `providerDebtEvents` (sí de checkpoints o el cache del listener).
