# TASKS_V1 — Tareas pendientes para versión 1.0

## Contexto general del proyecto

Aplicación de gestión para carnicerías. Monorepo pnpm con:
- `apps/desktop` — app Electron + React (proceso main con SQLite + Drizzle ORM, renderer React)
- `apps/mobile` — app Capacitor (React, PWA instalable como .apk)
- `packages/shared` — código TypeScript puro compartido

Firebase se usa para: autenticación (Auth), datos compartidos entre dispositivos (Firestore).
El gestor de paquetes es **pnpm exclusivamente**. Nunca npm ni yarn.
TypeScript estricto — sin `any`. Zod para validación de payloads IPC.
Tests con Vitest. Ejecutar `pnpm run test` en `apps/desktop` para verificar suite.

Archivos clave a leer antes de empezar cualquier tarea:
- `AGENTS.md` — reglas innegociables del proyecto
- `apps/desktop/electron/db/schema.ts` — schema Drizzle de la DB SQLite
- `apps/desktop/electron/ipc/channels.ts` — canales IPC registrados
- `apps/desktop/electron/licensing/providerSync.ts` — ejemplo de outbox pattern hacia Firestore
- `apps/desktop/electron/ipc/providers.handler.ts` — ejemplo de handler IPC con sync Firestore

---

## BLOQUE A — Eliminar sistema de licencias

### A1 — Eliminar verificación de licencia activa en startup ✅ HECHA (2026-07-30)

**Estado:** Completada. Typecheck + suite verde (450 main + 77 renderer).

**Qué se hizo:**
- `main.ts` / `computeInitStatus()`: ya no llama a `verifyLicense()`. En producción solo intenta `signInAnon()` (no bloqueante) y siempre devuelve `licenseValid: true`.
- `license.ts`: gate eliminado; `verifyLicense` queda como no-op deprecated que siempre retorna válida (sin red).
- Tests: `license.test.ts` reescrito; `initStatus.handler.test.ts` actualizado. `auth.handler` no usaba `verifyLicense` (sin cambios).
- `business.json` / `license_key` se siguen cargando; solo dejan de actuar como gate.

**Pendiente relacionado (fuera de A1):** UI `LicenseErrorScreen` / `ActivationScreen` siguen en el código pero el main ya no las dispara por licencia inválida. Se pueden limpiar en una tarea futura si hace falta.

---

### A2 — Renombrar `license_key` a `tenant_id` en business.json y código ✅ HECHA (2026-07-30)

**Estado:** Completada. Typecheck + suite verde (451 main + 77 renderer).

**Qué se hizo:**
- `businessConfig.ts`: schema usa `tenant_id`; preprocess acepta `license_key` legacy y lo normaliza.
- `business.json` / `business.example.json`: campo renombrado a `tenant_id`.
- Todos los handlers/tests usan `config.tenant_id` / `{ tenant_id }`.
- Rutas Firestore siguen siendo `licenses/{tenant_id}/...` (colección Firebase sin migrar).
- Quedan `license_key` solo en: comentarios/compat del preprocess, y columna histórica SQLite `installations.license_key` en `schema.ts`.
- `InitStatus.licenseKey` (camelCase UI) se mantiene; su valor es `config.tenant_id`.

---

## BLOQUE B — Sync operativo a Firestore (prerequisito para acceso remoto del admin)

### B1 — Sync de turnos a Firestore al abrir y cerrar ✅ HECHA (2026-07-30)

**Estado:** Completada. Typecheck + suite verde (455 main + 77 renderer).

**Qué se hizo:**
- Creado `apps/desktop/electron/licensing/shiftSync.ts` con `pushUnsyncedShifts(tenantId)`.
- Ruta Firestore: `licenses/{tenantId}/shifts/{shiftId}` (merge).
- `OPEN_SHIFT`: tras insert, fire-and-forget `pushUnsyncedShifts`.
- `CLOSE_SHIFT`: setea `syncedAt: null` en el update (para re-push) + fire-and-forget push.
- Tests: `shiftSync.test.ts` (4) + asserts de push en `shift.handler.test.ts`.

**Nota:** hasta ejecutar **G1** (reglas Firestore para `shifts`), el push en producción puede fallar por permisos — se loguea y no bloquea la UI.

---

### B2 — Sync de ventas a Firestore al confirmar venta ✅ HECHA (2026-07-30)

**Estado:** Completada. Typecheck + suite verde (459 main + 77 renderer).

**Qué se hizo:**
- Creado `apps/desktop/electron/licensing/saleSync.ts` con `pushUnsyncedSales(tenantId)`.
- Ruta: `licenses/{tenantId}/sales/{saleId}` con `items[]` y `payments[]` embebidos (incluye `productName`).
- Solo pushea `status='confirmed'` + `syncedAt=null`.
- `CREATE_SALE`: tras confirmar, fire-and-forget push.
- Tests: `saleSync.test.ts` (4) + assert en `sale.handler.test.ts`.
- Columna `syncedAt` ya existía en schema (sin migración nueva).

**Nota:** igual que B1, requiere **G1** (reglas Firestore) para que el push funcione en producción.

---

### B3 — Sync de gastos a Firestore al registrar ✅ HECHA (2026-07-30)

**Estado:** Completada. Typecheck + suite verde (463 main + 77 renderer).

**Qué se hizo:**
- Creado `apps/desktop/electron/licensing/expenseSync.ts`:
  - `pushUnsyncedExpenses(tenantId)` → `licenses/{tenant}/expenses/{id}` (incluye providerName)
  - `markExpensesDeletedInFirestore(tenantId, ids)` → soft-delete `deleted:true`
- `REGISTER_EXPENSE` / `UPDATE_EXPENSE`: fire-and-forget push (update ya pone `syncedAt=null`)
- `DELETE_EXPENSE`: soft-delete en Firestore si el gasto tenía `syncedAt`
- Tests: `expenseSync.test.ts` (4) + assert en `expense.handler.test.ts`

**Nota:** requiere **G1** (reglas Firestore para `expenses`).

---

### B4 — Panel admin (Electron) lee historial de ventas y turnos desde Firestore ✅ HECHA (2026-07-30)

**Estado:** Completada. Typecheck + suite verde (468 main + 77 renderer).

**Qué se hizo:**
- Nuevo `electron/licensing/historyFirestore.ts`: lee `shifts` / `sales` / `expenses` de Firestore y arma filas de historial; `mergeHistoryShiftRows` preferiendo local.
- `GET_HISTORY_SHIFTS` async: merge local+remoto si `isFirebaseAvailable()`; paginación tras el merge.
- `GET_HISTORY_SHIFT_DETAIL` async: si el turno no está en SQLite, arma detalle desde Firestore (sin señas/fiados aún no sync).
- Tests: mocks Firebase off por defecto; casos de merge y detalle remoto; `historyFirestore.test.ts` para merge.

**Limitaciones aceptadas:** detalle remoto no incluye deposits/debts (aún no sync). `cashierName` remoto puede ser `userId` si no hay cache local de usuarios.

---

## BLOQUE C — App móvil: sección admin

### C1 — Agregar sección admin en apps/mobile para ver turnos y ventas ✅ HECHA (2026-08-01)

**Estado:** Completada. `pnpm --filter @carniceria/mobile build` + tests verdes.

**Qué se hizo:**
- `src/lib/adminHistory.ts`: lee `stores` / `shifts` / `sales` de Firestore; `sumPaymentTotals` para totales por medio.
- `src/components/AdminDashboard.tsx`: selector de local, lista de turnos (abiertos/cerrados), detalle con ventas y totales.
- `App.tsx`: si `profile.role === 'admin'` → `AdminDashboard` (sin POS).
- Test unitario de `sumPaymentTotals`.

**Limitaciones aceptadas:** solo lectura; requiere internet; no incluye gastos/fiados/señas en esta pantalla.

---

## BLOQUE D — Empleados y carniceros

### D1 — Migración DB: tablas de empleados, asistencia y vales ✅ HECHA (2026-08-02)

**Estado:** Completada. Typecheck + migraciones verdes.

**Qué se hizo:**
- Reemplazó el esquema preliminar de `0000` (`employees` con store/role, `employee_advances`, `attendance` vieja) por el modelo D1.
- Migración `0020_employees_ops.sql`: DROP de tablas preliminares + CREATE de `employees`, `attendance`, `employee_vales`, `salary_payments`.
- `syncedAt` incluido en attendance/vales/salary (anticipado F1).
- Índice único `(employee_id, date)` en attendance para upsert de D3.
- Tests de migraciones actualizados (`employee_vales` + `salary_payments`).

**Verificación:** `pnpm --filter desktop run typecheck` + tests de migraciones OK.

---

### D2 — IPC handlers para empleados (CRUD) ✅ HECHA (2026-08-02)

**Estado:** Completada. Typecheck + tests del handler verdes.

**Qué se hizo:**
- Canales `LIST_EMPLOYEES` / `CREATE_EMPLOYEE` / `UPDATE_EMPLOYEE` / `ARCHIVE_EMPLOYEE`.
- `employees.handler.ts`: Zod, solo admin en mutaciones; nombre único case-insensitive; archive = `active=false`.
- Preload + tipos `EmployeeRow` en `hw-api.ts`.
- Tests: payload inválido, conflicto de nombre, forbid cajera, CRUD + archive.

**Checklist manual:** `CHECKLIST_TEST_V1.md` (sección D2).

---

### D3 — IPC handlers para asistencia ✅ HECHA (2026-08-02)

**Estado:** Completada. Typecheck + tests del handler verdes.

**Qué se hizo:**
- Canales `RECORD_ATTENDANCE` / `UPDATE_ATTENDANCE` / `LIST_ATTENDANCE`.
- `attendance.handler.ts`: upsert por `(employeeId, date)`; cajera o admin; join a nombre en listados.
- `syncedAt=null` en escrituras (listo para F1).
- Preload + tipos `AttendanceRow` / payloads.
- Tests: registro, upsert, lista filtrada, payload inválido, archivado, NOT_FOUND.

**Checklist manual:** `CHECKLIST_TEST_V1.md` (sección D3).

---

### D4 — IPC handlers para vales ✅ HECHA (2026-08-02)

**Estado:** Completada. Typecheck + tests del handler verdes.

**Qué se hizo:**
- Canales `REGISTER_VALE` / `LIST_VALES` / `GET_WEEKLY_VALE_SUMMARY`.
- `vales.handler.ts`: requiere turno activo; transacción vale + `expenses` (concepto `Vale: {nombre}`) para que `cashInHand` baje.
- Resumen semanal: `weekStart` (lunes) → domingo; `netToPay = max(0, wage - vales)`.
- Push fire-and-forget de expenses; `syncedAt=null` en vale (F1).
- Tests: gasto suma al turno, NO_SHIFT, lista, summary.

**Checklist manual:** `CHECKLIST_TEST_V1.md` (sección D4).

---

### D5 — IPC handler para pago de salario semanal ✅ HECHA (2026-08-02)

**Estado:** Completada. Typecheck + tests del handler verdes.

**Qué se hizo:**
- Canal `PAY_WEEKLY_SALARY`.
- `salary.handler.ts`: turno activo; `netPaid = amount - valesDeducted`; gasto solo si neto > 0; conflicto si ya hay pago esa semana.
- Concepto de gasto `Salario: {nombre}` (afecta `cashInHand`).
- Preload + tipos `SalaryPaymentRow` / `PayWeeklySalaryPayload`.
- Tests: neto/gasto, neto 0, duplicado, NO_SHIFT, payload inválido.

**Checklist manual:** `CHECKLIST_TEST_V1.md` (sección D5).

---

### D6 — UI: Pantalla de gestión de empleados (admin) ✅ HECHA (2026-08-02)

**Estado:** Completada. Typecheck verde.

**Qué se hizo:**
- `EmployeesScreen.tsx`: lista, modal crear/editar (`NumericInput` sueldo), confirmar archivar.
- Acceso desde `AdminHubScreen` + ruta `employees` en `App.tsx`.
- Truncate + `title` en nombres; botones `shrink-0`.

**Checklist manual:** `CHECKLIST_TEST_V1.md` (sección D6).

---

### D7 — UI: Registro de asistencia (cajera y admin) ✅ HECHA (2026-08-02)

**Estado:** Completada. Typecheck verde.

**Qué se hizo:**
- `AttendanceModal.tsx`: lista empleados activos; estados presente/ausente/tarde/retiro anticipado; nota obligatoria si ausente.
- Guarda con `recordAttendance` (upsert del día); al reabrir precarga registros existentes.
- Acceso: botón “✓ Asistencia” en `CashierScreen` y tarjeta en `AdminHubScreen`.
- Helper `todayLocalYmd()` en `datetime.ts` para la fecha local YYYY-MM-DD.

**Checklist manual:** `CHECKLIST_TEST_V1.md` (sección D7).

---

### D8 — UI: Vales y pago semanal (cajera y admin) ✅ HECHA (2026-08-02)

**Estado:** Completada. Typecheck verde.

**Qué se hizo:**
- `ValesModal.tsx`: empleados, resumen semanal, lista de vales, registro con `NumericInput` (descuenta caja).
- `SalaryPaymentModal.tsx`: liquidación + **pago en caja** (turno abierto). Nota opcional. Snapshot de vales. Semanas anteriores. IPC `payWeeklySalary` + `listSalaryPayments` + `getRemoteSalaryWeek`.
- **Revertido para 1.0 (2026-08-24) / hecho 2026-08-25:** ver **BLOQUE J** / `PLAN.md` FEAT-PAYROLL-01.
- Accesos: **💵 Vales** en `CashierScreen`; **Liquidación semanal** en `AdminHubScreen`.
- Helpers `weekStartMondayLocalYmd` / `addDaysYmd` en `datetime.ts`.

**Checklist manual:** `CHECKLIST_TEST_V1.md` (sección D8).

---

## BLOQUE E — Conteo dominical de stock

### E1 — Migración DB: tabla stock_counts ✅ HECHA (2026-08-02)

**Estado:** Completada. Migración `0021_stock_counts` + test de tablas.

**Qué se hizo:**
- Tablas `stock_counts` / `stock_count_items` en schema + SQL journal.
- `quantityKg` en gramos; `productId` = PLU.

---

### E2 — IPC handlers para conteos de stock ✅ HECHA (2026-08-02)

**Estado:** Completada. Typecheck + **11 tests nuevos** en `stockCount.handler.test.ts`.

**Qué se hizo:**
- Canales CREATE / LIST / GET_DETAIL.
- Cajera requiere turno; admin puede sin turno.
- Transacción atómica header + items; filtros por local/fechas.

---

### E3 — UI: Formulario de conteo dominical ✅ HECHA (2026-08-02)

**Estado:** Completada. Typecheck verde. Buscador por nombre/PLU en el modal. Operativamente lo harían carniceros (rol pendiente); hoy admin/cajera; ~1×/semana.

**Qué se hizo:**
- `StockCountModal`: catálogo del local; kg con `DecimalInput` (→ gramos); unidades con `NumericInput`.
- `StockCountHistoryScreen`: filtros + detalle (admin).
- Accesos: **⚖️ Conteo** en cajera; hub admin (nuevo + historial).

**Checklist manual:** `CHECKLIST_TEST_V1.md` (sección E).

---

## BLOQUE F — Sync de empleados/asistencia/vales a Firestore

### F1 — Sync de asistencia, vales y pagos de salario a Firestore ✅ HECHA (2026-08-02)

**Estado:** Completada. Typecheck + **tests nuevos** en `employeeSync.test.ts`.

**Qué se hizo:**
- `syncedAt` ya existía desde D1 en attendance / employee_vales / salary_payments.
- `employeeSync.ts`: push outbox a `attendance`, `employeeVales`, `salaryPayments` (+ `employeeName`).
- Fire-and-forget desde handlers de asistencia/vales/salario; drenaje en login y select-store.
- No-op en `APP_ENV=dev` (`isFirebaseAvailable`).

**Checklist manual:** `CHECKLIST_TEST_V1.md` (sección F1).

---

## Notas de producto (ago 2026)

- **Asistencia:** pausada en operación; puede retirarse. UI queda marcada como “(pausado)”.
- **Vales remotos:** admin móvil (tab Vales) + hub desktop “Vales (remoto)” leen `employeeVales` desde Firestore.
- **Rol carnicero:** no existe; conteo de stock lo usan admin/cajera de momento.
- **Pago a empleado (cajera):** Menú → **Liquidación / pago de sueldo**. Neto = sueldo − vales (no monto libre). Gasto `Salario: {nombre}`. Nota opcional. Reemplaza el gasto suelto `Pago: {nombre}`.
- **Tickets balanza / barcode “emergencia”:** el bloqueo de AGENTS.md (decodificar ticket KRETZ) **no es prioritario**. En operación real, si el lector no trae datos, ya existe **carga manual** (producto + kg/precio). Eso cubre el caso del local.
- **App móvil ≠ port completo del desktop:** el POS es de **emergencia** (sin conteo, cierre con arqueo, saldar dedicado ni deuda cross-local). Sí tiene cobro, vuelto, fiado, gasto **con proveedor**, ingreso, vales, liquidación de la semana y historial de cierres con etiqueta Móvil. Recorte: `PLAN.md` **FEAT-MOB-EMERGENCY-01**. Unificar caja en vivo = DT-06.
- **Locales de cajera (`authorizedStores`):** editable en hub → Gestión de cajeras (crear + botón Locales). En móvil, el selector de local usa esa lista; con 1 solo local salta directo a abrir turno.
- **Catálogo ago 2026:** fuente `apps/desktop/scripts/catalog-2026-08.json`; PDF `LISTA_PRECIOS.pdf`. Wipe total (pruebas): `pnpm --filter desktop db:wipe:prod` (conserva locales, borra ventas/fiados/etc. y deja solo catálogo nuevo).

---

## BLOQUE H — Local habitual de carniceros / cajeras ✅ HECHA (2026-08-28)

> **Estado:** Completada. Checklist de prueba: `CHECKLIST_TESTEO_CIERRE_Y_HABITUAL.md`.

### Problema
Hay carniceros (y cajeras) que suelen trabajar en un local, pero a veces van al otro. La lista de asistencia/vales no debe mostrar a todo el mundo en ambos locales, sin perder el caso excepcional.

### Invariante de sync (no se rompió)
- El **maestro `employees` es único y compartido** entre locales (Firestore + SQLite cache).
- Un carnicero es **el mismo perfil** en A y en B (mismo `id`).
- Asistencia, vales y salarios semanales se acumulan por `employeeId`, **no por local**.
- Las cajeras ya eligen local al login; su identidad Auth es única.

### Qué se hizo
- Campo opcional `employees.homeStoreId` (A | B | null = ambos). Migración `0034_employee_home_store`.
- `attendance.storeId` para saber si la marca de hoy es de este local o del otro (unique sigue `(employeeId, date)`).
- Asistencia (PC): habitual de este local, sin asignar, o ya marcados hoy **en este** local. Oculta quien ya marcó hoy en otro. **Agregar visitante**.
- Vales (PC + celu): mismo filtro de habitual + visitante, **sin** la regla de asistencia.
- Admin Personal: asignar/editar habitual al crear/editar.
- Sync Firestore de `homeStoreId` y `storeId` de asistencia.

### No hacer (sigue vigente)
- Inferir local por historial automático.
- Duplicar empleados por local.
- Bloquear vales/asistencia de forma dura por local.

---

## BLOQUE G — Firestore Security Rules

### G1 — Actualizar reglas de Firestore para nuevas colecciones ✅ HECHA (2026-07-30)

**Estado:** Completada. `firebase deploy --only firestore:rules` OK en proyecto `arimark-7f418`.

**Qué se hizo:**
- Agregadas reglas (read/create/update si `auth != null`; `delete: false`) para:
  - `shifts`, `sales`, `expenses` (B1–B3)
  - `attendance`, `employeeVales`, `salaryPayments`, `stockCounts` (anticipadas D/E/F)
- Soft-delete vía `update` (campo `deleted`) permitido; hard delete prohibido.

---

## BLOQUE I — Catálogo en vivo + edición por cajera ✅ HECHA (2026-08-30)

> **Estado:** Completada. Checklist de prueba: `CHECKLIST_TESTEO_CIERRE_Y_HABITUAL.md` (aprobada 2026-09-02).

El merge por ítem ya existía (`catalogSync.ts`). Se agregó el **listener en vivo** (I-A) y la **edición por cajera en PC** (I-B).

### I-A — Listener en vivo
- Desktop: `onSnapshot` de `licenses/{tenant}/catalog/{storeId}` (1 doc por local). Merge; republica el union **solo** si el snapshot está incompleto (anti-loop). IPC `CATALOG_SYNC_UPDATED` recarga POS/lista/vales sin mutar el ticket.
- Celu: `onSnapshot` del mismo doc mientras hay local de POS. Cache IndexedDB. Sin panel de edición.
- El ↺ sigue como respaldo.

### I-B — Edición por cajera (PC)
- Menú caja → **Catálogo** (overlay sobre el POS; ya no hay «Lista de productos» aparte). Carrito se conserva.
- Cajera: crear ficha, editar nombre/PLU/categoría/unidad, precio, “quitar/mostrar” **solo su local**, y **Cargar en balanza**. Retiro global / versiones = solo admin (hub).
- Auditoría SQLite `catalog_audit_events` (migración `0035`).

**No se hizo (sigue vigente):** edición de catálogo en el celu; FEAT-CAT-03 backup masivo; sync automático a la KRETZ; Blaze. **DT-07/DT-08:** código 2026-09-04; ver `docs/FIRESTORE_DT07_DT08.md` (producción: índices + backfill + deploy).

**Spark (medir en jornada real, no en un domingo de pruebas):**
1. Firebase Console → proyecto `arimark-7f418` → Usage / Firestore Usage.
2. Un día de caja debería ir por cientos / pocos miles de lecturas (cupo 50.000/día). El catálogo es 1 doc por local.
3. Confirmar plan **Spark (no Blaze)**. Spark no cobra: si se pasa del cupo, corta el sync hasta el día siguiente.

---

## BLOQUE J — Pago de sueldo en caja + archivo semanal ✅ HECHA (2026-08-25)

> **Estado:** Hecho. Producto: `PLAN.md` **FEAT-PAYROLL-01**. Nota opcional (sin ajuste de monto). Cajera paga en PC con turno abierto; celu consulta el archivo.

**Qué hay:** UI Liquidación (Personal + menú caja), gasto `Salario: {nombre}`, 1 pago/semana, snapshot de vales, nota, navegación de semanas, `onSnapshot` de `salaryPayments` por `weekStart` en celu.

**No hacer en J (queda fuera):** descuento automático por asistencia; campo que cambia el neto; pago desde admin-móvil.

---

## BLOQUE K — Aporte de efectivo a caja ✅ HECHA (2026-08-28)

> **Estado:** Hecho. Producto: `PLAN.md` **FEAT-CASH-INJECT-01**. Pedido en testeo Parte 5; confirmado con el pack `FEAT-MOB-EMERGENCY-01`.

Cajera sin efectivo suficiente para un proveedor; admin manda plata. Movimiento que **suma** caja (monto + nota): `expenses.kind = 'inject'`. PC: sidebar Aporte. Celu: botón Aporte en el POS. No se lista junto a los gastos; entra a `cashInHand`.

---

## Orden recomendado de ejecución

Para maximizar valor entregable en orden:

1. ~~A1–A2~~ ✅
2. ~~B1–B4~~ ✅ (sync operativo + historial remote)
3. ~~C1~~ ✅ (admin PWA historial)
4. ~~D1–D8~~ ✅ código; **pendiente checklist manual** (`CHECKLIST_TEST_V1.md`)
5. ~~E1–E3~~ ✅ código; **pendiente checklist manual**
6. ~~F1 / G1~~ ✅
7. ~~Completar checklist en local real~~ ✅ ola **2026-08-28 cerrada** (`CHECKLIST_TESTEO_SESION.md`). Resumen post-cierre + BLOQUE H **hechos**. **BLOQUE I (A+B) hecho 2026-08-30.**
8. **Hecho 2026-09-02/04:** `FEAT-ORDER-CART-01` + `FEAT-BUTCHER-01` (código). Pedidos PC cerrado (`CHECKLIST_TESTEO_PEDIDOS_LISTA.md`). Acceso celular del carnicero vive en **Empleados** (`StaffScreen`). **Checklist horario + último local + carnicero C.4 cerrados 2026-09-07.** **DT-04 hecho 2026-09-06.** **DT-07/DT-08 código 2026-09-04** (`docs/FIRESTORE_DT07_DT08.md`; falta backfill `--apply` + deploy índices/reglas). **Pendiente v1.0 (no codear hasta que se pida):** `FEAT-CASH-HANDOVER-01` (cambio/billetes entre turnos, PC + celu). **`FEAT-AUTH-PASSWORD-01`** (cambio de contraseña por el usuario + plantilla de mail en español). **Después, cuando el desarrollador lo pida:** DT-02 (login offline PC), DT-03 (retomar turno propio). Fase 8 Stock sigue bloqueada. **BLOQUE I checklist cerrada 2026-09-02.**

---

## BLOQUE K — Carnicero móvil + carrito de pedidos (PC) ✅ HECHA (2026-09-02; UI acceso celular en StaffScreen 2026-09-04)

> **Estado:** Completada. Producto: `PLAN.md` **FEAT-BUTCHER-01** + **FEAT-ORDER-CART-01**.
> Pedidos PC testeado 2026-09-04. Carnicero celu: pendiente de testeo (`CHECKLIST_TESTEO_CARNICERO.md` B–D).

**Qué se hizo:**

Track B (PC):
- `orders` tabla: columnas `readyAt`, `readyBy`, `readyByName` (auditoría de Listo) y `budgetItems` (JSON del carrito de presupuesto). Migración `0036_orders_ready_budget.sql`.
- `OrdersScreen.tsx`: carrito de presupuesto con typeahead, kg/u estimados, total en vivo. Botón **Listo** de vuelta con nombre del que marcó.
- Cobrar → inyecta el carrito en el POS (no venta ficticia). Seña descontada como crédito.

Track A (empleados / auth):
- `employees` tabla: columna `firebaseUid` (nullable, unique). Migración `0037_employees_firebase_uid.sql`.
- Desktop **Empleados** (`StaffScreen`): "Dar acceso al celular" (email obligatorio) / "Revocar acceso" en la ficha. IPC `GRANT_BUTCHER_ACCESS` + `REVOKE_BUTCHER_ACCESS`. (`EmployeesScreen` no está en el menú.)
- `session.ts`: rechaza login desktop de carnicero con mensaje claro.
- Helper `tenantAuth.ts` compartido entre cajeras y carniceros.

Shell móvil carnicero:
- `ButcherApp.tsx`: selector de local (persiste, cambia libremente), pedidos pendientes del local agrupados por día/turno, botón **Listo** solo con red.
- "Mi semana": sueldo + vales + neto de la semana en curso. Sin historial.
- `butcherOrders.ts` + `butcherPayroll.ts`: queries Firestore filtradas (no baja colecciones enteras).
- `auth.ts` + `LocalProfile`: acepta rol `butcher` + `employeeId`.
- `App.tsx`: rutea `butcher` a `ButcherApp`.

---

## BLOQUE L — Entrega del cambio (billetes) entre turnos ⏳ PENDIENTE v1.0

> **Estado:** No implementada. Producto: `PLAN.md` **FEAT-CASH-HANDOVER-01**. Acordado 2026-09-07. **No codear hasta que el desarrollador lo pida.**

El cierre ya cuenta billetes y suma; la apertura no muestra ese “cambio”. La hoja del día cubre el relevo. Hay que: precargar la grilla al abrir, permitir corregir **sin tocar** el cierre anterior, guardar las dos versiones para auditoría, conteo obligatorio en producción (cero solo con modal), y el mismo flujo en **PC y celu** (el desglose tiene que ir a Firestore; hoy es solo SQLite).

---

## BLOQUE M — Contraseña del usuario + mail en español ⏳ PENDIENTE v1.0

> **Estado:** No implementada. Producto: `PLAN.md` **FEAT-AUTH-PASSWORD-01**. Acordado 2026-09-07. **No codear hasta que el desarrollador lo pida.**

Cada usuario cambia o restablece su clave (login “olvidé contraseña” y cambio ya logueado). El admin no lo hace por ellos. Plantilla del mail de Firebase en español; el remitente Spark sigue siendo el de Firebase.

---

## Notas para el agente que ejecute estas tareas

- **Siempre usar `pnpm`**, nunca `npm` ni `yarn`.
- **Nunca `type="number"` en inputs numéricos.** Usar el componente `src/components/NumericInput.tsx`.
- **Todo handler IPC valida payload con Zod** antes de procesar.
- **Toda escritura multi-tabla en transacción atómica** (`db.transaction()`).
- **Sin `any` en TypeScript.** Usar `unknown` con comentario si es temporal.
- **Timestamp del journal** (`drizzle/meta/_journal.json`): el campo `when` de cada migración nueva debe ser mayor al `when` de la migración anterior. Usar `Date.now()` al momento de escribir.
- **Tests**: cada handler nuevo necesita su archivo de tests en `electron/ipc/__tests__/<handler>.test.ts` cubriendo: payload válido, payload malformado (Zod rechaza), y al menos un caso de error de negocio.
- **Ejecutar `pnpm run test` al terminar cada tarea** antes de cerrarla.
- **Ejecutar `pnpm run typecheck`** (`tsc --noEmit && tsc -p tsconfig.node.json --noEmit`) al terminar cada tarea.
- Los tests de DB usan siempre la instancia `:memory:` de `electron/db/__tests__/helpers/inMemoryDb.ts`.
