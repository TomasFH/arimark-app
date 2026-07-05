# Plan de desarrollo — App de gestión para carnicerías

## Resumen ejecutivo

Construir una app de gestión integral para carnicerías sobre **Electron + React + TS + Vite + Tailwind + SQLite/Drizzle**, offline-first, con licencias en Firebase, una **app móvil companion** para escanear los códigos de barras de los tickets físicos, integración con balanza **KRETZ exclusivamente para gestión de PLUs/precios** (no para registrar ventas) y dashboard web remoto. El código base es agnóstico al cliente: el primer despliegue es Arimark, pero todos los nombres/colores/logos vienen de configuración, no del código.

Este plan incorpora los **9 ajustes acordados** (críticos + importantes) más la **estrategia de testing automatizado** como pilar innegociable.

---

## Workspace

- Ruta activa del proyecto: `C:\Users\Tomas\Desktop\Proyectos\Arimark\carniceria-app`
- Repo GitHub: `https://github.com/TomasFH/arimark-app`
- Gestor de paquetes: **pnpm exclusivamente**. Ver `AGENTS.md` para reglas completas.

---

## Ajustes acordados sobre el prompt original

Estos cambios se aplican **antes** de implementar nada, porque condicionan arquitectura y esquema.

### Seguridad de licencias (críticos 1–2)

- Vincular cada instalación a un UID anónimo de Firebase persistido localmente. Subcolección `licenses/{license_key}/installations/{anon_uid}` con `{ device_hint, first_seen, last_seen, status }`.
- Reglas de Firestore: la lectura de `licenses/{license_key}` exige que `request.auth.uid` exista en `installations` de esa licencia con `status == "active"`.
- Activación de instalación: la primera vez se exige un **código corto de un solo uso** que el desarrollador entrega junto a la `license_key`. La app llama a una Cloud Function `activateInstallation` que valida el código y crea el documento `installations/{uid}`. Sin esto, copiar la `license_key` no alcanza para acceder.
- Flujo de reinstalación: si el UID cambia (formateo/desinstalación), el cliente pide al desarrollador un código de reactivación. Se invalida el UID anterior.

### Almacenamiento seguro local (crítico 3)

- **Electron `safeStorage`** para tokens y secretos cifrados a nivel de OS user.
- Cero secretos en texto plano. Cero secretos en repo.

### Migraciones de DB

- Carpeta `drizzle/` con migraciones SQL versionadas generadas por **Drizzle Kit**.
- `electron/db/migrate.ts` corre las migraciones **antes** de registrar handlers IPC. Si falla, no arranca y se ofrece restaurar backup.
- `electron/db/backup.ts` hace copia del `.sqlite` antes de migrar. Mantiene los últimos N (default 10).
- Sandbox tiene su propia DB separada.

### Updates de la app

- `electron-updater` con feed (GitHub Releases). Verificación de firma. Auto-check al iniciar y cada N horas. Instalación al cerrar la app, **nunca durante turno activo**.

### Backups locales

- Backup automático **diario** al cierre del último turno: copia el SQLite a `userData/backups/daily-YYYYMMDD.sqlite`, mantiene últimos 30 días, comprime después de 7.
- Botón manual de "Backup ahora" en panel admin.

### Productos por local

- Tabla `store_products(store_id, product_id, available)` con PK compuesta. Resuelve el caso del carbón/leña sin tocar la tabla global `products`.

### Usuarios admin vs cajeras

> **Actualización jul 2026:** reemplaza el diseño original (cajeras con login local bcrypt). Ver "Nota de actualización — autenticación unificada" tras el cierre de Fase 1.

- **Cajeras y admins se autentican por igual con Firebase Auth** (email + contraseña). Necesario para que una cajera pueda operar desde cualquier PC de cualquier local del cliente, y para que la futura app móvil (Fase 3) use el mismo mecanismo de identidad.
- El rol y los locales autorizados de cada cuenta viven en Firestore (`licenses/{key}/users/{uid}`), nunca en SQLite.
- La tabla local `users` es solo un **caché de perfil** (sin contraseñas) para que los FK de `shifts`/`sales`/`product_prices` resuelvan sin depender de internet — se upsertea automáticamente en el primer login de una cajera en cada PC.
- Los datos operativos (turnos, ventas, stock) siguen siendo 100% locales en SQLite; solo el acto de login requiere Firebase.
- Tabla `admin_devices(uid, license_key, ...)` solo para auditoría.

### Timezone

- Toda fecha en SQLite y Firestore en **UTC ISO 8601 con sufijo `Z`**. Conversión a hora local solo en la capa de presentación (`src/lib/datetime.ts`). Timezone configurable en `business.json` (default `America/Argentina/Buenos_Aires`).

---

## Testing automatizado — TDD asistido (pilar innegociable)

El desarrollador actúa como supervisor y QA. Ningún To-Do se cierra sin suite 100% verde.

**Stack**

- **Vitest** con dos configuraciones:
  - `vitest.config.ts` — entorno `node` para main (IPC, DB, licencias, hardware).
  - `vitest.config.renderer.ts` — entorno `jsdom` para componentes React.
- Scripts: `test`, `test:main`, `test:renderer`, `test:watch`, `test:coverage`.
- Cobertura mínima: **80% en líneas** en módulos IPC, DB y reglas de negocio. No negociable.

**TDD por capa**

- Cada handler IPC nace con `electron/ipc/__tests__/<handler>.test.ts`: payload válido, payload malformado (zod rechaza), al menos un error de negocio.
- Cada validador Zod tiene su `.test.ts` con happy path, inválidos y edge cases.
- Cada utilidad de `electron/db/` y `src/lib/` tiene su `.test.ts`.
- Tests de componentes React con Vitest + Testing Library.

**Mocks de hardware con modos de fallo inyectables**

- `electron/hardware/kretz/__mocks__/kretzDriver.ts` — modos via `KRETZ_MOCK_MODE`: `normal`, `timeout`, `garbage`, `disconnect`.
- En dev (sin `KRETZ_PORT`): mocks automáticos. En tests: se importan directamente. En producción: no incluidos en el bundle (`afterPack` lo verifica).

**Testing de DB en memoria**

- `electron/db/__tests__/helpers/inMemoryDb.ts` — instancia `:memory:` con migraciones aplicadas. Usado en todos los tests que tocan DB.
- Tests de transacciones complejas obligatorios antes de cerrar cada fase:
  - Fase 2: venta multi-pago, rollback si la DB falla a mitad de la transacción.
  - Fase 3: cierre de jornada con diferencia de caja, cierre a ciegas.
  - Fase 4: ledger de deudas — saldo algebraico, imposibilidad de sobreescritura, cobro cruzado entre locales.

---

## Diagrama de arquitectura

```
  Lector USB               ┌──────────────────────────────┐
  keyboard-wedge ─teclado─▶│  PC — Electron                │
  (MÉTODO PRINCIPAL)        │  Renderer React               │
                           │    └ window.hw (IPC tipado)   │
  App móvil (PWA)          │         └ Electron Main       │
  escáner cámara ─Firebase▶│             ├ Handlers IPC+zod│
  (emergencia/respaldo)     │             ├ SQLite + Drizzle│
                           │             ├ Firebase        │
  Balanza KRETZ            │             └ KRETZ serial    │
  (USB, SOLO PLUs, ───────▶│                               │
   solo admins)            └──────────────────────────────┘
```

- **Lector USB → PC (principal)**: keyboard-wedge que envía los dígitos como teclado. La app captura la secuencia globalmente sin necesidad de enfocar ningún campo.
- **App móvil → PC (emergencia/respaldo)**: relay vía Firebase cuando no hay lector USB, o POS completo en el celular si la PC no está disponible.
- **Balanza KRETZ ↔ PC**: conexión física USB usada **solo** por administradores para crear/modificar/eliminar PLUs y precios. Nunca registra ventas ni envía pedidos.

---

## Modelo de flujo de datos (corrección arquitectónica — jun 2026)

> Esta sección reemplaza el supuesto original de que la balanza enviaba pedidos completos a la PC en tiempo real. **Ese modelo queda descartado**: por la infraestructura de los locales no es viable mantener la balanza conectada físicamente a la PC durante la operación.

**La balanza NO se comunica con la PC durante las ventas.** La única comunicación balanza↔PC ocurre por conexión física USB y se usa **exclusivamente** para que un administrador gestione PLUs/precios (crear, modificar, eliminar, cambiar número).

**Las ventas se arman en la PC escaneando los códigos de barras del ticket físico.** El carnicero pesa los productos y entrega al cliente un ticket físico que lista uno o varios productos. Cada código de barras del ticket = un producto, y codifica el **PLU (3 dígitos) + precio total (7 dígitos en centavos)** (formato EAN-13 prefijo `20`, ya validado).

**Fuentes de escaneo (mismo path de venta en la PC):**
1. **Lector USB keyboard-wedge** (método principal — confirmado jul 2026). Envía los dígitos del código + Enter como teclado. La app los captura globalmente mediante `useBarcodeScanner`: no hace falta que la cajera enfoque ningún campo. El indicador "Lector listo" en el header confirma que el hook está activo; al escanear muestra el nombre del producto por ~2 segundos.
2. **App móvil companion** (emergencia/respaldo): relay vía Firebase cuando no hay lector USB conectado. También funciona como POS completo si la PC no está disponible (Fase 3).
3. **Entrada manual de código** (13 dígitos en un campo de texto) y **PLU + precio** como fallbacks de última instancia.

**Flujo de la cajera (semi-automático):**
recibe ticket físico → escanea cada código (los datos del producto se cargan solos) → repite hasta terminar el pedido → pregunta el/los medio(s) de pago → confirma la venta → vuelve a empezar.

**Modos de emergencia de la app móvil (requisito confirmado jun 2026):**
- **PC no disponible (ej. corte de luz):** la app móvil debe poder **cerrar ventas por sí sola** (POS completo en el celular), no solo relayar códigos. Ideal: operar desde la PC; el celular es el respaldo.
- **Sin internet/datos:** la app móvil **persiste las ventas localmente** (en el celular) y las **sincroniza a Firebase** cuando recupera conexión, actualizando la lista de ventas.
- **Reconciliación:** cada venta lleva un UUID generado en el dispositivo; la sincronización es **idempotente** para que las ventas creadas en el celular se incorporen a Firebase y a la DB de la PC **sin duplicados**.

**Implicancias para el código actual (a corregir en Fase 2):**
- El canal `SCALE_ORDER`, el `setOrderHook` de `main.ts` y la cola FIFO por canales A/B/C/D asumían el push de la balanza → **se eliminan/recontextualizan**.
- `CashierScreen` debe reorganizarse alrededor de "venta en curso que se va armando al escanear", no de una cola de pedidos entrantes.
- Las tablas `scale_orders` / `scale_order_items` quedan en revisión (posible deprecación: la venta ya se modela con `sales` + `sale_items`).
- El componente `EmergencyBarcodeInput` se renombra/recontextualiza: **escanear = flujo normal**, manual PLU+precio = emergencia.

---

## Roadmap por fases

### ✅ Fase 0 — Bootstrap, licencias y sesiones (COMPLETA)
Tag: `fase0-complete` | Commit: `935959f` | Tests: 90 en verde

Entregado:
- Stack completo: Electron + React + TS + Vite + Tailwind + Drizzle + Vitest + pnpm
- DB: schema 22 tablas, migración `0000`, runner con backup previo y rollback
- Seguridad: `safeStorage`, entornos dev/producción separados, `afterPack`
- Config por cliente: `business.json` con loader Zod tipado
- Licencias: `signInAnonymously`, activación con código único, ventana 48h offline, sesiones por rol
- Login UI: pantallas de activación, licencia inválida, cajera y admin; botón bypass en modo dev
- Datetime: capa UTC con helpers de presentación por timezone
- Hardware: interfaz KRETZ + mock con modos de fallo inyectables
- `electron-updater`: auto-check periódico, instalación solo fuera de turno activo
- Firestore rules: `installations/{uid}`, sesiones y activity_log con permisos estrictos

---

### ✅ Fase 1 — Hardware real: KRETZ (COMPLETA — modo emergencia aplazado)
Tag: `fase1-complete` | Tests: 216 en verde | Cobertura IPC/DB/hardware ≥ 80%

La mayoría de los entregables de esta fase están implementados y testeados en producción real:

Entregado:
- `electron/hardware/kretz/kretzDriver.ts` — driver real via `serialport`, protocolo R30, baud 115200
- PLU management completo: probar enlace (cmd 0002), leer (cmd 5005/5001), crear/actualizar (cmd 2005), borrar (cmd 3005). Validado en carnicería con balanza KRETZ REPORT NX (sesión 15/06/2026).
- Hardware manager: dev sin `KRETZ_PORT` usa mock; dev con `KRETZ_PORT` o producción usa driver real; gestiona conexión, reconexión con backoff exponencial, `setHardwareStatus()`.
- IPC tipado con zod para todos los comandos de PLU y configuración de puerto.
- Panel DevTools integrado en la app (solo modo dev) para diagnóstico, log de eventos y gestión de PLUs.
- Tests de modos de fallo del mock (`timeout`, `garbage`, `disconnect`, `malformed_response`): implementados y testeados.
- Tests para parser R30, protocolo R30, driver real (unit), PLU handler, hardware manager, client DB, migrate.
- Build de producción verificado: `afterPack` sin artefactos prohibidos.

**Rol de la balanza (aclaración):** en producción la balanza KRETZ se usa **únicamente** para gestión de PLUs/precios por parte de administradores, vía conexión física USB. No envía pedidos ni ventas a la PC (ver "Modelo de flujo de datos").

**Resuelto luego del cierre:** el patrón del código de barras del ticket (EAN-13 prefijo `20`, PLU 3 díg + precio 7 díg en centavos) fue identificado con datos reales. El escaneo dejó de ser "modo emergencia" y pasó a ser el flujo principal de ventas (Fase 2).

**Cierre formal:**
- [x] `pnpm run test` — 216 tests en verde
- [x] Cobertura ≥ 80% en IPC, DB y hardware
- [x] `pnpm build:prod` — `afterPack` ✅
- [x] Tag: `fase1-complete`
- [ ] Push a GitHub (pendiente testeo manual del desarrollador)

---

> **Nota de actualización (jul 2026) — autenticación unificada:** antes de arrancar la Fase 3, se migró el login de cajeras de SQLite+bcrypt a **Firebase Auth** (mismo mecanismo que admin). Motivo: el cliente opera varios locales y una cajera puede necesitar loguearse desde la PC de cualquiera de ellos — con credenciales locales por PC esto era imposible sin duplicar cuentas a mano. Además, la app móvil companion de Fase 3 iba a usar Firebase Auth de todas formas; mantener dos sistemas de autenticación en paralelo agregaba complejidad, no la evitaba.
>
> Cambios concretos: la tabla `users` dejó de guardar `username`/`password` y pasó a ser un caché local de perfil (`firebase_uid`, sin credenciales); el rol (`cashier`/`admin`) y los locales autorizados de cada cuenta se resuelven en Firestore (`licenses/{key}/users/{uid}`); se eliminó el lock de "una cajera por local" en `sessions/{storeId}` (necesario para que la misma cajera pueda estar logueada en la PC y en su celular a la vez, caso de uso central de Fase 3); el perfil local se upsertea automáticamente en el primer login de una cajera en cada PC. La creación de cuentas nuevas es manual (consola de Firebase) hasta que exista un panel de administración (Fase 4) — deuda técnica señalada, no silenciada. Los datos operativos (turnos, ventas, stock) siguen siendo 100% locales en SQLite; solo el login requiere Firebase. Detalle completo en la sección "Usuarios admin vs cajeras" más arriba.

> **Nota de reordenamiento (jun 2026):** tras la corrección del modelo de flujo de datos, las fases 2 en adelante se reordenaron. La app móvil (antes "emergencia móvil" en la última fase) pasó a ser un componente central y temprano, y se agregó una fase dedicada a la sección de administración de PLUs. Las fases 0 y 1 (con tags creados) no cambian.

### ✅ Fase 2 — POS de ventas por escaneo (COMPLETA)

Objetivo: que la cajera arme una venta en la PC **escaneando los códigos de barras** del ticket físico (cada código = un producto con PLU + precio total), elija el/los medios de pago y confirme, guardando todo de forma atómica. El origen del escaneo (app móvil, lector USB o entrada manual) es intercambiable.

Infraestructura ya implementada (remanente de fases previas):
- `sale.handler.ts`: creación de ventas con ítems + pagos multi-medio, transacción atómica con rollback.
- `PaymentModal`: cobros combinados (efectivo + débito + billetera + crédito).
- `OpenShiftScreen`: apertura de turno con cambio inicial.
- Schema de DB: tablas `sales`, `sale_items`, `sale_payments`, `shifts`.

Completado en esta iteración (29/06/2026):
- [x] **Migración 0003**: columna `plu_number integer unique` en `products`.
- [x] **Rangos de PLU acordados**: 1–99 vacunos, 100–149 pollo, 150–199 cerdo, 200–249 embutidos, 250–299 especiales, 300+ reservado.
- [x] **Seed actualizado** con catálogo realista (~34 productos) + precios de referencia en `product_prices`.
- [x] **PLU → producto**: resolución por `plu_number`; el código de barras del ticket se parsea a PLU + precio.
- [x] **Entrada por código de barras** (`EmergencyBarcodeInput`): auto-submit al detectar 13 dígitos → **compatible con lector USB keyboard-wedge sin cambios**.
- [x] **Entrada manual PLU + precio** con autocompletado del catálogo y decimales con coma (es-AR).
- [x] **IPC `GET_PRODUCTS`** + modal de catálogo (PLU, nombre, precio, categoría) ordenable/filtrable.
- [x] **Test de integración** (venta multi-pago con rollback completo).

Rework por el nuevo modelo de datos (30/06/2026):
- [x] **Eliminado el modelo de push de la balanza**: se quitaron `SCALE_ORDER`, `INJECT_MOCK_ORDER`, `setOrderHook` en `main.ts`, el `_broadcastOrder`/`injectMockOrder` del `HardwareManager`, el handler `mockOrder.handler.ts` y el panel "Simulador" (`DevScaleTicketPanel`).
- [x] **`CashierScreen` reorganizado** alrededor de "venta en curso que se arma escaneando" (agrega ítem por cada código, quitar ítem, total en vivo, vaciar).
- [x] **`EmergencyBarcodeInput` → `ScanInput`**: escaneo = pestaña principal; manual PLU+precio = emergencia.
- [x] **Tablas `scale_orders` / `scale_order_items`**: marcadas DEPRECADAS en el schema (la venta se modela con `sales`+`sale_items`); baja con migración dedicada pendiente.
- [x] **Ventas manuales** marcadas con `manualEntry` (aprobación de admin en producción queda para la fase de panel admin).
- [x] **Notas de venta**: campo opcional en el modal de cobro, persistido en `sales.notes` vía IPC existente.
- [x] Suite 100% verde (242 tests) tras el rework.

Completado al cerrar Fase 2 (01/07/2026):
- [x] **Lector USB keyboard-wedge**: hook `useBarcodeScanner` captura globalmente sin enfocar ningún campo; indicador visual en header; módulo `barcodeItem.ts` compartido.
- [x] **Tests RTL**: flujo "escanear → carrito → confirmar" cubierto (sesión anterior).
- [x] **Mock KRETZ limpiado**: eliminado `emitMockOrder` y la generación de pedidos sintéticos. Modos de fallo (`timeout`, `garbage`, `disconnect`, `malformed_response`) conservados y testeados.
- [x] **`pnpm run typecheck` arreglado**: eliminada la `references` innecesaria de `tsconfig.json`; añadido `types: ["vite/client"]` para `import.meta.env`.
- [x] **Migración 0004**: eliminadas tablas `scale_orders` / `scale_order_items` y columna `sales.scale_order_id`; schema Drizzle y `sale.handler.ts` actualizados.

**Cierre formal:**
- [x] `pnpm run test` — 255 tests en verde
- [x] `pnpm run typecheck` — sin errores
- [x] Cobertura ≥ 80% en IPC, DB y hardware
- [x] Tag: `fase2-completa`
- [ ] Push a GitHub (pendiente testeo manual del desarrollador)

> **Nota de actualización (jul 2026) — setup de entorno de producción y deudas técnicas identificadas:**
>
> Se realizó el primer test de login real en producción (`pnpm dev:prod`). Lo que se hizo y lo que quedó pendiente:
>
> **Hecho:**
> - `config/business.json` creado con `license_key`, `default_store_id`, `business_name` reales (no versionado).
> - `.env.production` creado en la raíz con las claves Firebase (no versionado).
> - `dotenv` agregado como dependencia directa. `electron/main.ts` carga `.env.production` al arrancar en modo producción, antes de cualquier llamada a Firebase (el proceso main no recibe las vars de Vite en runtime).
> - Orden de `computeInitStatus` corregido: `signInAnon()` debe llamarse antes que `verifyLicense()` para que Firestore tenga un token de autenticación al leer el documento de licencia.
> - Regla de Firestore para `licenses/{licenseKey}` cambiada de `isActiveInstallation` a `request.auth != null` (cualquier usuario autenticado puede leer el documento de licencia, que no contiene datos sensibles). Motivo: con la regla anterior era imposible verificar la licencia antes de tener una instalación activa, generando un problema de huevo-gallina.
> - `getIdToken(true)` agregado en `signInWithRole` después del login con email/password, para forzar que el cliente Firestore use el token del usuario email y no el token anónimo cacheado del `signInAnon()` previo.
> - `ensureDefaultStore()` en `main.ts`: crea el local por defecto (de `business.json`) en SQLite al arrancar si no existe, resolviendo el FK constraint al crear el perfil local de una cajera nueva.
> - Login de producción verificado de punta a punta: Firebase Auth → perfil Firestore → caché SQLite → sesión activa.
>
> **Deuda técnica — bypasseado temporalmente:**
> - **Activación por código de un solo uso:** la pantalla de activación aparece porque `checkInstallationStatus` devuelve `activated: false` (no existe el documento `installations/{uid}`). La Cloud Function `activateInstallation` no está implementada. Por ahora `computeInitStatus` no llama a `checkInstallationStatus` y siempre retorna `needsActivation: false`. Cuando se implemente la Cloud Function, se restaura esta lógica.
>
> **Deuda técnica — pendiente de implementar:**
> - Alta de locales: hoy `ensureDefaultStore` crea el local con el `default_store_id` de `business.json`. El panel de administración (Fase 4) permitirá crear y gestionar locales correctamente.
> - Alta de cuentas de cajeras/admins: manual desde consola de Firebase hasta Fase 4.



> **Actualización jul 2026:** el cliente adquirió un lector USB keyboard-wedge, que pasa a ser el método principal de escaneo en la PC. La app móvil queda como respaldo operativo (cuando la PC no está disponible) y como alternativa cuando no hay lector. El scope de esta fase se reduce: ya no es el camino crítico del día a día. Requiere primero la migración de autenticación a Firebase Auth (ver nota tras Fase 1) y la reestructuración del repo a monorepo pnpm.

Objetivo: tener un respaldo operativo para cuando la PC no está disponible, y una alternativa de escaneo por cámara para locales sin lector USB.

**Etapa 0 — Reestructuración a monorepo pnpm** ✅ IMPLEMENTADO (jul 2026):
- `apps/desktop` (proyecto actual, movido con `git mv`, historia preservada), `apps/mobile` (PWA nueva), `packages/shared` (código puro reutilizable: `kretzBarcode.ts`, contratos de relay).
- `firebase/firestore.rules` se mantiene en la raíz (infra compartida entre ambas apps).
- Scripts raíz (`pnpm dev`, `pnpm test`, etc.) delegan a `apps/desktop` vía `pnpm --filter` para no romper el flujo de trabajo existente.
- `pnpm -r test`: 278 tests verdes (18 shared + 202 main + 53 renderer + 5 mobile).

**Sub-etapa 3a — Escáner + relay (alternativa sin lector USB):** ✅ IMPLEMENTADO (jul 2026)
- App móvil como **PWA** (React + Vite + Tailwind) con escaneo de código de barras por cámara (`@zxing/browser`). Hosted en Firebase Hosting (HTTPS, necesario para cámara).
- Login con Firebase Auth (mismo mecanismo unificado que la PC — ver "Autenticación"). Si la cuenta está autorizada en más de un local, selector de local antes de escanear.
- Relay vía Firestore: `licenses/{key}/relay/{storeId}/events/{eventId}` (ID generado en el celular = escritura idempotente). La PC escucha con `onSnapshot`, valida el código y lo agrega a la venta en curso — **mismo path que usa el lector USB**, sin lógica de venta nueva. La PC escribe `accepted`/`rejected` en el mismo evento; el celular lo lee y muestra feedback.
- Diseñado para que el lector USB (ya implementado) reemplace al móvil sin tocar la lógica de venta.
- Para deploy: `pnpm --filter @carniceria/mobile build` y luego `npx firebase-tools deploy --only hosting,firestore:rules` desde la raíz del repo. El `.env` de la PWA (`apps/mobile/.env`) se crea copiando `apps/mobile/.env.example` con los valores reales.

**Sub-etapa 3b/3c — POS de respaldo offline + sincronización** ✅ IMPLEMENTADO (jul 2026):

Flujo implementado:

- **Login offline por PIN**: tras el primer login exitoso, la app pide configurar un PIN (4-6 dígitos, hash PBKDF2-SHA256 en IndexedDB). Si `signInWithEmailAndPassword` falla por error de red, se ofrece ingresar con PIN reconstruyendo la sesión desde el perfil cacheado localmente. El PIN es específico del dispositivo.
- **POS completo en el celular**: flujo completo: login → selector de local (si hay más de uno) → abrir turno → POS (escanear por cámara, entrada manual, cobro multi-medio) → cerrar turno. Ventas guardadas en IndexedDB con UUIDs generados en el dispositivo.
- **Catálogo publicado por la PC**: al loguear una cajera, la PC publica el catálogo vigente del local a `licenses/{key}/catalog/{storeId}` en Firestore. El celular lo descarga y cachea en IndexedDB. El POS resuelve nombre y precio por PLU desde ese cache (funciona sin internet).
- **Motor de sync idempotente**: cuando hay red + sesión Firebase válida, el celular sube turnos/ventas pendientes a `licenses/{key}/sync/{storeId}/shifts/{shiftId}` + subcolección `sales/{saleId}`. IDs UUID = reintentos seguros. Disparo automático: recuperar conexión, confirmar venta, reabrir app.
- **Importación en la PC**: `mobileSync.ts` escucha con `onSnapshot` la colección de staging; por cada turno nuevo importa atómicamente a SQLite (turno + ventas + ítems + pagos) con `source='mobile'`. Idempotente: shiftId/saleId ya importado se omite. Marca el doc como `importedAt`.
- **Migración 0006**: columna `source text default 'desktop'` en `shifts`. Los handlers `GET_ACTIVE_SHIFT` / `OPEN_SHIFT` filtran `source='desktop'` para no chocar con turnos móviles.
- **Relay retirado**: `relay.ts` (desktop y mobile), `ScannerScreen.tsx` (relay), canal `RELAY_SCAN`, `onRelayScan` en preload/hw-api eliminados. La PWA ya no es un "relay de barcodes" sino un POS completo.
- **Reglas Firestore actualizadas**: regla `relay/{storeId}` eliminada; agregadas reglas para `catalog/{storeId}` (read autenticado) y `sync/{storeId}/shifts/{shiftId}` + `sales/{saleId}` (read/create/update autenticado).

Componentes mobile nuevos: `OpenShiftScreen`, `PosScreen`, `ManualEntry`, `PaymentModal`.
Libs mobile nuevas: `db.ts` (Dexie), `catalog.ts`, `sync.ts`, `connectivity.ts`.
Desktop nuevos: `catalogPublish.ts`, `mobileSync.ts`, migración `0006_shifts_mobile_source.sql`.

Cierre:
- [x] `pnpm -r test` — suite en verde
- [x] `pnpm -r typecheck` — sin errores
- [x] Migración 0006 en `drizzle/` registrada en journal
- [ ] Tag: `fase3-completa` (pendiente testeo manual)
- [ ] Push a GitHub (pendiente testeo manual del desarrollador)

**Sub-etapa 3d — App nativa instalable (Capacitor) + sesión persistente** ✅ IMPLEMENTADO (jul 2026):

Motivo del cambio (feedback del desarrollador): la PWA en navegador solo abre offline si fue cargada antes de perder internet, y el caso de uso del celular es **justamente la emergencia** (corte de luz/internet). Además el PIN offline era una fricción que las cajeras probablemente no recordarían. Se decidió empaquetar la app como **instalable nativa** y reemplazar el PIN por **sesión persistente**.

- **Empaquetado con Capacitor** (`@capacitor/core`, `@capacitor/android`, `@capacitor/network`, `@capacitor/cli`). `capacitor.config.ts` con `webDir: 'dist'`: los assets web construidos por Vite se copian **dentro** del instalador → la app **siempre abre offline**, incluso recién instalada y sin haber tenido internet nunca. No se define `server.url` (carga siempre desde archivos locales).
- **Distribución sin app store**: `.apk` compilable con Android Studio y compartible por link/WhatsApp. El proyecto Android vive en `apps/mobile/android/`.
- **Estrategia híbrida por plataforma (decisión jul 2026)**: Android usa la app nativa (`.apk`, garantía dura de apertura offline). **iOS se sirve como PWA** (misma base de código; "Agregar a pantalla de inicio" desde Safari), evitando el costo/fricción de Xcode + cuenta Apple + distribución fuera de la App Store (el desarrollador no tiene Mac). Riesgo asumido de iOS: WebKit puede desalojar el almacenamiento local tras semanas de inactividad → se mitiga con la **disciplina de abrir la app rutinariamente** (documentado en `apps/mobile/GUIA-INSTALACION.md`). El trabajo nativo no se descarta: `cap add ios` sigue disponible si en el futuro se justifica.
- **Íconos y branding**: íconos PWA (`public/icon-192.png`, `icon-512.png`, `apple-touch-icon.png`) generados como placeholder neutro (barra de código + etiqueta, sin marca de cliente, coherente con la regla de agnosticismo). Nombre de la app unificado a "POS Móvil" (manifest + `index.html`). Guía de instalación/uso para cajeras en `apps/mobile/GUIA-INSTALACION.md`.
- **Sesión persistente (sin PIN)**: `firebase.ts` usa `initializeAuth` con `indexedDBLocalPersistence` + `browserLocalPersistence`. Tras iniciar sesión **una vez con internet**, el refresh token queda en el dispositivo; `restoreSession()` (en `auth.ts`) rehidrata al usuario al abrir la app **con o sin conexión** y usa el perfil cacheado en IndexedDB. Eliminados `pin.ts`, `SetupPinScreen`, `signInWithPin` y el store `pin` de Dexie (schema v2).
- **Conectividad y resync**: `connectivity.ts` (plugin `@capacitor/network` con fallback a `navigator.onLine`) expone `isOnline`, `onConnectivityChange` y el hook `useOnlineStatus`. La UI muestra un banner "Sin conexión" y, al reconectar, resincroniza el catálogo y sube turnos/ventas pendientes automáticamente.
- **Permisos Android**: `CAMERA` (escáner), `ACCESS_NETWORK_STATE` e `INTERNET` declarados en `AndroidManifest.xml`.

Requisito operativo documentado: para poder usar la app offline, la cajera debe haber iniciado sesión **al menos una vez con internet** en ese celular (configuración inicial). No hay login offline de una cuenta nueva sin conexión (riesgo aceptado, coherente con "instalar y configurar antes de la emergencia").

Cómo compilar el `.apk` (requiere Android Studio + JDK instalados en la máquina de build):
1. `pnpm --filter @carniceria/mobile build` (genera `dist/` con las envs de Firebase).
2. `pnpm --filter @carniceria/mobile cap:sync` (copia assets al proyecto nativo).
3. `pnpm --filter @carniceria/mobile cap:open:android` (abre Android Studio) → Build > Build APK(s); o `./gradlew assembleDebug` dentro de `apps/mobile/android/`.

Componentes/libs mobile de esta sub-etapa: `connectivity.ts` (nuevo), `firebase.ts` (auth persistente), `auth.ts` (restauración de sesión), `App.tsx` (arranque por sesión + banner offline). Eliminados: `pin.ts`, `SetupPinScreen.tsx`, `LoginScreen.tsx` (código muerto).

### 🔜 Fase 4 — Sección de administración de PLUs (solo admins)

Objetivo: que los administradores gestionen precios/PLUs y los carguen en la balanza, aprovechando los comandos KRETZ ya validados en Fase 1.

- Vista **exclusiva para admins** (rol verificado), no visible para cajeras.
- CRUD de PLUs: crear, modificar (nombre/precio), **cambiar número**, eliminar.
- **Edición masiva**: preparar varios cambios como borrador y aplicarlos como lote.
- Botón **"Cargar en balanza"** habilitado **si y solo si la balanza está físicamente conectada a esa PC** (nunca desde el móvil). Usa los comandos KRETZ de Fase 1.
- **Listas de precios por local**: al editar precios/PLUs, el admin elige el local primero. Cada local puede tener precios distintos para el mismo producto. El catálogo publicado a Firestore (`licenses/{key}/catalog/{storeId}`) refleja los precios de ese local específico. La PWA móvil descarga el catálogo del local en el que la cajera está trabajando. (Nota: la infraestructura de Firestore para esto ya existe desde Fase 3; lo que falta es la UI de administración.)
- Sincronización catálogo local ↔ PLUs de la balanza; auditoría de cambios.
- Tests: gating por conexión física, lote aplicado correctamente, rollback si un comando falla.

### Fase 5 — Cierre de jornada y gastos

- Apertura de turno con cambio inicial.
- Registro de gastos durante la jornada.
- Cierre con conteo de billetes, cierre a ciegas opcional.
- Diferencia de caja automática.
- Test obligatorio: cierre con diferencia de caja, cierre a ciegas.

### Fase 6 — Clientes especiales y deudas

- ABM de clientes (restaurant, mayorista, otros).
- Precios especiales por cliente.
- Modelo de ledger en `debt_events` — nunca sobreescritura, saldo algebraico.
- Cobro cruzado entre locales sin duplicados.
- Test obligatorio: ledger completo con pagos parciales y cobros cruzados.

### Fase 7 — Pedidos, historial y reportes admin

- ABM de pedidos con estado (pendiente / listo / entregado / cancelado).
- Panel admin: historial de ventas, reportes por turno/período. (El catálogo/precios se gestionan en Fase 4.)
- Registro local de medios de pago. La app no interactúa con caja registradora ni terminal de pago.

### Fase 8 — Stock ⚠️ BLOQUEADA

**No codificar hasta que el desarrollador confirme haber tenido la charla con el carnicero titular sobre el manejo de ingreso de mercadería.** La estructura de `stock_entries` existe en el schema pero el flujo operativo está pendiente de definición.

**Idea registrada — descarte de mercadería (solo admins, pendiente de profundizar):**

Sección o panel **exclusivo para administradores** donde puedan registrar el **descarte de mercadería** (productos que se pierden y no se venden).

- **Motivación principal:** contingencias como un **corte de luz prolongado** que obligue a desechar productos refrigerados o congelados.
- **Alcance inicial (solo anotado):** registrar qué se descartó, cuánto y por qué; reflejar el impacto en stock; dejar trazabilidad para auditoría.
- **Pendiente de definir** en la charla con el titular: flujo exacto, campos obligatorios (motivo, producto, peso/cantidad), si requiere confirmación doble, reportes, etc.
- **No implementar** antes de cerrar el modelo general de stock (ingreso + movimientos).

### Fase 9 — Empleados, vales y asistencia

- ABM de empleados con rol (`butcher`, `cashier`, `other`).
- Registro de vales/adelantos contra salario semanal.
- Registro de asistencia con estados y justificaciones.

### Fase 10 — Dashboard remoto

- Dashboard web en Firebase (React, misma base de código o mini-app separada).
- Vista de ventas del día, turno activo y totales por medio de pago.
- (El escaneo móvil dejó de ser "emergencia" y se trata como componente central en Fase 3.)

---

## Checklist de cierre de cada fase

Antes de crear el tag de git, verificar:

- [ ] `pnpm run test` reporta suite 100% verde.
- [ ] Cobertura ≥ 80% en módulos IPC, DB y reglas de negocio.
- [ ] Todas las migraciones de la fase están en `drizzle/` y probadas con `migrations.test.ts`.
- [ ] No hay `any` introducido sin justificación documentada.
- [ ] No hay secrets en el código ni en archivos trackeados por git.
- [ ] Build de producción compilado; `afterPack` no reportó errores.
- [ ] Commit de cierre con formato acordado.
- [ ] Tag de fase creado: `git tag -a faseN-complete -m "..."`.
- [ ] Desarrollador realizó testeo manual y dio permiso de push.
- [ ] `git push origin main && git push origin --tags`.

---

## Checklist de primer deploy (onboarding al local real)

Protocolo operativo para la primera instalación en la PC del cliente. No improvisar delante del cliente.

### 1. Prerequisitos — verificar ANTES de ir al local

- **Firebase**: Firestore y Authentication activos. Reglas de Firestore deployadas (versión actual del repo). Proyecto real de producción, no el emulador.
- **Licencia generada**: documento `licenses/{license_key}` en Firestore con `activo: true`. `license_key` anotado.
- **Usuarios creados**: cuentas en Firebase Auth (email + contraseña) con perfil en `licenses/{key}/users/{uid}` (campos: `role`, `displayName`, `authorizedStores`, `active: true`). Alta manual desde consola de Firebase hasta que exista el panel de administración (Fase 4).
- **`config/business.json` preparado** con: `business_name`, `license_key`, `default_store_id`, `timezone`, `logo_path`, `theme`. No se versiona. Copiar del template `config/business.example.json`.
- **`.env.production` preparado** en la raíz del proyecto con las claves `VITE_FIREBASE_*` del proyecto Firebase. No se versiona.
- **Instalador `.exe` compilado** con `APP_ENV=production`. Probado en una PC limpia (sin Node, sin el proyecto en disco). Verificado que el banner de pruebas **no** aparece y que el botón de bypass de login no existe.
- **Build de producción verificado**: `afterPack` no encontró artefactos de dev.
- **Driver JDATAGATE** de KRETZ descargado (compatible con REPORT NX). En USB o carpeta accesible.
- **Suite de tests en verde al 100%** antes de compilar el instalador final.

### 2. Pasos de instalación en la PC del local

Ejecutar en este orden. No saltear pasos.

1. Instalar driver JDATAGATE de KRETZ. Reiniciar si lo pide. Verificar en Administrador de dispositivos que el puerto aparece.
2. Copiar `config/business.json` y `.env.production` a las rutas correctas del proyecto antes de compilar el instalador.
3. Ejecutar el instalador `.exe`. Aceptar UAC si aparece.
4. Primera apertura: el local por defecto se crea automáticamente en SQLite. Verificar que aparece la pantalla de login (sin banner amarillo ni botón bypass).
5. Iniciar sesión con las credenciales de Firebase Auth. Verificar que la sesión queda activa.
6. Conectar la balanza por USB-B **solo si se va a gestionar PLUs** (es el único uso de la balanza desde la app).

### 3. Verificación antes de dejar al cliente solo

No retirarse sin completar este circuito:

- **Venta de punta a punta**: carnicero pesa e imprime el ticket físico → cajera escanea cada código del ticket (app móvil o lector USB) → los productos se cargan solos → elige medio(s) de pago → confirma → venta en historial.
- **Medios de pago digitales**: registrar débito/billetera/crédito como medio de pago local (la app no opera ninguna caja registradora ni terminal de pago).
- **Gasto**: registrar uno, verificar que aparece en el resumen del turno.
- **Cierre de jornada**: cambio inicial → ventas → gastos → cierre → totales correctos → diferencia de caja `$0`.
- **Dashboard web desde celular**: ventas del día y turno activo visibles.
- **Borrar datos de prueba**: dejar la base limpia para el primer turno real.

### 4. Si algo falla durante la instalación

**Principio innegociable: el cliente nunca queda sin sistema para trabajar.**

1. Parar. No improvisar correcciones en vivo.
2. Informar al cliente que continúa en papel por hoy.
3. Documentar el error exacto (captura + log de `userData/logs/`).
4. Si no funciona, desinstalar limpiamente antes de irse.
5. Resolver en desarrollo, compilar nueva versión si hace falta, coordinar nueva visita.

### 5. Post-instalación

- Confirmar que `userData/backups/` tiene al menos un archivo de backup.
- Confirmar en los logs que `electron-updater` consultó el feed correctamente.
- Entregar `license_key` por escrito al cliente.
- Agendar seguimiento a los 7 días: revisar logs, verificar backups diarios, revisar que el ciclo semanal completo funcionó.
