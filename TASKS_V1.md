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
- `SalaryPaymentModal.tsx`: panel **solo consulta** (bruto / vales / neto). El admin no registra pago; la cajera paga efectivo tras OK verbal. IPC `payWeeklySalary` queda en backend (legado/tests) sin UI.
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
- **Pago a empleado (cajera):** botón **💰 Pago** → elige empleado, ve neto de referencia, monto libre → gasto `Pago: {nombre}` (baja caja).
- **Tickets balanza / barcode “emergencia”:** el bloqueo de AGENTS.md (decodificar ticket KRETZ) **no es prioritario**. En operación real, si el lector no trae datos, ya existe **carga manual** (producto + kg/precio). Eso cubre el caso del local.
- **App móvil ≠ port del desktop:** hoy es un POS de respaldo (cajera: turno/venta/catálogo) + admin solo lectura (historial/vales). Paridad total con desktop sería un proyecto grande (no hay SQLite/IPC/hardware en el celular).
- **Locales de cajera (`authorizedStores`):** editable en hub → Gestión de cajeras (crear + botón Locales). En móvil, el selector de local usa esa lista; con 1 solo local salta directo a abrir turno.
- **Catálogo ago 2026:** fuente `apps/desktop/scripts/catalog-2026-08.json`; PDF `LISTA_PRECIOS.pdf`. Wipe total (pruebas): `pnpm --filter desktop db:wipe:prod` (conserva locales, borra ventas/fiados/etc. y deja solo catálogo nuevo).

---

## BLOQUE H — Local habitual de carniceros / cajeras (PENDIENTE — no implementar aún)

> **Estado:** Idea acordada (ago 2026). **No implementar** hasta decidir prioridad vs. otras features.
> Motivo del aplazamiento: no sumar features nuevas antes del testeo en carnicería.

### Problema
Hay carniceros (y cajeras) que suelen trabajar en un local, pero a veces van al otro. Hoy la lista de asistencia/vales muestra todos los activos en ambos locales. Se quiere filtrar sin perder el caso excepcional.

### Invariante de sync (ya vigente — no romper)
- El **maestro `employees` es único y compartido** entre locales (Firestore + SQLite cache).
- Un carnicero es **el mismo perfil** en A y en B (mismo `id`).
- Asistencia, vales y salarios semanales se acumulan por `employeeId`, **no por local**.
- Si el carnicero 4 saca un vale en A y otro en B la misma semana, el resumen semanal / pago de salario debe ver **la suma**.
- Las cajeras ya eligen local al login; su identidad Auth es única. Este bloque no inventa un segundo perfil por local.

### Diseño acordado (UI)
1. Campo opcional en empleado: **local habitual** (`homeStoreId`: A | B | null = ambos).
2. Lista de Asistencia en el local actual:
   - Muestra: habitual = este local, sin asignar, o ya marcados hoy **en este** local.
   - Oculta: quien ya tiene asistencia **hoy en otro** local.
   - Botón **"Agregar visitante"** → carniceros de otro habitual aún no marcados hoy en ningún lado.
3. Vales: mismo filtro por habitual + visitante (sin la regla “ya marcado en otro local”; un vale no implica asistencia).
4. Admin Empleados: asignar/editar local habitual al crear/editar.

### No hacer
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

## BLOQUE I — Catálogo en vivo + edición por cajera (PENDIENTE — no implementar aún)

> **Estado:** Decisiones 15–16 ago 2026. **No implementar** hasta que el desarrollador lo pida.
> El **merge por ítem** del catálogo ya está en código (`catalogSync.ts`). Falta el **listener en vivo** y, aparte, la edición por cajera (más abajo).

### Problema
Hoy el catálogo se publica a Firestore al guardar (con merge), pero el resto de PCs y el celular **no reciben el cambio en vivo** (hace falta ↺ o re-login). Empleados/locales/pedidos sí tienen `onSnapshot`. Las cajeras no tienen pantalla de catálogo.

### A — Listener en vivo (prioridad; se puede hacer sin la parte B)

**Decisión (16 ago 2026):** el catálogo debe actualizarse en otras PCs/celular **igual que un empleado** (sin depender del ↺), quedando en el **plan gratis de Firebase (Spark)**. Costo objetivo: **$0**. No activar Blaze “por las dudas”.

**Comportamiento**
- `onSnapshot` del doc `licenses/{tenant}/catalog/{storeId}` (un documento por local, no una lectura por producto).
- Al llegar un cambio: **merge** con SQLite (altas se unen, gana el dato más nuevo por ítem, bajas globales se propagan) y **republicar** el union si hace falta — **no** pisar con un snapshot incompleto.
- Aviso IPC al renderer: POS, lista de productos y carga manual **releen** el catálogo.
- **POS:** no cambiar precio/nombre de ítems **ya en el ticket**. Solo lista / altas nuevas / siguiente escaneo.
- Celular: el mismo doc; al reconectar o con listener si hay red. Sigue sin panel de edición.
- El ↺ queda como respaldo (sin internet, listener caído, o para forzar).

**Cuota — no preocuparse de antemano; medir en jornada real**
Cuando la app esté en uso real (varios días de caja), el desarrollador mira el consumo. Un día típico de esta escala debería ir por **cientos / pocos miles** de lecturas, lejos de las **50.000/día** del Spark. Si un día se llega cerca de ese techo, ahí sí hablar; Spark **no cobra**, corta el sync hasta el día siguiente.

**Cómo ver el consumo (recordárselo al desarrollador al implementar / al primer deploy real):**
1. [Firebase Console](https://console.firebase.google.com) → proyecto `arimark-7f418` (o el que esté en uso).
2. Menú **Usage and billing** (o el proyecto → **Usage**). Ahí está el resumen del día: lecturas / escrituras Firestore vs cupo gratis.
3. Más fino: **Build → Firestore Database → pestaña Usage** (gráfica de reads/writes/deletes por día).
4. Qué mirar: lecturas de **un día de caja abierto** (no un domingo de pruebas). Si estás en ~1–5 % de 50.000, ignorar. Si un día saltás a decenas de miles, revisar listeners de colecciones grandes (no el catálogo: es 1 doc).
5. Confirmar que el plan siga en **Spark (no Blaze)** en Configuración del proyecto → **Uso y facturación**. Si aparece Blaze y hay tarjeta, ahí sí puede haber cargo al pasarse del cupo.

**No hacer en A:** activar facturación; listener de ventas/historial completo; sync automático a la KRETZ.

### B — Edición por cajera (mismo bloque, no mezclar con A)

Hoy solo el admin tiene pantalla de catálogo. Las cajeras no pueden ajustar precios ni productos si el admin está ocupado.

**Fuente de verdad tras un guardado confirmado:** se publica (con merge) el local afectado. El resto lo recibe por el listener de A.

**Quién edita**
- **Admin y cajera** pueden crear productos, editar nombre/categoría/unidad/PLU, y cambiar precios.
- Edición de catálogo en **PC**. El celular **recibe** la lista actualizada; no tiene panel de edición.
- Cajera: precio (y “borrar” de lista, ver abajo) solo del **local en el que está operando**.
- Admin: puede cambiar precios de **cualquier** local.

**Qué es global vs por local**
- **Global (una sola ficha):** nombre, PLU, categoría, unidad, alta. Baja **global** (liberar PLU) = solo admin.
- **Por local:** precio vigente y visibilidad (`store_products`). “Borrar” de cajera = ocultar en **ese** local, no `products.active = false`.

**Auditoría (entra en B, no es extra futuro)**
- Precios: ya hay historial por local (`product_prices` + `createdBy`).
- Alta / edición de ficha / “quitar de este local” / retiro global: registrar quién, qué y cuándo.

**Fuera de este bloque (anotado para más adelante)**
- Backup / rollback de catálogo o lote masivo de precios (**FEAT-CAT-03**). **No implementar ahora.**
- La balanza KRETZ **no** se actualiza sola; sigue “Cargar en balanza”.

### Diseño técnico (cuando se implemente A)
- Listener `onSnapshot` del doc de catálogo por local (mismo patrón que stores/providers/employees).
- Reutilizar `syncCatalogWithFirestore` / merge; **no** volver a “Firestore pisa SQLite”.
- IPC push al renderer para recargar lista sin ↺.
- Tests: snapshot nuevo aplica merge; PC con lista corta no borra altas locales; UI recibe aviso.

### No hacer
- Soft-delete global (`active=false`) cuando una cajera “borra” (parte B).
- Listener que pise un guardado local que **aún no** se publicó.
- Edición de catálogo en la app móvil.
- Rollback / backup de precios masivos.
- Sync automático a la KRETZ.
- Plan Blaze “por si acaso”.

---

## Orden recomendado de ejecución

Para maximizar valor entregable en orden:

1. ~~A1–A2~~ ✅
2. ~~B1–B4~~ ✅ (sync operativo + historial remote)
3. ~~C1~~ ✅ (admin PWA historial)
4. ~~D1–D8~~ ✅ código; **pendiente checklist manual** (`CHECKLIST_TEST_V1.md`)
5. ~~E1–E3~~ ✅ código; **pendiente checklist manual**
6. ~~F1 / G1~~ ✅
7. **Ahora:** completar checklist en local real — no abrir H ni I todavía
8. **Después del testeo / cuando el desarrollador lo pida:** BLOQUE H (local habitual). BLOQUE I-A (listener catálogo en vivo, Spark $0) y I-B (edición cajera). Al implementar I-A, recordar cómo ver Usage en Firebase Console (instrucciones en el bloque).

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
