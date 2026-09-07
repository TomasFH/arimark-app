# Auditoría Firestore — diagnóstico Spark

Fecha: 2026-09-04.

**Esta es una foto del código en el momento del diagnóstico.** La oleada DT-07/DT-08 (checkpoint, job, recortes de Historial/pedidos/turnos) está documentada en `docs/FIRESTORE_DT07_DT08.md`. Varias filas de abajo (listeners de ledgers enteros, Historial de 5 colecciones, `GET_PROVIDERS_WITH_DEBT` del ledger, reconcile de todos los shifts, hijas móviles enteras) **ya no describen el código actual**.
Alcance: código de producción (`apps/desktop/electron`, `apps/mobile/src`). Tests, mocks y `dist-electron/` excluidos (no facturan).
No hay `writeBatch` ni `runTransaction` en el proyecto.
El renderer de desktop no llama a Firestore (correcto: solo IPC).
Cloud Function `activateInstallation` se invoca por HTTP (`installation.ts`); no es SDK Firestore del cliente.

**Cómo se cuenta en Spark:** 1 documento leído = 1 lectura. `getDocs` de N docs = N lecturas. El primer `onSnapshot` cobra N lecturas (snapshot inicial). Cada documento que cambia después cobra 1 lectura extra por cliente conectado. `setDoc`/`updateDoc`/`addDoc`/`deleteDoc` = 1 escritura o 1 borrado. Un documento grande (catálogo con array de productos) sigue siendo 1 operación.

**Convención de tamaño (uso normal, 2 locales):** colecciones chicas y estables = `stores` (~2), `users` (~10), `employees` (~10–20), `catalog` (1 doc/local), `specialCustomers` / precios. Colecciones que crecen todos los días = `sales`, `shifts`, `expenses`, `orders`, `customerDebtEvents`, `providerDebtEvents`, `employeeVales`, `salaryPayments`, `attendance`. Las estimaciones usan “N = docs actuales de esa colección”.

---

## Hallazgos de mayor impacto (solo diagnóstico)

1. **Login / `select-store` / `refreshRemoteData` duplican lecturas:** primero `getDocs` de la colección entera (pull) y después `onSnapshot` de la misma colección (snapshot inicial = otra pasada completa). Varios `ensure*Synced` hacen exactamente eso.
2. **`refreshRemoteData` se dispara en cada cambio de pantalla** en `apps/desktop/src/App.tsx` (caja, fiados, pedidos, historial, proveedores, staff, etc.). Cada navegación re-ejecuta pulls de colecciones enteras, aunque los listeners ya estén activos.
3. **Listeners permanentes sobre colecciones que crecen** (`orders`, `customers`, `customerDebtEvents`, `providerDebtEvents`) sin `limit()` ni recorte por fecha. El snapshot inicial de cada login/PC/celular cobra N lecturas de todo el histórico.
4. **Historial admin desktop** baja 5 colecciones enteras en paralelo cada vez que se lista turnos (`shifts` + `sales` + `expenses` + `orders` + `customerDebtEvents`), y el filtro de fechas es en memoria.
5. **Historial admin móvil** al abrir un turno baja **toda** `sales` y **toda** `expenses` para filtrar un `shiftId` en memoria.
6. **`GET_ACTIVE_SHIFT` / abrir turno / `getUserOpenShift`** llaman `reconcileStoreShifts`, que hace `getDocs` de todos los turnos del local (o del usuario, o de todo el tenant).
7. **Listener de importación móvil** (`mobileSync`): cada snapshot de turnos con `importedAt == null` relee 4 subcolecciones enteras por cada turno abierto, en un loop.

---

## 1. Desktop — autenticación e instalación

### `apps/desktop/electron/licensing/session.ts`

| Línea | API | Tipo | Loop | Colección / doc | ¿Colección entera sin `limit()`? | Frecuencia estimada |
|---|---|---|---|---|---|---|
| 99 | `getDoc` | Lectura | No | `licenses/{tenant}/users/{uid}` | No (1 doc) | 1 lectura por login con `signInWithRole` (producción). No en cada render. |
| 177 | `getDoc` | Lectura | No | Idem | No (1 doc) | 1 lectura por login unificado `signInAutoDetect`. Es el camino real de `IPC.LOGIN`. |

`verifyLicense` en `license.ts` **no consulta Firestore**.

### `apps/desktop/electron/licensing/installation.ts`

| Línea | API | Tipo | Loop | Path | ¿Sin `limit()`? | Frecuencia |
|---|---|---|---|---|---|---|
| 69 | `getDoc` | Lectura | No | `licenses/{tenant}/installations/{uid}` | No (1 doc) | Código presente. **Ningún caller en el repo** (`checkInstallationStatus` no se usa). |
| 152 | `addDoc` | Escritura | No | `licenses/{tenant}/activity_log` (auto-id) | N/A | Código presente. **Ningún caller** (`logActivity` no se usa). |
| 171 | `setDoc` merge | Escritura | No | `installations/{uid}` (`last_seen`) | N/A | Solo si se llamara `checkInstallationStatus` y el doc estuviera activo. |

`activateInstallation` (L89–135) es `fetch` a Cloud Function, no SDK Firestore.

### `apps/desktop/electron/licensing/tenantAuth.ts`

| Línea | API | Tipo | Loop | Path | ¿Sin `limit()`? | Frecuencia |
|---|---|---|---|---|---|---|
| 64 | `setDoc` | Escritura | No | `users/{uid}` | N/A | 1 escritura al crear cuenta de carnicero (`grant-butcher-access`). |
| 93–95 | `getDocs` + `where('email','==',email)` | Lectura | No | `users` filtrado por email | Query acotada (0–pocos docs) | Solo si Auth responde `email-already-in-use`. ~1 consulta en ese error. |

---

## 2. Desktop — sync outbox (escrituras en loop)

Patrón común: `for (pending of SQLite where syncedAt=null) await setDoc(...)`. El loop es N pendientes, no un loop de React. Cada fila = 1 escritura. Se dispara al confirmar venta/gasto/pedido, al login, al refresh y al importar turno móvil.

### `apps/desktop/electron/licensing/saleSync.ts`

| Línea | API | Tipo | Loop | Path | ¿Sin `limit()`? | Frecuencia |
|---|---|---|---|---|---|---|
| 73 | `setDoc` merge | Escritura | **Sí** (`for` de ventas pending) | `sales/{saleId}` (items/payments embebidos) | N/A | 1 escritura por venta confirmada aún no sincronizada. Tras éxito no se reescribe hasta el próximo cambio de `syncedAt`. |

Caller principal: `sale.handler` al crear venta; también `mobileSync` post-import.

### `apps/desktop/electron/licensing/expenseSync.ts`

| Línea | API | Tipo | Loop | Path | Frecuencia |
|---|---|---|---|---|---|
| 49 | `setDoc` merge | Escritura | **Sí** (gastos pending) | `expenses/{id}` | 1 escritura por gasto/inyección pendiente. |
| 93 | `updateDoc` | Escritura (soft-delete) | **Sí** (lista de ids) | `expenses/{id}` | 1 escritura por gasto borrado/editado ya sincronizado. |

### `apps/desktop/electron/licensing/shiftSync.ts`

| Línea | API | Tipo | Loop | Path | ¿Sin `limit()`? | Frecuencia |
|---|---|---|---|---|---|---|
| 73 | `setDoc` merge | Escritura | **Sí** (turnos pending) | `shifts/{id}` | N/A | 1 escritura al abrir y otra al cerrar (se marca `syncedAt=null` de nuevo). |
| 137 | `getDocs` + `where storeId` | Lectura | No | `shifts` del local | **Sí: todos los turnos históricos de ese local**, sin `limit` ni fecha | Ver `reconcileStoreShifts` abajo. |
| 139 | `getDocs` + `where userId` | Lectura | No | `shifts` del usuario | **Sí: todos los turnos de ese uid** | `GET_USER_OPEN_SHIFT`. |
| 140 | `getDocs` colección | Lectura | No | `shifts` tenant | **Sí: colección entera** | Si se llama `reconcileStoreShifts` sin filtro (refresh admin sin `storeId` útil). |

`reconcileStoreShifts` se dispara desde:

- `GET_ACTIVE_SHIFT` (storeId+userId → usa `storeId` primero): al elegir local, al volver de cierre de turno, `OpenShiftScreen`.
- `OPEN_SHIFT`: 1 vez al abrir.
- `GET_STORE_OPEN_SHIFT`: al consultar si el local ya tiene turno.
- `GET_USER_OPEN_SHIFT`: post-login, ExpenseModal, SalaryPaymentModal, “ir a caja” admin.
- `refreshRemoteData`: 1 vez por refresh (y el refresh ocurre **en cada cambio de pantalla** listado en `App.tsx`).

Estimación: **N lecturas = cantidad de documentos `shifts` del filtro**, cada vez. Con 2 locales × 2 turnos/día × 6 meses ≈ 700 docs/local → ~700 lecturas por `getActiveShift` / refresh de cajera.

### `apps/desktop/electron/licensing/orderSync.ts`

| Línea | API | Tipo | Loop | Path | ¿Sin `limit()`? | Frecuencia |
|---|---|---|---|---|---|---|
| 150 | `setDoc` merge | Escritura | **Sí** (orders pending) | `orders/{id}` | N/A | 1 escritura por alta/edición local no sincronizada. |
| 188 | `setDoc` merge | Escritura | No | `orders/{id}` (`deleted:true`) | N/A | 1 escritura al borrar un pedido. |
| 201 | `getDocs` | Lectura | No | `orders` | **Sí, colección entera** | 1 vez por `ensureOrdersSynced` (login admin, `select-store`, cada `refreshRemoteData`). |
| 229 | `onSnapshot` | Listener permanente | Callback recorre `docChanges` (local, no extra lecturas) | `orders` | **Sí, colección entera, sin `limit`** | Arranca en `ensureOrdersSynced`. Idempotente si ya hay listener. Snapshot inicial = N lecturas. Luego 1 lectura por pedido creado/editado en cualquier dispositivo, **por cada PC con el listener vivo**. |

### `apps/desktop/electron/licensing/employeeSync.ts`

| Línea | API | Tipo | Loop | Path | ¿Sin `limit()`? | Frecuencia |
|---|---|---|---|---|---|---|
| 121 | `setDoc` | Escritura | **Sí** | `employees/{id}` | N/A | Alta/edición de empleado. |
| 148 | `getDocs` | Lectura | No | `employees` | **Sí, entera** | Cada `ensureEmployeesSynced` (login, select-store, refresh). Colección chica. |
| 185 | `onSnapshot` | Listener permanente | `docChanges` local | `employees` | **Sí, entera** | Sesión completa. Snapshot inicial = N (chico). |
| 250 | `setDoc` | Escritura | **Sí** | `attendance/{id}` | N/A | 1 por ficha de asistencia. |
| 286 | `setDoc` | Escritura | **Sí** | `employeeVales/{id}` | N/A | 1 por vale. |
| 326 | `setDoc` | Escritura | **Sí** | `salaryPayments/{id}` | N/A | 1 por liquidación. |

No hay pull/listener de `attendance`, vales ni salarios en desktop (solo push).

### `apps/desktop/electron/licensing/providerSync.ts`

| Línea | API | Tipo | Loop | Path | ¿Sin `limit()`? | Frecuencia |
|---|---|---|---|---|---|---|
| 208 | `setDoc` | Escritura | **Sí** | `providers/{id}` | N/A | Alta/edición de proveedor. Colección chica. |
| 257 | `setDoc` | Escritura | **Sí** | `providerDebtEvents/{id}` | N/A | 1 por evento de deuda/pago. Crece a diario. |
| 310 | `onSnapshot` | Listener permanente | `docChanges` | `providers` | **Sí, entera** | Desde login admin / `select-store` cajera. Colección chica. |
| 335 | `onSnapshot` | Listener permanente | `docChanges` | `providerDebtEvents` | **Sí, colección creciente entera** | Snapshot inicial = todo el ledger histórico. Luego 1 lectura/doc cambiado × PCs conectadas. |
| 395 | `updateDoc` | Escritura | **Sí** (ids) | `providerDebtEvents/{id}` | N/A | Soft-delete al editar/borrar gasto. |
| 420 | `getDocs` + `where providerId` | Lectura | No | Eventos de 1 proveedor | Sin `limit`; acotado por proveedor | `restoreProviderLedgerInFirestore` al desarchivar. |
| 426 | `updateDoc` | Escritura | **Sí** (docs deleted) | Mismos refs | N/A | 1 escritura por evento a restaurar. |

No hay `getDocs` de pull inicial de providers: el listener cubre el pull (snapshot inicial).

### `apps/desktop/electron/licensing/customerDebtSync.ts`

| Línea | API | Tipo | Loop | Path | ¿Sin `limit()`? | Frecuencia |
|---|---|---|---|---|---|---|
| 262 | `setDoc` | Escritura | **Sí** | `customers/{id}` | N/A | Alta de cliente de fiado. |
| 301 | `setDoc` | Escritura | **Sí** | `customerDebtEvents/{id}` | N/A | 1 por evento de fiado/cobro. |
| 333 | `getDocs` | Lectura | No | `customers` | **Sí, entera** | Cada `ensureCustomerDebtsSynced`. |
| 356 | `getDocs` | Lectura | No | `customerDebtEvents` | **Sí, colección creciente entera** | Idem. Alto riesgo a 6–12 meses. |
| 384 | `onSnapshot` | Listener permanente | `docChanges` | `customers` | **Sí, entera** | Sesión. |
| 396 | `onSnapshot` | Listener permanente | `docChanges` | `customerDebtEvents` | **Sí, creciente entera** | Sesión. Snapshot inicial = histórico completo. |

### `apps/desktop/electron/licensing/specialCustomerSync.ts`

| Línea | API | Tipo | Loop | Path | ¿Sin `limit()`? | Frecuencia |
|---|---|---|---|---|---|---|
| 210 | `setDoc` | Escritura | **Sí** | `specialCustomers/{id}` | N/A | ABM infrecuente. |
| 245 | `setDoc` | Escritura | **Sí** | `specialCustomerPrices/{id}` | N/A | 1 por precio especial. |
| 271 | `setDoc` merge | Escritura | No | `specialCustomers/{id}` deleted | N/A | Baja. |
| 286 | `setDoc` merge | Escritura | No | `specialCustomerPrices/{id}` deleted | N/A | Baja de precio. |
| 303 | `getDocs` | Lectura | No | `specialCustomers` | **Sí, entera** | `ensureSpecialCustomersSynced`. Colección chica. |
| 326 | `getDocs` | Lectura | No | `specialCustomerPrices` | **Sí, entera** | Idem. Chica-media. |
| 354 | `onSnapshot` | Listener permanente | `docChanges` | `specialCustomers` | **Sí** | Sesión. |
| 366 | `onSnapshot` | Listener permanente | `docChanges` | `specialCustomerPrices` | **Sí** | Sesión. |

### `apps/desktop/electron/licensing/storeSync.ts`

| Línea | API | Tipo | Loop | Path | ¿Sin `limit()`? | Frecuencia |
|---|---|---|---|---|---|---|
| 108 | `setDoc` | Escritura | **Sí** | `stores/{id}` | N/A | Alta/edición de local (raro). |
| 147 | `getDocs` | Lectura | No | `stores` | **Sí, entera** | Login (await), select-store, refresh. ~2 lecturas. |
| 203 | `onSnapshot` | Listener permanente | `docChanges` | `stores` | **Sí, entera** | Sesión. Colección chica. |

---

## 3. Desktop — catálogo

### `apps/desktop/electron/licensing/catalogSync.ts`

| Línea | API | Tipo | Loop | Path | ¿Sin `limit()`? | Frecuencia |
|---|---|---|---|---|---|---|
| 483 | `getDoc` | Lectura | No | `catalog/{storeId}` (1 doc con array `products`) | No (1 doc grande) | `syncCatalogWithFirestore` / `pullCatalogFromFirestore`. Cajera: 1 local. Admin: loop por cada local activo (`syncAllStoreCatalogs`, L794). |
| 860 | `onSnapshot` | Listener permanente | **Sí sobre locales** (`for storeId of storeIds`) | `catalog/{storeId}` | No: 1 doc por local | Cajera: 1 listener. Admin: 1 listener por local activo (~2). Snapshot inicial = 1 lectura/doc. Cambio de precios = 1 lectura extra por PC. Puede disparar `publishCatalog` (escrituras) si el merge local está incompleto (L717). |

### `apps/desktop/electron/licensing/catalogPublish.ts`

| Línea | API | Tipo | Loop | Path | ¿Sin `limit()`? | Frecuencia |
|---|---|---|---|---|---|---|
| 312 | `getDoc` | Lectura | No | `catalog/{storeId}` | No | Al archivar si no hay snapshot precargado. |
| 325 | `setDoc` | Escritura | No | `catalog/{storeId}/revisions/{autoId}` | N/A | 1 por publicación que archiva. |
| 337 | `getDocs` + `orderBy archivedAt` | Lectura | No | subcolección `revisions` | **Sí, todas las revisiones** (tope lógico 10) | Tras cada archive. ~10 lecturas. |
| 340 | `deleteDoc` | Borrado | **Sí** (revisiones extra) | `revisions/{id}` | N/A | 0–pocos borrados (máx. 10 conservadas). |
| 439 | `getDoc` | Lectura | No | `catalog/{storeId}` | No | Cada `publishCatalogNow` (debounce 600 ms). |
| 471 | `setDoc` | Escritura | No | `catalog/{storeId}` | N/A | 1 escritura si el fingerprint cambió. |
| 503 | `publishCatalog` | — | **Sí por local** | — | — | `publishCatalogForAllStores`. |
| 514 | `getDocs` + `orderBy` | Lectura | No | `revisions` | **Sí, todas** | Al abrir lista de versiones en Admin. |
| 541 | `getDoc` | Lectura | No | `revisions/{revisionId}` | No | Al restaurar una versión. |
| 563 | `archiveCurrentCatalog` | Lectura+escritura+borrados | Ver arriba | | | Restore. |
| 566 | `setDoc` | Escritura | No | `catalog/{storeId}` | N/A | Restore. |

Publicación: al editar catálogo/precios (`scheduleCatalogPublish`), login admin (`syncAllStoreCatalogs` puede publicar), y a veces el listener en vivo. No en cada render.

---

## 4. Desktop — importación de turnos móviles

### `apps/desktop/electron/licensing/mobileSync.ts`

| Línea | API | Tipo | Loop | Path | ¿Sin `limit()`? | Frecuencia |
|---|---|---|---|---|---|---|
| 86 | `onSnapshot` + `where importedAt==null` | Listener permanente | **Sí: `for` cada doc del snapshot** | `sync/{storeId}/shifts` | Query filtrada, **sin `limit`**. Incluye turnos **abiertos** a propósito | Arranca en `select-store` (cajera). **No hay guarda anti-duplicado**: cada `select-store` extra agrega otro listener. |
| 146–149 | `getDocs` × 4 | Lectura | **Sí, por cada turno del snapshot** | subcols `sales`, `expenses`, `vales`, `salaryPayments` | **Sí, cada subcolección entera** de ese turno | En el snapshot inicial y **en cada actualización** del query: relee las 4 subcols de **todos** los turnos con `importedAt==null` (no solo el que cambió). Turno móvil abierto de ~80 ventas = ~80+gastos+vales lecturas **repetidas** cada vez que el celu sube una venta. |
| 220 | `updateDoc` | Escritura | No | staging `shifts/{id}` | N/A | 1 escritura al cerrar e importar. |

Después del import dispara pushes de shifts/sales/expenses/providers/deuda/vales/salarios (escrituras extra si hay pendientes).

---

## 5. Desktop — lecturas de historial y sueldos

### `apps/desktop/electron/licensing/historyFirestore.ts`

| Línea | API | Tipo | Loop | Path | ¿Sin `limit()`? | Frecuencia |
|---|---|---|---|---|---|---|
| 171 | `getDocs` | Lectura | No (paralelo) | `shifts` | **Sí, entera** | `GET_HISTORY_SHIFTS` si Firebase está disponible (`useRemote = true` en prod). Cada apertura de Historial y cada cambio de filtro (fechas/local se aplican **en memoria**). |
| 172 | `getDocs` | Lectura | No | `sales` | **Sí, entera** | Idem. Colección de mayor crecimiento. |
| 173 | `getDocs` | Lectura | No | `expenses` | **Sí, entera** | Idem. |
| 174 | `getDocs` | Lectura | No | `orders` | **Sí, entera** | Idem. |
| 175 | `getDocs` | Lectura | No | `customerDebtEvents` | **Sí, entera** | Idem. |
| 310 | `getDoc` | Lectura | No | `shifts/{shiftId}` | No | Detalle de un turno. |
| 324–328 | `getDocs` × 5 + `where shiftId` / `depositShiftId` | Lectura | No | sales, expenses, orders, customerDebtEvents, employeeVales | Filtrado por turno, **sin `limit`** | 1 vez al abrir detalle. Tamaño = movimientos de ese turno. |
| 367 | `getDocs` + `where saleId in chunk` | Lectura | **Sí** (`chunkIds` de a 30) | `customerDebtEvents` | Query por lote | Extra si hay ventas de fiado. 1 query cada 30 saleIds. |
| 423 | `getDoc` | Lectura | **Sí** (`Promise.all` por customerId único) | `customers/{cid}` | No (1 doc c/u) | 1 lectura por cliente distinto en el detalle. |
| 554 | `getDocs` | Lectura | No | `employeeVales` | **Sí, entera** | Modal vales remotos. |
| 555 | `getDocs` | Lectura | No | `shifts` | **Sí, entera** | Mismo modal (para resolver `storeId` de vales viejos). |

Detalle vacío en SQLite (PC admin sin ventas locales) vuelve a llamar `fetchHistoryShiftDetailFromFirestore` (mismas queries).

### `apps/desktop/electron/licensing/salaryFirestore.ts`

| Línea | API | Tipo | Loop | Path | ¿Sin `limit()`? | Frecuencia |
|---|---|---|---|---|---|---|
| 58 | `getDocs` + `where weekStart` | Lectura | No | `salaryPayments` | Recorte por semana, sin `limit` | `GET_REMOTE_SALARY_WEEK` al abrir liquidación (con caché de sesión en el modal). Pocos docs. |
| 96 | `getDocs` + `where paidAt` rango | Lectura | No | `employeeVales` | Recorte holgado (~9 días), sin `limit` | Idem. |

---

## 6. Desktop — IPC que habla Firestore directo

### `apps/desktop/electron/ipc/cashiers.handler.ts`

| Línea | API | Tipo | Loop | Path | ¿Sin `limit()`? | Frecuencia |
|---|---|---|---|---|---|---|
| 133 | `getDocs` + `where role==cashier` | Lectura | No | `users` | Query por rol, sin `limit`; filtro `deleted` en memoria | Al abrir gestión de cajeras / Staff. Colección chica. |
| 183 | `setDoc` | Escritura | No | `users/{uid}` | N/A | Alta de cajera. |
| 227–228 | `getDocs` + `where email` | Lectura | No | `users` | Query acotada | Solo error email duplicado. |
| 256 | `getDoc` | Lectura | No | `users/{uid}` | No | Editar cajera. |
| 266 | `updateDoc` | Escritura | No | `users/{uid}` | N/A | Editar. |
| 273 | `updateDoc` | Escritura | No | `users/{uid}` | N/A | Activar/desactivar. |
| 283 | `updateDoc` | Escritura | No | `users/{uid}` | N/A | Soft-delete. |

### `apps/desktop/electron/ipc/employees.handler.ts`

| Línea | API | Tipo | Loop | Path | ¿Sin `limit()`? | Frecuencia |
|---|---|---|---|---|---|---|
| 395 | `getDocs` | Lectura | No | `stores` | **Sí, entera** | Al otorgar acceso celular a un carnicero. ~2 lecturas. Luego `createTenantAuthUser` (1 `setDoc`). |
| 453 | `updateDoc` | Escritura | No | `users/{firebaseUid}` | N/A | Revocar acceso carnicero. |

### `apps/desktop/electron/ipc/providers.handler.ts`

| Línea | API | Tipo | Loop | Path | ¿Sin `limit()`? | Frecuencia |
|---|---|---|---|---|---|---|
| 810 | `getDocs` | Lectura | No | `providerDebtEvents` | **Sí, colección creciente entera** | Cada carga de `ProvidersScreen` admin (`getProvidersWithDebt`). Recalcula balances en memoria. |
| 894 | `getDocs` + `where providerId` | Lectura | No | Eventos de 1 proveedor | Sin `limit` | Al abrir historial de un proveedor. |

---

## 7. Desktop — disparadores de sync (no son llamadas Firestore, pero definen frecuencia)

- **Login admin** (`auth.handler.ts`): `ensureStoresSynced` + `ensureEmployeesSynced` + `ensureOrdersSynced` + `ensureCustomerDebtsSynced` + `ensureSpecialCustomersSynced` + `syncAllStoreCatalogs` + listeners de providers y catálogo. Efecto: pull completo + snapshot inicial de cada listener = **~2× N** en orders/customers/debtEvents/specials/employees/stores.
- **Login cajera**: `ensureStoresSynced` + `ensureEmployeesSynced` + listener catálogo (1 local). El resto espera `select-store`.
- **`select-store`**: sync catálogo, `startMobileSyncListener`, `startProviderSyncListener`, otra vez todos los `ensure*`.
- **`App.tsx` L77–78**: `refreshRemoteData()` en transiciones hacia/desde `admin-hub`, `staff`, `store-management`, `debts`, `special-customers`, `orders`, `history`, `providers`, `stock-counts`, `cashier`. Cada una re-ejecuta pulls de colecciones enteras (los listeners existentes se omiten, **los `getDocs` de pull no**).
- **Caja**: botón “actualizar remoto” y `refreshRemoteData` al navegar.

---

## 8. Móvil — auth, catálogo, POS

### `apps/mobile/src/lib/auth.ts`

| Línea | API | Tipo | Loop | Path | Frecuencia |
|---|---|---|---|---|---|
| 56 | `getDoc` | Lectura | No | `users/{uid}` | 1 lectura en login online. `restoreSession` **no** relee si hay perfil en IndexedDB. |

### `apps/mobile/src/lib/catalog.ts`

| Línea | API | Tipo | Loop | Path | ¿Sin `limit()`? | Frecuencia |
|---|---|---|---|---|---|---|
| 52 | `getDoc` | Lectura | No | `catalog/{storeId}` | No (1 doc) | Login POS / reconexión (`App.tsx`). |
| 144 | `getDocs` | Lectura | No | colección `catalog` | **Sí, todos los locales** (~2 docs) | Clientes especiales admin (`fetchMergedCatalogFromFirestore`). |
| 173 | `onSnapshot` | Listener mientras hay pantalla POS/open-shift/loading | No | `catalog/{storeId}` | No (1 doc) | Se desuscribe al salir de esas pantallas. Snapshot inicial + 1 lectura por publicación de catálogo. |

### `apps/mobile/src/lib/sync.ts` (celular → Firestore)

Cada entidad pendiente se escribe **dos veces** (staging bajo `sync/{storeId}/shifts/{shiftId}/...` y copia operativa en la colección del tenant), salvo deuda/cliente/proveedor que van solo a ops.

| Línea | API | Tipo | Loop | Path | Frecuencia |
|---|---|---|---|---|---|
| 131 | `setDoc` merge | Escritura | Por turno a subir | `sync/{storeId}/shifts/{id}` | Al abrir/actualizar turno móvil. |
| 134 | `setDoc` merge | Escritura | Idem | `shifts/{id}` | Duplicado operativo. |
| 227 | `setDoc` | Escritura | **Sí, ventas pending del turno** | staging `sales/{id}` | 1 por venta. |
| 230 | `setDoc` | Escritura | Idem | `sales/{id}` | 2ª escritura por venta. |
| 237 | `setDoc` | Escritura | Si `isDebt` | `customers/{id}` | Extra en venta fiado. |
| 241 | `setDoc` | Escritura | Si `isDebt` | `customerDebtEvents/{id}` | Extra en venta fiado. |
| 249 | `setDoc` | Escritura | Si hay proveedor | `providers/{id}` | Al subir gasto con proveedor. |
| 266 | `setDoc` | Escritura | **Sí, gastos pending** | staging `expenses/{id}` | 1 por gasto. |
| 269 | `setDoc` | Escritura | Idem | `expenses/{id}` | 2ª. |
| 279 | `setDoc` | Escritura | **Sí, eventos pending del gasto** | `providerDebtEvents/{id}` | 1 por evento. |
| 298–299 | `setDoc` × 2 | Escritura | Vales pending | staging + `employeeVales` | 2 por vale. |
| 313–314 | `setDoc` × 2 | Escritura | Liquidaciones pending | staging + `salaryPayments` | 2 por pago. |

`triggerSync`: al abrir app, al reconectar, y **después de cada venta/gasto/vale confirmado** en `PosScreen`. Reentrante (si ya hay sync, sale). No es por render.

Estimación por venta de contado: **2 escrituras**. Por venta fiado: **4**. Por gasto con proveedor: **2 (expense) + 1 (provider merge) + 1 (debt event)**.

### `apps/mobile/src/lib/posCaches.ts`

| Línea | API | Tipo | Loop | Path | ¿Sin `limit()`? | Frecuencia |
|---|---|---|---|---|---|---|
| 147 | `getDocs` | Lectura | No | `providers` | **Sí, entera** | Al montar POS (`refreshPosCaches` una vez por turno abierto). Chica. |
| 162 | `getDocs` | Lectura | No | `employees` | **Sí, entera** | Idem. Chica. |
| 185 | `getDocs` × 2 | Lectura | No | vales por `paidAt` + `salaryPayments` por `weekStart` | Recorte semanal | Idem. |
| 230 | `getDocs` + `where providerId` | Lectura | No | `providerDebtEvents` de 1 proveedor | Sin `limit` | `getProviderBalance` al elegir proveedor en modal de gasto. |
| 287 | `setDoc` merge | Escritura | No | `providers/{id}` | N/A | Alta de proveedor desde el POS si hay red. |

---

## 9. Móvil — admin (`adminFirestore.ts`)

El archivo declara: *“getDocs sobre la colección completa y filtro en memoria”*.

### Lecturas

| Línea | Función | API | Loop | Colección | ¿Sin `limit()`? | Cuándo |
|---|---|---|---|---|---|---|
| 238 | `fetchOrders` | `getDocs` | No | `orders` | **Sí, entera** | Abrir Pedidos admin. Filtro de local en memoria. |
| 292 | `fetchCustomers` | `getDocs` | No | `customers` | **Sí, entera** | Abrir Fiados. |
| 339 | `fetchCustomerDebtEvents` | `getDocs` | No | `customerDebtEvents` | **Sí, entera** (filtra 1 cliente en memoria) | Detalle de un cliente (L247 DebtsScreen). **Segunda pasada completa** además de L364. |
| 364 | `fetchAllCustomerDebtEvents` | `getDocs` | No | `customerDebtEvents` | **Sí, entera** | Lista de Fiados (junto con customers). |
| 408 | `fetchProviders` | `getDocs` | No | `providers` | **Sí, entera** | Proveedores admin. |
| 425 | `fetchProviderDebtEvents` | `getDocs` | No | `providerDebtEvents` | **Sí, entera** | Misma pantalla, en paralelo. |
| 474 | `restoreProvider` | `getDocs` | **Sí + `updateDoc` por evento deleted** | `providerDebtEvents` entera | **Sí** | Restaurar proveedor. Escrituras = eventos soft-deleted de ese id. |
| 489 | `purgeProviderLedger` | `getDocs` | **Sí + `updateDoc`** | `providerDebtEvents` entera | **Sí** | Función deprecada; si se llama, N escrituras. |
| 550 | `fetchSpecialCustomers` | `getDocs` | No | `specialCustomers` | **Sí** | Clientes especiales. |
| 571 | `fetchAllSpecialCustomerPrices` | `getDocs` | No | `specialCustomerPrices` | **Sí** | Misma pantalla; también `fetchSpecialCustomerPrices` reusa esto. |
| 659 | `softDeleteSpecialCustomer` | llama `fetchSpecialCustomerPrices` | **Sí `updateDoc` precios** | precios (vía getDocs entero) | **Sí** | Baja: 1 lectura de toda la col. de precios + 1+N escrituras. |
| 671 | `fetchEmployees` | `getDocs` | No | `employees` | **Sí** | Staff, Employees, Payroll (al entrar). |
| 706 | `fetchEmployeeValesForEmployee` | `getDocs` | No | `employeeVales` | **Sí, entera** (filtra 1 empleado en memoria) | Al abrir ficha de un empleado (Staff/Employees). Histórico de vales de **todos**. |
| 786 | `fetchCashierUsers` | `getDocs` | No | `users` | **Sí, entera**; filtra role en memoria | Cajeras / Staff. Chica. |
| 825 | `fetchAllStores` | `getDocs` | No | `stores` | **Sí, entera** | Dashboard admin, StoresScreen, `loadCashierStoreOptions` (cajera elige local). ~2 lecturas. |
| 872 | `fetchExpensesForShift` | `getDocs` | No | `expenses` | **Sí, entera**; filtra `shiftId` en memoria | Detalle de turno en Historial móvil. |

### Escrituras (1 op por acción de usuario, no por render)

| Línea | API | Path | Acción |
|---|---|---|---|
| 270 | `setDoc` | `orders/{id}` | Crear pedido |
| 274 | `updateDoc` | `orders/{id}` | Cambiar estado |
| 281 | `updateDoc` | `orders/{id}` | Soft-delete |
| 315 | `setDoc` | `customers/{id}` | Crear cliente |
| 394 | `setDoc` | `customerDebtEvents/{id}` | Evento de fiado |
| 453 | `setDoc` | `providers/{id}` | Crear proveedor |
| 465 | `updateDoc` | `providers/{id}` | Renombrar |
| 469 | `updateDoc` | `providers/{id}` | Archivar |
| 473 | `updateDoc` | `providers/{id}` | Restaurar (+ loop eventos) |
| 505 | `setDoc` | `providerDebtEvents/{id}` | Evento deuda/pago |
| 598 | `setDoc` | `specialCustomers/{id}` | Alta |
| 618 | `updateDoc` | `specialCustomers/{id}` | Editar |
| 635 | `setDoc` | `specialCustomerPrices/{id}` | Upsert precio |
| 651 | `updateDoc` | `specialCustomerPrices/{id}` | Soft-delete precio |
| 660 | `updateDoc` | `specialCustomers/{id}` | Soft-delete cliente |
| 739 | `setDoc` | `employees/{id}` | Alta |
| 767 | `updateDoc` | `employees/{id}` | Editar |
| 771 | `updateDoc` | `employees/{id}` | Archivar |
| 778 | `updateDoc` | `employees/{id}` | Desarchivar |
| 806–817 | `updateDoc` | `users/{uid}` | Activo / nombre / locales |
| 843 | `setDoc` | `stores/{id}` | Alta local |
| 856–864 | `updateDoc` | `stores/{id}` | Editar / archivar / restaurar |

---

## 10. Móvil — historial admin (`adminHistory.ts`)

| Línea | Función | API | Loop | Path | ¿Sin `limit()`? | Frecuencia |
|---|---|---|---|---|---|---|
| 136 | `fetchAdminStores` | `getDocs` | No | `stores` | **Sí** | **Sin callers** en UI (código muerto respecto a pantallas actuales). |
| 161 | `fetchAdminShifts` | `getDocs` | No | `shifts` | **Sí, entera**; filtro local/fecha en memoria | Cada vez que se abre Historial o cambia el local. |
| 197 | `fetchAdminSalesForShift` | `getDocs` | No | `sales` | **Sí, entera**; filtra 1 `shiftId` en memoria | **Cada detalle de turno**. Crítico. |
| 247–248 | `fetchAdminVales` | `getDocs` × 2 | No | `employeeVales` + `shifts` | **Sí, ambas enteras** | **Sin callers** en UI actual (el detalle usa `fetchValesForShift`). |
| 363–364 | `fetchDebtsForShift` | `getDocs` + `where shiftId` y `saleId in` | **Sí, chunks de 30** | `customerDebtEvents` | Recorte por turno/ventas | Detalle de turno. |
| 410 | `getDoc` | Lectura | **Sí por customerId** | `customers/{cid}` | No | Detalle de turno. |
| 429 | `getDocs` + `where depositShiftId` | Lectura | No | `orders` | Filtrado, sin `limit` | Detalle. |
| 466 | `getDocs` + `where shiftId` | Lectura | No | `employeeVales` | Filtrado | Detalle. |

Costo típico de **abrir un turno** en Historial móvil: N(`sales`) + N(`expenses`) + deudas/señas/vales del turno + 1 `getDoc` por cliente de fiado. A los 6–12 meses N(`sales`) es el término dominante.

---

## 11. Móvil — liquidación y carnicero

### `apps/mobile/src/lib/adminPayroll.ts`

| Línea | API | Tipo | Loop | Path | ¿Sin `limit()`? | Frecuencia |
|---|---|---|---|---|---|---|
| 49 | `onSnapshot` + rango `paidAt` | Listener mientras PayrollScreen está abierta (semana actual) | No | `employeeVales` recortado | Recorte, sin `limit` | 1 snapshot inicial + 1 lectura por vale nuevo de esa ventana. Se desuscribe al cambiar de semana o salir. |
| 72 | `getDocs` mismo recorte | Lectura | No | Idem | Recorte | Semanas pasadas sin caché (`weekQueryPlan` = `fetch-once`). |
| 106 | `onSnapshot` + `where weekStart` | Listener (semana actual) | No | `salaryPayments` | Recorte | Mientras la pantalla está abierta. |
| 137 | `getDocs` + `weekStart` | Lectura | No | Idem | Recorte | Semana pasada sin caché. |

Payroll también llama `fetchEmployees` (colección entera) al montar.

### `apps/mobile/src/lib/butcherPayroll.ts`

| Línea | API | Tipo | Loop | Path | Frecuencia |
|---|---|---|---|---|---|
| 32 | `getDoc` | Lectura | No | `employees/{employeeId}` | 1 vez al abrir “Mi semana”. |
| 68 | `onSnapshot` | Listener | No | `employeeVales` filtrado `employeeId` + `paidAt` | Mientras la vista de semana está abierta. |
| 108 | `onSnapshot` | Listener | No | `salaryPayments` filtrado `employeeId` + `weekStart` | Idem. Típicamente 0–1 doc. |

### `apps/mobile/src/lib/butcherOrders.ts`

| Línea | API | Tipo | Loop | Path | ¿Sin `limit()`? | Frecuencia |
|---|---|---|---|---|---|---|
| 111 | `onSnapshot` + `storeId` + `status==pending` | Listener mientras el carnicero está en pedidos | No | `orders` | Query (requiere índice compuesto). **Sin `limit`**: todos los pending del local, incluidos atrasados | Snapshot inicial = cantidad de pending. Cada alta/cambio de pedido pending = 1 lectura. |
| 138 | `updateDoc` | Escritura | No | `orders/{id}` | N/A | 1 escritura al marcar “Listo” (online). |

---

## 12. Listeners permanentes vs temporales

### Permanentes (viven toda la sesión desktop, hasta logout)

| Módulo | Path | Docs iniciales cobrados |
|---|---|---|
| storeSync | `stores` | Todos los locales |
| employeeSync | `employees` | Todos |
| orderSync | `orders` | **Todos los pedidos históricos** |
| customerDebtSync | `customers` + `customerDebtEvents` | **Todos** |
| specialCustomerSync | `specialCustomers` + `specialCustomerPrices` | Todos |
| providerSync | `providers` + `providerDebtEvents` | **Todos los eventos de deuda** |
| catalogSync | `catalog/{storeId}` × locales | 1 doc/local |
| mobileSync | `sync/{storeId}/shifts` where `importedAt==null` + 4 `getDocs` por turno en cada tick | Turnos móviles no importados + hijos |

### Temporales (móvil; se cortan al salir de pantalla)

| Módulo | Path | Duración |
|---|---|---|
| catalog live | `catalog/{storeId}` | POS / open-shift / loading |
| butcherOrders | `orders` pending del local | App carnicero en pedidos |
| butcherPayroll | vales + salaryPayments recortados | “Mi semana” |
| adminPayroll | vales + salaryPayments recortados | PayrollScreen, semana actual |

---

## 13. Lo que no aparece

- `writeBatch`, `runTransaction`, `getCountFromServer`, `getAggregateFromServer`: no usados.
- `deleteDoc` en producción: solo poda de revisiones de catálogo.
- `addDoc`: solo `activity_log` (sin callers).
- Desktop renderer: cero llamadas Firestore.
- Tests: mocks; no facturan.

---

## 14. Escenarios de uso normal (orden de magnitud)

Supuestos: 2 locales, 1 PC caja + 1 PC/admin a veces, 1 celu cajera, 1 celu carnicero, 1 admin en el teléfono. ~150 ventas/día, ~10 gastos, ~5 pedidos nuevos, ~4 turnos/día. Colecciones a 6 meses: ~20k sales, ~700 shifts, miles de debt events.

| Escenario | Qué se cobra | Orden de magnitud |
|---|---|---|
| Login cajera PC | 1 `getDoc` user + pull stores/employees + snapshot stores/employees/catalog + (tras select-store) pulls+snapshots de orders, customers, debtEvents, specials, providers, providerDebtEvents + mobileSync | Cientos a **miles** de lecturas el día 1; a 6 meses el término grande es `orders` + `customerDebtEvents` + `providerDebtEvents` (histórico completo × 2 por el pull+listener). |
| Navegar caja → fiados → pedidos → caja | `refreshRemoteData` **varias veces**: re-`getDocs` de stores, employees, orders, customers, debtEvents, specials, shifts del local, catálogo | **El mismo N histórico, repetido por cada navegación**, no por render de React. |
| Venta desktop | 1 `setDoc` sale (+ 1 customer + 1 debt event si fiado) + listener en otras PCs/celus cobra 1 lectura c/u | ~1–3 escrituras; lecturas fan-out = nº de listeners de esa colección. |
| Venta móvil | 2 `setDoc` sale + posible customer/debt + listener mobileSync en la PC releerá 4 subcols de **todos** los turnos `importedAt==null` | Escrituras 2–4; lecturas en PC: potencialmente **todas las ventas del turno abierto otra vez**. |
| Abrir Historial desktop | 5 colecciones enteras | ~N(shifts)+N(sales)+N(expenses)+N(orders)+N(customerDebtEvents) **por visita / cambio de filtro**. |
| Abrir un turno en Historial móvil | Toda `sales` + toda `expenses` + queries del turno | ~N(sales)+N(expenses) **por clic**. |
| Abrir Fiados móvil | `customers` entero + `customerDebtEvents` entero; abrir un cliente **vuelve a bajar toda** `customerDebtEvents` | 2× N(events) al entrar + 1× N al detalle. |
| Abrir Proveedores desktop | Toda `providerDebtEvents` | N(events) por visita. |
| Carnicero con la app abierta | Listener pending + 2 listeners de nómina si está en “Mi semana” | Pending (chico si se limpian) + recorte semanal. |
| Liquidación admin móvil, semana actual | 2 `onSnapshot` recortados + `employees` entero | Bajo, acotado. Semanas pasadas: 2 `getDocs` recortados, cacheados en sesión. |

Las operaciones **no** se re-ejecutan en cada render de React. Los costos altos vienen de: (1) snapshots iniciales de listeners sobre histórico, (2) pulls `getDocs` repetidos en login/refresh/navegación, (3) pantallas de historial/fiados/proveedores que bajan colecciones enteras, (4) el loop de `mobileSync` que relee hijos en cada snapshot.

---

*Fin del diagnóstico. Sin propuestas de cambio.*
