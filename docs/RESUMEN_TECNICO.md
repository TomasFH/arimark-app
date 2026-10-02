# Resumen técnico — App de gestión para carnicerías

Fecha: **2026-09-15**.  
Alcance: estado real del código (desktop Electron + móvil Capacitor), no el diseño original del `PLAN.md` cuando diverge.

---

## 1. Qué es el producto

Sistema **offline-first** para operar una carnicería con uno o varios locales:

- **PC (Windows):** caja del día a día (POS), catálogo/PLUs, turnos, fiados, pedidos, proveedores, personal.
- **Celular (Android APK + PWA):** respaldo de caja, hub admin remoto, y app de carnicero (pedidos + “Mi semana”).

La balanza **no registra ventas**. El carnicero pesa, imprime un ticket con códigos de barras, y la cajera arma la venta **escaneando ese ticket**. La balanza KRETZ se conecta a la PC **solo** para que un admin cargue PLUs y precios.

El código es **agnóstico al cliente**: marca, timezone y tenant salen de `apps/desktop/config/business.json` (no versionado).

---

## 2. Monorepo y stack

Workspace pnpm (`apps/*`, `packages/*`). Gestor exclusivo: **pnpm**.

| Paquete | Path | Rol |
|---|---|---|
| `@carniceria/desktop` | `apps/desktop` | Electron 35 + React 18 + Vite 6 + Tailwind 3 |
| `@carniceria/mobile` | `apps/mobile` | React + Vite + Capacitor 8 (APK Android; iOS como PWA) |
| `@carniceria/shared` | `packages/shared` | TypeScript puro, sin deps de runtime |

**Desktop:** SQLite (`better-sqlite3`) + Drizzle, Zod en IPC, `serialport` (KRETZ R30), Firebase Auth/Firestore **solo en el proceso main**, `electron-updater`, `electron-log`, `electron.safeStorage`.

**Móvil:** Firebase Auth/Firestore **directo desde el WebView** (excepción legítima: no es Electron). Dexie/IndexedDB para ops offline. Cámara `@zxing/browser`. Deploy de prueba: Firebase Hosting (`pnpm mobile:deploy`). El APK **no** se actualiza con ese deploy.

**Shared** (Vite consume source TS; el main Electron requiere CJS via `packages/shared/dist-cjs/`):

- `kretzBarcode.ts` — EAN-13 prefijo `20` (PLU 3 díg + precio 7 díg en centavos)
- `catalogSearch.ts`, `cashDiscount.ts`, `billDenominations.ts`
- `homeRoster.ts`, `orderQty.ts`, `budgetItems.ts`
- `pickupHours.ts`, `storeHours.ts`, `weekRange.ts`, `injectReason.ts`
- `debtCheckpoint.ts` — saldos Spark (checkpoint + cola)

### Entornos (`APP_ENV`)

Solo dos. No hay modo intermedio.

| | `dev` | `production` |
|---|---|---|
| DB | `userData/dev/app.sqlite` | `userData/app.sqlite` |
| Hardware | Mock si no hay `KRETZ_PORT`; real si hay | Real (puerto en `safeStorage`) |
| Firebase | Off | On |
| UI | Banner “MODO PRUEBAS”, “Saltar login” | Sin bypass |
| Updates | Off | `electron-updater` |

Scripts raíz: `pnpm dev` / `dev:hw` / `dev:prod` / `build:prod` / `mobile:dev` / `mobile:deploy` / `test` / `test:coverage`.

---

## 3. Arquitectura desktop

```
Renderer (React)  ── window.hw ──▶  Preload (contextBridge)
                                         │
                                    IPC + Zod
                                         │
                                    Electron Main
                    ┌────────────────────┼────────────────────┐
               SQLite/Drizzle        Firebase              KRETZ serial
```

Reglas:

- Red, Firebase y hardware **solo en main**. El renderer no hace `fetch`, sockets ni Firebase.
- La app **no** controla caja registradora ni terminal de cobro.
- Handlers en `apps/desktop/electron/ipc/*.handler.ts` (~34). Canales en `channels.ts`.
- Cada handler nuevo nace con tests: payload válido, Zod reject, error de negocio.

Arranque (`electron/main.ts`): `bootEnv` → migraciones → seed catálogo/local → `registerAllHandlers` → `HardwareManager` → ventana.

### IPC (grupos)

Auth, turnos (`OPEN_SHIFT` / `CLOSE_SHIFT` / inactivity / sesión offline), POS (`CREATE_SALE`, anulación), catálogo + revisiones + push `CATALOG_SYNC_UPDATED`, gastos/inject/cebo/descuento efectivo, fiados, clientes especiales, proveedores, pedidos, empleados, vales, salarios, stock counts, historial, locales, KRETZ PLU + sync masivo.

### SQLite / Drizzle

- Schema: `apps/desktop/electron/db/schema.ts`
- Migraciones: `apps/desktop/drizzle/` (**0000 → 0043**)
- Tests de DB: instancia `:memory:` (`electron/db/__tests__/helpers/inMemoryDb.ts`)
- Escrituras multi-tabla: transacción atómica `better-sqlite3`
- Fechas: UTC ISO con `Z`; presentación vía `src/lib/datetime.ts` + timezone de `business.json`

---

## 4. Modelo de datos local (tablas clave)

| Tabla | Rol |
|---|---|
| `stores` | Locales, horarios, regla de descuento efectivo |
| `users` | Caché de perfil de cajeras (`id` = Firebase UID). Sin password |
| `products` / `store_products` / `product_prices` | Catálogo, disponibilidad por local, precios |
| `catalog_audit_events` | Auditoría de ficha / visibilidad / retiro |
| `customers` / `debt_events` | Fiados + **ledger** (nunca se sobreescribe un saldo) |
| `special_customers` / `special_customer_prices` | Precios acordados (informativos en POS) |
| `shifts` / `sales` / `sale_items` / `sale_payments` | Turnos y ventas multi-pago |
| `bill_denominations` | Relajo de billetes (apertura / cierre / esperado) |
| `expenses` | Gastos + aportes (`kind: expense \| inject`) |
| `providers` / `provider_debt_events` | Proveedores + ledger de deuda |
| `orders` | Pedidos (presupuesto, seña, estados) |
| `employees` / `attendance` / `employee_vales` / `salary_payments` | Personal |
| `stock_counts` / `stock_count_items` | Conteo semanal |
| `stock_entries` | Esquema preliminar de ingreso; **flujo no implementado** |
| `cebo_entries` | Cebo del turno (no mueve caja) |
| `cash_discount_audits` | Auditoría de regla de descuento |

**Ledger:** cada cambio de deuda es un evento nuevo (`created | partial_payment | paid | cancelled | reopened` en fiados; `debt | payment` en proveedores). El saldo es la suma algebraica.

---

## 5. Autenticación e identidad

Un solo sistema: **Firebase Auth (email + contraseña)** para cajera, admin y carnicero.

- Rol y locales: Firestore `licenses/{tenantId}/users/{uid}` (`role`, `displayName`, `authorizedStores`, `active`).
- SQLite `users`: solo caché para FKs. Admins normalmente no tienen fila local.
- La misma cuenta puede estar en PC y celular a la vez (sin lock de concurrencia).
- Carnicero: **rechazado en desktop**; opera solo en el celular.
- Alta de cajeras: panel admin (móvil y desktop Empleados) + mail de set password. Alta histórica por consola Firebase sigue documentada.

### Login offline en PC (Opción E, 2026-09-15)

`electron/offlineAuth.ts` + `offlineSessionWatch.ts`:

1. Login online exitoso → `safeStorage` guarda hash **scrypt** nativo (+ perfil, locales, `expiresAt` +30 días).
2. Sin red: Firebase falla → compara hash local → sesión con banner *“Sin conexión — sesión guardada localmente”*.
3. Fallo genérico: *“Credenciales incorrectas o sin conexión.”*
4. Al volver internet: revalidación; si la cuenta está deshabilitada → logout (`OFFLINE_SESSION_REVOKED`).
5. Primera vez en una PC nueva **siempre requiere internet**.

Móvil: no hay hash de password. Sesión Firebase persistida (`indexedDBLocalPersistence`). Primer login en ese dispositivo requiere red.

Password: reset por mail + cambio logueado (PC y celu). Plantilla de mail: configurar en Firebase Console (`docs/AUTH_PASSWORD.md`).

---

## 6. Firestore y sincronización

Namespace: `licenses/{tenantId}/...` (`tenant_id` en config; la colección no se renombró).

### Patrón

- **PC:** SQLite es fuente de verdad operativa. Escritura local con `syncedAt = null` → workers `electron/licensing/*Sync.ts` pushean y marcan `syncedAt`.
- **Catálogo:** 1 documento por local (`catalog/{storeId}` con array `products`). Listener en vivo en desktop y POS móvil (`CATALOG_SYNC_UPDATED`).
- **Proveedores / fiados:** Firestore es fuente de verdad **compartida** (visitan ambos locales). La deuda del propio local se calcula en SQLite; la vista combinada admin usa Firestore.
- **Colecciones que crecen diario** (`sales`, ledgers, `expenses`, `shifts`): **prohibido** `getDocs` / `onSnapshot` de la colección entera. Pedir por turno, fecha, estado o página (`docs/FIRESTORE_DT07_DT08.md`).

### Checkpoints de deuda (DT-07)

Saldo vivo = checkpoint (`*DebtCheckpoints/{entityId}__{storeId}`) + eventos con `createdAtServer > checkpointAt`. El job `advanceDebtCheckpoint` corre **solo en PC**. El celu no lo avanza.

### Staging móvil → PC

`sync/{storeId}/shifts/{shiftId}` (+ sales/expenses/cebo/vales/salary). La PC importa a SQLite con `source='mobile'`. Turnos desktop activos filtran `source='desktop'`. Unificar turno vivo PC+celu = **DT-06 pendiente**.

### Relay de escaneo

**Eliminado** (Fase 3b/3c). El celular ya no manda códigos a la PC. `AGENTS.md` aún menciona `RELAY_SCAN` — documentación desactualizada.

### Licencias

Gate de licencia **no-op** (TASKS A1). `tenant_id` = namespace. Activación por código de un solo uso: UI existe, Cloud Function `activateInstallation` **no implementada**; `needsActivation` forzado a `false`.

---

## 7. Hardware y venta

### Balanza KRETZ REPORT NX — protocolo R30

`electron/hardware/kretz/` (`kretzDriver.ts`, `r30Protocol.ts`, `r30Parser.ts`, `portDetect.ts`). Baud 115200.

Comandos: enlace `0002`, leer `5005/5001`, upsert `2005`, borrar `3005`. Sync masivo: `KRETZ_SYNC_CATALOG` + progreso. Puerto en `KRETZ_PORT` o `safeStorage`. Si ese COM no responde, se sondean los demás y se guarda el que contesta. `pnpm dev:hw` usa `KRETZ_AUTOPROBE=1` (no fuerza COM8). `pnpm dev` sin puerto sigue en mock.

Mocks con fallos inyectables (`timeout`, `garbage`, `disconnect`, `malformed_response`); `afterPack` impide que entren al bundle de prod.

### Escaneo de tickets (flujo de venta)

Formato validado: EAN-13 prefijo `20`.

1. **Principal en PC:** lector USB keyboard-wedge → `useBarcodeScanner` en `CashierScreen` (captura global, sin foco).
2. **Manual:** PLU + precio, o búsqueda de producto.
3. **Móvil:** POS propio con cámara. No es companion de la PC.

La caja registradora se opera **a mano**, fuera del sistema.

---

## 8. App móvil

`apps/mobile`. `webDir: 'dist'` → abre offline recién instalada. Android en `apps/mobile/android/`.

Tras login, el rol decide el shell (`App.tsx`, sin router URL):

| Rol | Shell | Offline |
|---|---|---|
| `cashier` | Selector local → abrir turno → POS | Sí (Dexie + sync al reconectar) |
| `admin` | Hub (locales, empleados, fiados, especiales, pedidos, proveedores, historial) + “Operar como cajera” | Hub requiere internet |
| `butcher` | Pedidos (Pendientes / Listos / Entregados 7 días) + “Mi semana” | Ver lista en caché; **Listo exige red** |

POS móvil: cobro, fiado por nombre (sin typeahead remoto), gasto/proveedor, ingreso, cebo, vales, liquidación, anular venta, cierre con billetes. **No** cobra pedidos, **no** edita catálogo, **no** habla con la balanza. UI visual del POS celu **desactualizada vs desktop** (post 1.0; Impeccable cuando se retome).

---

## 9. Superficie UI desktop (rutas cableadas)

Login → StorePicker → OpenShift → Cashier (POS + modales) → CloseShift.  
Admin: Hub, catálogo/PLUs, Staff, locales, Fiados, especiales, Pedidos, Historial, Proveedores, historial de conteos de stock.

Pausado / oculto:

- Asistencia (`SHOW_ATTENDANCE_UI = false`)
- Selector de cliente especial en el POS (`SHOW_SPECIAL_CUSTOMER_POS_SELECTOR = false`)
- Activación por código (UI lista, no se dispara)

---

## 10. Seguridad, updates, calidad

- Secretos en `safeStorage`. `.env*` y `business.json` en `.gitignore`.
- Preload: `contextIsolation: true`, `nodeIntegration: false`.
- `afterPack` bloquea artefactos de dev y tokens de Cloudflare Tunnel.
- Updates: check al start + cada 4 h; download auto; **install al quit**, nunca con turno activo.
- Tests: Vitest (node + jsdom). Cierre de To-Do: suite 100% verde + cobertura ≥ 80% en IPC/DB/negocio.
- UI: `NumericInput` obligatorio (nunca `type="number"`); truncate + `title` en textos variables.

---

## 11. Estado del producto

| Fase | Estado |
|---|---|
| 0 Bootstrap / sesiones | Completa |
| 1 KRETZ real | Completa |
| 2 POS por escaneo | Completa |
| 3 Móvil (monorepo, POS, Capacitor, sesión) | Código completo; tag/push sujetos a testeo |
| 4 Admin PLUs + cajeras | Completa |
| 5 Cierre / gastos | Completa |
| 6 Fiados / especiales | Completa |
| 7 Pedidos / historial / carnicero | Hecho en código; cierre formal de fase incompleto en PLAN |
| 8 Stock “completo” (ingreso de mercadería) | Diseño en `docs/STOCK_DOMINIO_FUNCIONAL.md` — **bloqueado** |
| 9 Empleados / vales | Cubierto; asistencia UI pausada |
| 10 Dashboard web remoto | Pendiente (el admin móvil cubre parte) |

**Pendiente explícito:** DT-01 sub-2 (migrar turno a otro local), DT-05 data tiering, DT-06 turno compartido PC+celu, backfill `createdAtServer` + índices DT-07/08 en prod, FEAT-CAT-03 rollback masivo de precios, FEAT-PAYROLL-02 aguinaldo, pantallas de estadísticas semanales/mensuales (los hechos de ingreso ya se guardan), Cloud Function de activación, plantilla de mail de reset.

**Hecho reciente relevante:** DT-02 login offline PC, DT-03 retomar turno propio, DT-04 último local, catálogo en vivo, password reset/cambio, carrito de pedidos, staff auth móvil, descuento efectivo, cebo, handover de billetes, FEAT-MERCH-INTAKE-01 v2 (libro de ingresos, no Fase 8).

---

## 12. Flujo de una venta (PC)

1. Login (Firebase o hash offline) → local → abrir o retomar turno.
2. Escaneo EAN-13 (USB o manual) → ítems en carrito.
3. Cobro multi-medio (+ descuento efectivo si aplica, o fiado) → `CREATE_SALE` atómico.
4. Outbox → Firestore.
5. Cierre con conteo de billetes → handover al siguiente turno.

Móvil de emergencia: mismo dominio, UUID idempotente, import en PC como origen **Móvil**. No es la caja en vivo de la PC.
