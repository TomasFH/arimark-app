# Checklist de testing — Bloque D/E/F (v1.0)

Guía para validar lo implementado. Ir marcando con `[x]` al confirmar.

> **Backend (D1–D5, E1–E2, F1 outbox, suite):** cubierto por tests automatizados — no requiere revisión manual.
> **Tu foco restante:** F1 sync real en Firestore + smoke de punta a punta (cuando puedas, con calma).

---

## Cubierto por tests _(no requiere revisión manual)_

### D1 — Migración empleados / asistencia / vales / salarios

- [x] Tablas `employees`, `attendance`, `employee_vales`, `salary_payments` creadas por migraciones (`migrations.test.ts`)
- [ ] Abrir `pnpm dev` / `pnpm build:prod` — la app arranca sin error de migración / “no such column” _(smoke en tu PC)_
- [ ] La app sigue operando normal (login, locales, ventas) tras la migración _(smoke en tu PC)_

### D2 — IPC CRUD empleados

- [x] Sin sesión / cajera → `FORBIDDEN` o `NO_SESSION`
- [x] Admin crea empleado → `ok` + `id`
- [x] Nombre duplicado → `CONFLICT`
- [x] Payload inválido → `INVALID_PAYLOAD`
- [x] Update / archive / `includeArchived`

### D3 — IPC asistencia

- [x] Sin sesión → `NO_SESSION`
- [x] Registro + upsert mismo día
- [x] Fecha mal formada → `INVALID_PAYLOAD`
- [x] Empleado archivado → `CONFLICT`
- [x] Lista por rango / update `NOT_FOUND`

### D4 — IPC vales

- [x] Sin turno → `NO_SHIFT`
- [x] Monto ≤ 0 → `INVALID_PAYLOAD`
- [x] Vale OK + baja `cashInHand` + gasto `Vale: {nombre}`
- [x] Resumen semanal `netToPay`

### D5 — IPC pago salario _(backend legado; la UI admin ya no lo usa)_

- [x] Sin turno → `NO_SHIFT`
- [x] `valesDeducted > amount` → `INVALID_PAYLOAD`
- [x] Pago OK (gasto neto) / duplicado `CONFLICT` / neto 0 sin gasto

### E1–E2 — Conteo stock (backend)

- [x] Migración `0021` (`stock_counts`, `stock_count_items`)
- [x] `stockCount.handler.test.ts` (create/list/detail + zod + NO_SHIFT)

### F1 — Sync outbox (lógica local)

- [x] Push de `syncedAt=null` a paths Firestore (mock) + marca `syncedAt`
- [x] No-op si Firebase no disponible (`APP_ENV=dev`)

### Suite

- [x] `pnpm --filter desktop run test` verde

---

## Revisión manual — UI y producción

### D6 — UI empleados (admin)

- [x] Login **admin** → hub → aparece **Empleados**
- [x] Entrar: lista vacía o con datos previos; “+ Nuevo” abre modal
- [x] Crear con nombre + sueldo (`NumericInput`) → aparece en la lista con truncate si el nombre es largo
- [x] Nombre duplicado → mensaje de error (sin cerrar mal el modal)
- [x] Editar nombre/sueldo → se refleja en la lista
- [x] Archivar → desaparece de la lista activa; confirmar diálogo
- [x] **Ver archivados** → lista de archivados; **Restaurar** vuelve a activos
- [x] Crear con nombre de un archivado → mensaje que indica restaurar (no crear duplicado)
- [x] Volver (←) regresa al hub admin
- [x] Sin errores de consola en el flujo

### Sync locales (regresión remota)

- [x] Editar nombre/datos de un local en `pnpm dev:prod` (admin)
- [x] Abrir `pnpm electron:remote`, login cajera → el local muestra el nombre actualizado en el selector / gestión

### D7 — UI asistencia

- [x] Cajera (turno abierto): barra superior muestra **✓ Asistencia**
- [x] Admin hub: aparece tarjeta **Asistencia**
- [x] Modal lista empleados activos; sin empleados → mensaje claro
- [x] Empleados creados en admin (otra PC / `electron:remote`) aparecen tras login cajera _(sync maestro `employees`)_
- [x] Marcar presente / ausente / llegó tarde / se retiró anticipado
- [x] Ausente / se retiró anticipado: nota **opcional** (no bloquea guardar)
- [x] Guardar → mensaje de éxito y el modal se cierra; reabrir → estados y notas precargados
- [x] Cambiar un estado y guardar de nuevo → upsert (sin duplicar)

### D8 — UI vales / liquidación

#### Vales (cajera, turno abierto)

- [x] Barra superior: botón **💵 Vales**
- [x] Modal: lista empleados; al elegir uno se ven vales de la semana y totales (sueldo / vales / neto)
- [x] Modo **Con productos**: agregar ítems (corte, peso/cant, precio) → total acumulado → registrar
- [x] Modo **Adelanto en efectivo**: monto + descripción opcional (sin productos)
- [x] Registrar vale → baja el efectivo en caja
- [x] Descripción / ítems aparecen en la lista de la semana
- [x] Sin turno (si se fuerza) → error claro
- [x] _(Cross-local)_ Mismo carnicero: vale en local A y luego en local B → el resumen semanal suma ambos (perfil único sync)

#### Liquidación semanal (admin hub) — solo consulta

> **Cambio de producto:** el admin **no confirma pago** en la app. Solo ve cuánto correspondería (sueldo − vales). El pago en efectivo lo hace la cajera tras OK verbal; si paga otro monto, se registra como movimiento de caja / gasto según el flujo operativo real (no hay botón “Pagar salario” en el hub).

- [x] Hub: tarjeta **Liquidación semanal**
- [x] Lista empleados con sueldo &gt; 0; muestra bruto / vales / neto de la semana
- [x] Totales de la semana visibles; sin botones de confirmar pago
- [x] Texto aclaratorio: panel informativo (no registra pago)

### E3 — UI conteo stock

> **Nota operativa:** en el local lo harían carniceros (rol aún no existe). Hoy lo puede usar admin/cajera. Frecuencia esperada ≈ 1×/semana (domingo). Historial queda disponible pero no es crítico.

- [x] Cajera: botón **⚖️ Conteo** → modal con productos del local
- [x] **Buscar** por nombre o PLU → filtra la lista (sin scrollear todo el catálogo)
- [x] Completar kg (`DecimalInput`) / unidades (`NumericInput`) → Guardar → confirmación
- [x] Admin hub: **Nuevo conteo** y **Historial de conteos** _(historial: nice-to-have)_
- [x] Historial: filtrar por local/fecha; click → detalle con cantidades
- [x] Admin sin turno puede guardar

### F1 — Sync Firestore (producción) — pendiente de probar en calma

Cómo verificarlo (con `pnpm dev:prod` o build real, **no** `pnpm dev` puro sin Firebase):

1. Login admin/cajera con red.
2. Registrar asistencia y/o un vale.
3. Abrir [Firebase Console](https://console.firebase.google.com) → Firestore → `licenses/{tuTenant}/…`
4. Buscar docs nuevos en `attendance/{id}` y `employeeVales/{id}` (y gastos asociados si aplica).
5. Opcional offline: cortar red, registrar, ver en SQLite `syncedAt` null; al volver online / re-login deberían aparecer en Firestore.

- [ ] En producción: registrar asistencia → documento en `licenses/{tenant}/attendance/{id}`
- [ ] Registrar vale → `employeeVales/{id}` (además del gasto)
- [ ] ~~Pagar salario → `salaryPayments/{id}`~~ _(obsoleto en UI; el IPC puede seguir existiendo pero no es flujo operativo)_
- [ ] Sin red: queda `syncedAt=null`; al volver internet / re-login se drena el outbox

### Smoke final — pendiente (mañana / antes de ir a la carnicería)

- [ ] App arranca OK tras migraciones (ver también D1 smoke arriba)
- [ ] Flujo UI: empleados → asistencia → vale → **consultar** liquidación (sin “confirmar pago”)
- [ ] _(Pendiente producto)_ Admin remoto / PWA **lista** asistencia-vales — hoy hay **push** a Firestore; **no hay UI remota/PWA** que los muestre aún. No es un fallo del sync de maestros (empleados/locales/catálogo/pedidos sí se ven).

---

## Resumen para vos

1. ~~D6 → D7 → D8 → E3 (UI)~~ ✅ revisado
2. **F1** en `dev:prod` / prod real (Firestore Console) — cuando descanses
3. **Smoke** de punta a punta antes de salir
4. Liquidación = solo números; pago efectivo = cajera fuera del botón de salario
