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

### B3 — Sync de gastos a Firestore al registrar

**Contexto:**
Los gastos (`expenses`) ya tienen `syncedAt` en schema (definido pero no usado para este fin todavía — se usa para proveedores vía `provider_debt_events`, no para el gasto en sí).
Ruta en Firestore: `licenses/{tenant_id}/expenses/{expenseId}`.

**Qué hacer:**
1. Leer `apps/desktop/electron/db/schema.ts` — verificar si `expenses` tiene `syncedAt`. Si no, agregar migración.
2. Leer `apps/desktop/electron/ipc/expense.handler.ts` — handlers `REGISTER_EXPENSE`, `UPDATE_EXPENSE`, `DELETE_EXPENSE`.
3. Crear `apps/desktop/electron/licensing/expenseSync.ts` con `pushUnsyncedExpenses(tenantId)`.
   - Para `DELETE_EXPENSE`: marcar `deleted: true` en Firestore (soft delete, igual que debt events).
   - Para `UPDATE_EXPENSE`: re-push con datos actualizados.
4. Llamar en los handlers correspondientes (fire-and-forget, no bloqueante).
5. Tests.

**Verificación:** `pnpm run typecheck` verde. `pnpm run test` verde.

---

### B4 — Panel admin (Electron) lee historial de ventas y turnos desde Firestore

**Contexto:**
El panel admin en la app Electron tiene `apps/desktop/src/routes/HistoryScreen.tsx` que hoy lee solo de SQLite local.
Un admin en su PC de casa no tiene datos en SQLite local — necesita leer de Firestore.
Patrón: si `isFirebaseAvailable()` y el resultado de SQLite local está vacío (o el admin abrió sesión sin turno de este local), leer de Firestore. Similar a como funciona `GET_PROVIDERS_WITH_DEBT`.

**Qué hacer:**
1. Leer `apps/desktop/electron/ipc/history.handler.ts` — handlers `GET_HISTORY_SHIFTS` y `GET_HISTORY_SHIFT_DETAIL`.
2. Leer `apps/desktop/electron/ipc/providers.handler.ts` — ver cómo `getProvidersWithDebtFromFirestore` hace fallback a local.
3. En `history.handler.ts`, modificar `GET_HISTORY_SHIFTS`:
   - Si `isFirebaseAvailable()`, consultar `licenses/{tenant_id}/shifts` en Firestore (filtrado por `storeId` si se requiere, o todos para admin).
   - Fusionar con SQLite local (mismo patrón que proveedores: IDs como dedup key).
   - Devolver resultado combinado ordenado por fecha.
4. En `GET_HISTORY_SHIFT_DETAIL`: leer detalles de ventas desde Firestore si no están en SQLite.
5. Actualizar tests.

**Verificación:** `pnpm run typecheck` verde. `pnpm run test` verde. Un admin en PC diferente puede ver el historial de otro local.

---

## BLOQUE C — App móvil: sección admin

### C1 — Agregar sección admin en apps/mobile para ver turnos y ventas

**Contexto:**
`apps/mobile` es una app Capacitor. El rol del usuario logueado se lee de Firestore (campo `role` en perfil).
Los admins hoy no tienen ninguna pantalla útil en la app móvil.
Necesitan poder ver: turnos del día por local, ventas del turno seleccionado, total por medio de pago.

**Qué hacer:**
1. Leer `apps/mobile/src/lib/auth.ts` para entender cómo se obtiene el rol del usuario.
2. Leer `apps/mobile/src/App.tsx` para entender el routing actual.
3. Crear `apps/mobile/src/routes/AdminDashboard.tsx`:
   - Selector de local (dropdown con los stores del tenant).
   - Lista de turnos del local seleccionado (leídos de `licenses/{tenant_id}/shifts`, filtrado por `storeId`, ordenado por `startedAt` desc).
   - Click en turno → ver ventas de ese turno (leídas de `licenses/{tenant_id}/sales`, filtrado por `shiftId`).
   - Total por medio de pago calculado en frontend.
4. En `App.tsx`: si `user.role === 'admin'`, mostrar `AdminDashboard` como pantalla inicial (en lugar del POS).
5. Los admins ven datos, no operan el POS.

**Verificación:** `pnpm --filter @carniceria/mobile build` sin errores de TypeScript.

---

## BLOQUE D — Empleados y carniceros

### D1 — Migración DB: tablas de empleados, asistencia y vales

**Contexto:**
Los carniceros se registran solo por nombre (sin cuenta Firebase, sin login).
La asistencia se registra por fecha y estado. Los vales son adelantos de salario.
El salario semanal es configurable por empleado.

**Qué hacer:**
1. Leer `apps/desktop/electron/db/schema.ts` para entender la estructura existente.
2. Leer `apps/desktop/drizzle/meta/_journal.json` para ver el último `when` y usar uno mayor.
3. Agregar en `schema.ts`:
   ```typescript
   export const employees = sqliteTable('employees', {
     id: text('id').primaryKey(),
     name: text('name').notNull().unique(),
     weeklyWage: integer('weekly_wage').notNull().default(0),
     active: integer('active', { mode: 'boolean' }).notNull().default(true),
     createdAt: text('created_at').notNull(),
   })

   export const attendance = sqliteTable('attendance', {
     id: text('id').primaryKey(),
     employeeId: text('employee_id').notNull().references(() => employees.id),
     date: text('date').notNull(), // YYYY-MM-DD
     status: text('status').notNull(), // 'present' | 'absent' | 'late' | 'early_departure'
     note: text('note'),
     recordedBy: text('recorded_by').notNull().references(() => users.id),
     createdAt: text('created_at').notNull(),
   })

   export const employeeVales = sqliteTable('employee_vales', {
     id: text('id').primaryKey(),
     employeeId: text('employee_id').notNull().references(() => employees.id),
     shiftId: text('shift_id').references(() => shifts.id),
     amount: integer('amount').notNull(),
     description: text('description'),
     paidAt: text('paid_at').notNull(),
     recordedBy: text('recorded_by').notNull().references(() => users.id),
     createdAt: text('created_at').notNull(),
   })

   export const salaryPayments = sqliteTable('salary_payments', {
     id: text('id').primaryKey(),
     employeeId: text('employee_id').notNull().references(() => employees.id),
     shiftId: text('shift_id').references(() => shifts.id),
     amount: integer('amount').notNull(),
     weekStart: text('week_start').notNull(), // YYYY-MM-DD lunes de esa semana
     valesDeducted: integer('vales_deducted').notNull().default(0),
     netPaid: integer('net_paid').notNull(),
     recordedBy: text('recorded_by').notNull().references(() => users.id),
     paidAt: text('paid_at').notNull(),
   })
   ```
4. Generar migración con `pnpm --filter @carniceria/desktop db:generate`.
5. Agregar entrada en `drizzle/meta/_journal.json` con `when` mayor al último existente.
6. Agregar el archivo SQL generado en `drizzle/` al control de versiones.

**Verificación:** `pnpm run typecheck` verde. La migración aplica sin error en la DB dev.

---

### D2 — IPC handlers para empleados (CRUD)

**Contexto:**
ABM de empleados, solo admin. Nombre único como identificador natural.

**Qué hacer:**
1. Agregar en `apps/desktop/electron/ipc/channels.ts`:
   - `LIST_EMPLOYEES`, `CREATE_EMPLOYEE`, `UPDATE_EMPLOYEE`, `ARCHIVE_EMPLOYEE`
2. Crear `apps/desktop/electron/ipc/employees.handler.ts`:
   - `LIST_EMPLOYEES`: devuelve todos los activos (y archivados si se pide).
   - `CREATE_EMPLOYEE(name, weeklyWage)`: valida nombre único, inserta.
   - `UPDATE_EMPLOYEE(id, name?, weeklyWage?)`: actualiza campos.
   - `ARCHIVE_EMPLOYEE(id)`: soft-delete (active = false).
   - Todos validan sesión activa y rol admin.
   - Payloads validados con Zod.
3. Registrar handlers en `apps/desktop/electron/ipc/index.ts`.
4. Exponer en `apps/desktop/electron/preload.ts`.
5. Agregar tipos en `apps/desktop/src/types/hw-api.ts`.
6. Crear tests en `apps/desktop/electron/ipc/__tests__/employees.handler.test.ts`.

**Verificación:** `pnpm run test` verde.

---

### D3 — IPC handlers para asistencia

**Contexto:**
La cajera o admin puede registrar/editar la asistencia del día para cada carnicero.
Estados: `present`, `absent`, `late`, `early_departure`. Todos pueden tener nota opcional.
Solo un registro por empleado por fecha.

**Qué hacer:**
1. Agregar en `channels.ts`: `RECORD_ATTENDANCE`, `UPDATE_ATTENDANCE`, `LIST_ATTENDANCE`.
2. En `employees.handler.ts` (o archivo separado `attendance.handler.ts`):
   - `RECORD_ATTENDANCE(employeeId, date, status, note?)`: upsert por (employeeId, date).
   - `UPDATE_ATTENDANCE(id, status?, note?)`: actualiza.
   - `LIST_ATTENDANCE(startDate, endDate, employeeId?)`: lista con join a empleados.
3. Exponer en preload, agregar tipos.
4. Tests cubriendo: registro nuevo, upsert (mismo día), lista filtrada.

**Verificación:** `pnpm run test` verde.

---

### D4 — IPC handlers para vales

**Contexto:**
Un vale es un adelanto: el carnicero retira dinero o productos de la caja durante la semana.
Se registra durante un turno activo. Descuenta del efectivo en caja (es una salida de efectivo).
Al pagar salario semanal, los vales acumulados de esa semana se deducen automáticamente.

**Qué hacer:**
1. Agregar en `channels.ts`: `REGISTER_VALE`, `LIST_VALES`, `GET_WEEKLY_VALE_SUMMARY`.
2. Handlers:
   - `REGISTER_VALE(employeeId, amount, description?)`:
     - Requiere turno activo (`session.shiftId`).
     - Inserta en `employee_vales`.
     - **Descuenta del efectivo en caja**: registrar también en `expenses` con categoría `vale` y amount igual (para que `getShiftSummary` lo cuente como salida de efectivo). O manejar como tipo especial en `cash_flow`. Consultar cómo `getShiftSummary` calcula `cashInHand` para no romper la lógica existente.
   - `LIST_VALES(employeeId, weekStart?, weekEnd?)`: lista vales.
   - `GET_WEEKLY_VALE_SUMMARY(employeeId, weekStart)`: devuelve `{ totalVales, weeklyWage, netToPay }`.
3. Exponer en preload, agregar tipos.
4. Tests.

**Nota importante:** revisar `apps/desktop/electron/ipc/shift.handler.ts` handler `GET_SHIFT_SUMMARY` para entender cómo se calcula `cashInHand` y asegurarse de que los vales lo decrementan correctamente.

**Verificación:** `pnpm run test` verde. `cashInHand` se reduce al registrar un vale.

---

### D5 — IPC handler para pago de salario semanal

**Contexto:**
El pago de salario sale del efectivo de caja. No es un gasto del negocio sino una salida categorizada como `salary_payment`. Requiere turno activo. El admin verifica y aprueba; la cajera ejecuta desde la app con el monto calculado.

**Qué hacer:**
1. Agregar en `channels.ts`: `PAY_WEEKLY_SALARY`.
2. Handler `PAY_WEEKLY_SALARY(employeeId, weekStart, amount, valesDeducted)`:
   - Requiere turno activo.
   - Valida que `amount > 0`.
   - Inserta en `salary_payments`.
   - Registra salida de efectivo en `expenses` (o `cash_flow`) con categoría `salary_payment` para que `getShiftSummary` lo contabilice.
   - Transacción atómica.
3. Exponer en preload, agregar tipos.
4. Tests.

**Verificación:** `pnpm run test` verde. `cashInHand` se reduce al pagar salario.

---

### D6 — UI: Pantalla de gestión de empleados (admin)

**Contexto:**
Solo visible para admins. Lista empleados activos, permite crear/editar/archivar y configurar sueldo semanal.

**Qué hacer:**
1. Crear `apps/desktop/src/routes/EmployeesScreen.tsx`.
2. Lista de empleados con nombre, sueldo semanal, botones Editar / Archivar.
3. Modal de creación/edición: campo nombre (texto) y campo sueldo semanal (`NumericInput` — ver `src/components/NumericInput.tsx`, obligatorio para campos numéricos).
4. Validación: nombre no vacío, nombre único (error del IPC).
5. Aplicar reglas de UI del proyecto: `truncate` en texto largo, `shrink-0` en botones, `title` en textos truncados.
6. Agregar botón de acceso en `apps/desktop/src/routes/AdminHubScreen.tsx`.
7. Agregar ruta en `apps/desktop/src/App.tsx`.

**Verificación:** La pantalla renderiza, el flujo CRUD funciona sin errores de consola.

---

### D7 — UI: Registro de asistencia (cajera y admin)

**Contexto:**
La cajera o admin puede marcar la asistencia de carniceros al inicio o durante el turno.
Accesible desde la pantalla de cajera y desde el panel admin.

**Qué hacer:**
1. Crear `apps/desktop/src/routes/AttendanceModal.tsx`.
2. Lista de empleados activos con selector de estado para cada uno: `presente` / `ausente` / `llegó tarde` / `se retiró anticipado`.
3. Campo de nota opcional para `ausente` y `se retiró anticipado` (obligatorio para `ausente`).
4. Botón guardar — llama `RECORD_ATTENDANCE` por cada empleado con estado seleccionado.
5. Acceso desde botón en `CashierScreen.tsx` (barra de acciones superior) y desde `AdminHubScreen.tsx`.

**Verificación:** Modal abre, se puede marcar asistencia, los datos aparecen al reabrir.

---

### D8 — UI: Vales y pago semanal (cajera y admin)

**Contexto:**
La cajera puede registrar vales durante el turno. Al final de la semana, el admin ve el resumen y autoriza el pago de salario.

**Qué hacer:**
1. Crear `apps/desktop/src/routes/ValesModal.tsx`:
   - Lista de empleados activos.
   - Al seleccionar uno: muestra vales de la semana actual y total acumulado.
   - Botón "Registrar vale": campo monto (`NumericInput`) y descripción opcional. Confirma y descuenta de caja.
2. Crear `apps/desktop/src/routes/SalaryPaymentModal.tsx` (solo admin):
   - Lista empleados con sueldo semanal configurado.
   - Para cada uno: sueldo semanal, vales deducidos, neto a pagar.
   - Botón "Pagar salario" con doble confirmación mostrando el desglose.
   - Llama `PAY_WEEKLY_SALARY`.
3. Accesos en `CashierScreen.tsx` (vales, durante turno) y `AdminHubScreen.tsx` (pago de salario).

**Verificación:** Flujo completo funciona. El efectivo en caja se reduce al registrar vale y al pagar salario.

---

## BLOQUE E — Conteo dominical de stock

### E1 — Migración DB: tabla stock_counts

**Qué hacer:**
1. Agregar en `schema.ts`:
   ```typescript
   export const stockCounts = sqliteTable('stock_counts', {
     id: text('id').primaryKey(),
     storeId: text('store_id').notNull().references(() => stores.id),
     countDate: text('count_date').notNull(), // YYYY-MM-DD
     recordedBy: text('recorded_by').notNull().references(() => users.id),
     createdAt: text('created_at').notNull(),
   })

   export const stockCountItems = sqliteTable('stock_count_items', {
     id: text('id').primaryKey(),
     stockCountId: text('stock_count_id').notNull().references(() => stockCounts.id),
     productId: integer('product_id').notNull(), // PLU
     productName: text('product_name').notNull(),
     quantityKg: integer('quantity_kg'), // en gramos (evita decimales)
     quantityUnits: integer('quantity_units'),
     notes: text('notes'),
   })
   ```
2. Generar migración y actualizar `_journal.json` con `when` mayor al último.

**Verificación:** Migración aplica sin error.

---

### E2 — IPC handlers para conteos de stock

**Qué hacer:**
1. Agregar en `channels.ts`: `CREATE_STOCK_COUNT`, `LIST_STOCK_COUNTS`, `GET_STOCK_COUNT_DETAIL`.
2. Crear `apps/desktop/electron/ipc/stockCount.handler.ts`:
   - `CREATE_STOCK_COUNT(countDate, items[])`: crea header + items en transacción. Solo cajera con turno activo o admin.
   - `LIST_STOCK_COUNTS(storeId?, startDate?, endDate?)`: lista conteos con fecha y quien registró.
   - `GET_STOCK_COUNT_DETAIL(stockCountId)`: devuelve items del conteo.
3. Exponer en preload, agregar tipos.
4. Tests.

**Verificación:** `pnpm run test` verde.

---

### E3 — UI: Formulario de conteo dominical

**Qué hacer:**
1. Crear `apps/desktop/src/routes/StockCountModal.tsx`:
   - Formulario con un campo por producto (leídos del catálogo activo del local).
   - Campos de kg (usando `NumericInput`) y unidades (usando `NumericInput`).
   - Campo de nota opcional por ítem.
   - Al confirmar, llama `CREATE_STOCK_COUNT` con todos los ítems.
   - Muestra confirmación de guardado.
2. Crear `apps/desktop/src/routes/StockCountHistoryScreen.tsx`:
   - Lista de conteos pasados filtrable por local y fecha.
   - Al clickear un conteo: ver detalle con todos los ítems y cantidades.
   - Solo accesible para admin.
3. Acceso desde `AdminHubScreen.tsx` (ver historial) y desde `CashierScreen.tsx` o botón específico para el conteo semanal.

**Verificación:** Se puede cargar un conteo y verlo en el historial.

---

## BLOQUE F — Sync de empleados/asistencia/vales a Firestore

### F1 — Sync de asistencia, vales y pagos de salario a Firestore

**Contexto:**
Los admins deben ver esta información desde cualquier dispositivo. Mismo patrón outbox que proveedores.

**Qué hacer:**
1. Agregar columna `syncedAt` a `attendance`, `employee_vales`, `salary_payments` en la migración de D1 (o en migración adicional si D1 ya fue aplicada).
2. Crear `apps/desktop/electron/licensing/employeeSync.ts` con:
   - `pushUnsyncedAttendance(tenantId)`: push de registros con `syncedAt=null` a `licenses/{tenantId}/attendance/{id}`.
   - `pushUnsyncedVales(tenantId)`: push a `licenses/{tenantId}/employeeVales/{id}`.
   - `pushUnsyncedSalaryPayments(tenantId)`: push a `licenses/{tenantId}/salaryPayments/{id}`.
3. Llamar en los handlers correspondientes (fire-and-forget).

**Verificación:** `pnpm run typecheck` verde. `pnpm run test` verde.

---

## BLOQUE G — Firestore Security Rules

### G1 — Actualizar reglas de Firestore para nuevas colecciones

**Contexto:**
Cada vez que se agrega una colección nueva a Firestore, las reglas en `firebase/firestore.rules` deben incluirla.

**Qué hacer:**
1. Leer `firebase/firestore.rules` para entender la estructura actual.
2. Agregar reglas para:
   - `licenses/{tenantId}/shifts/{shiftId}` — read: auth != null; write: auth != null.
   - `licenses/{tenantId}/sales/{saleId}` — read: auth != null; write: auth != null.
   - `licenses/{tenantId}/expenses/{expenseId}` — read: auth != null; write: auth != null; (soft-delete como debt events).
   - `licenses/{tenantId}/attendance/{id}` — read: auth != null; write: auth != null.
   - `licenses/{tenantId}/employeeVales/{id}` — read: auth != null; write: auth != null.
   - `licenses/{tenantId}/salaryPayments/{id}` — read: auth != null; write: auth != null.
   - `licenses/{tenantId}/stockCounts/{id}` — read: auth != null; write: auth != null.
3. Deployar con `firebase deploy --only firestore:rules` desde la raíz del proyecto.

**Verificación:** `firebase deploy` exitoso sin errores.

---

## Orden recomendado de ejecución

Para maximizar valor entregable en orden:

1. **A1** (eliminar licencia) — desbloquea instalación simple
2. **A2** (renombrar license_key → tenant_id) — limpieza arquitectural
3. **B1** → **B2** → **B3** (sync turnos, ventas, gastos) — prerequisito para acceso remoto
4. **G1** (reglas Firestore) — necesario para que B1-B3 funcionen en producción
5. **B4** (admin Electron lee de Firestore) — cierra el loop del acceso remoto desktop
6. **C1** (admin mobile) — acceso remoto desde celular
7. **D1** → **D2** → **D3** → **D4** → **D5** (empleados DB + handlers) — base de datos primero
8. **D6** → **D7** → **D8** (empleados UI) — pantallas sobre la base
9. **E1** → **E2** → **E3** (stock count) — conteo dominical
10. **F1** (sync empleados/asistencia) — último, cuando todo lo anterior esté

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
