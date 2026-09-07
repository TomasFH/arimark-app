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
- **Detección automática de puerto (jul 2026):** `portDetect.ts` sondea todos los puertos COM con el protocolo R30 (`0002`) y conecta en caliente al que responde. Validado en campo con dos balanzas REPORT NX idénticas en COM8 y COM11. UI en DevTools → Hardware → "Detectar balanza automáticamente"; el puerto se persiste en `safeStorage`.
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
- **Catálogo publicado por la PC**: al guardar / merge, la PC publica el catálogo del local a `licenses/{key}/catalog/{storeId}`. El celular lo descarga y cachea en IndexedDB. **En vivo (BLOQUE I-A, 2026-08-30):** `onSnapshot` de ese doc (1 por local); sin depender del ↺. El ↺ queda de respaldo. Plan Firebase: **Spark ($0)**; medir lecturas en jornada real (ver TASKS_V1 BLOQUE I).
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

Cierre de sub-etapa 3d:
- [x] `pnpm -r test` — 285 tests en verde (18 shared + 11 mobile + 203 main + 53 renderer)
- [x] `pnpm -r typecheck` — sin errores
- [x] Commit: `feat(fase3): empaquetar app móvil como nativa (Capacitor) + sesión persistente sin PIN`
- [ ] Testeo manual (ver `apps/mobile/GUIA-INSTALACION.md` y checklist en repo) — pendiente
- [ ] Tag: `fase3-completa` (pendiente testeo manual + aprobación del desarrollador)
- [ ] Push a GitHub (pendiente aprobación del desarrollador)

### ✅ Fase 4 — Sección de administración de PLUs (solo admins) (COMPLETA)

Objetivo: que los administradores gestionen precios/PLUs y los carguen en la balanza, aprovechando los comandos KRETZ ya validados en Fase 1.

Entregado:
- [x] Vista **exclusiva para admins** (rol verificado), no visible para cajeras.
- [x] CRUD de PLUs: crear, modificar (nombre/precio), **cambiar número**, eliminar.
- [x] **Edición masiva**: preparar varios cambios como borrador y aplicarlos como lote.
- [x] Botón **"Cargar en balanza"**: `KRETZ_SYNC_CATALOG` verifica el enlace R30 (`0002`) antes de enviar; aborta si la balanza no responde. Vuelca todos los productos activos con PLU y precio vigente del local vía comando `2005` (upsert). Envío secuencial con barra de progreso en tiempo real (`KRETZ_SYNC_PROGRESS`). Conversión de precio: pesos × 10, 6 dígitos, 1 decimal implícito (compatible iTegra). Omite productos sin precio o con precio > $99.999 y los reporta. UI en `KretzSyncModal.tsx`.
- [x] **Detección automática de puerto KRETZ** desde DevTools → Hardware.
- [x] Tests: gating por conexión física, lote aplicado correctamente, fallo aislado reportado (sin rollback físico posible — hardware no lo permite).
- [x] Gestión de cajeras (alta, edición, soft-delete) desde panel admin.
- [x] Contraseña de cajera enmascarada en panel admin.
- [x] Eliminación de usuario con doble confirmación; orphaned Firebase Auth users documentados como deuda técnica.

Pendiente de largo plazo:
- Auditoría de cambios de PLU (quién cambió qué y cuándo) — **hecho en TASKS_V1 BLOQUE I-B** (2026-08-30): `catalog_audit_events` + historial de precios. Backup / rollback masivo sigue siendo **FEAT-CAT-03**, no ahora.
- Backup / rollback de edición masiva de precios: anotado en BLOQUE I, **no ahora**.

**Cierre formal:**
- [x] `pnpm run test` — suite en verde
- [x] Testeo manual aprobado por el desarrollador (jul 2026)

### ✅ Fase 5 — Cierre de jornada y gastos (COMPLETA)
Tag: `fase5-completa` | Tests: 351 en verde

Entregado:
- [x] Registro de gastos durante la jornada con categoría libre + autocomplete de categorías usadas.
- [x] Balance de efectivo en tiempo real en pantalla cajera (`efectivo inicial + ventas en efectivo - gastos`).
- [x] Vista en vivo del turno: columna compacta derecha + modal expandido con resumen por hora.
- [x] Anulación de ventas del turno activo (soft delete `status='cancelled'`), con registro visual tachado.
- [x] Modal de cierre (`CloseShiftScreen`): resumen del turno con desglose digital por tipo (débito/billetera/crédito), campo "monto entregado + a quién", conteo de billetes argentinos ($20.000–$10) con modos cantidad/total por denominación, preferencia persistida por usuario.
- [x] Auto-cierre por inactividad: daemon configurable (`inactivityThresholdHours` en `business.json`), countdown modal 5 min, dismiss reinicia el reloj.
- [x] Pantalla de confirmación post-cierre antes de volver al login.
- [x] Campo de efectivo obligatorio en `PaymentModal` con botón "Paga justo".
- [x] Generador de ventas de prueba (dev-only) en `DevToolsPanel`.
- [x] 351 tests en verde — cobertura ≥ 80% en IPC, DB y reglas de negocio.

**Aislamiento de turnos (implementado desde Fase 4):**
- Cada cajera/admin tiene su propio turno; nunca hereda el de otra persona.
- Dos usuarios distintos pueden tener turnos abiertos simultáneamente (caso de traspaso).
- Cajera A cierra su turno con arqueo; luego Cajera B abre el suyo.

### ✅ Fase 6 — Clientes especiales y deudas (COMPLETA)
Tag inicial: `fase6-completa` | Refinamientos: jul 2026 | Tests finales: 411 en verde

Entregado (implementación base):
- [x] ABM de clientes: DNI, teléfono, tipo (restaurant/mayorista/otro), notas.
- [x] Búsqueda accent-insensitive de clientes por nombre, DNI o teléfono.
- [x] Modelo de ledger en `debt_events` — nunca sobreescritura, saldo algebraico.
- [x] Flujo de fiado desde cajera: `DebtModal` con búsqueda/creación inline de cliente + fecha de vencimiento opcional.
- [x] `DebtsScreen`: lista de deudas activas con saldo, historial de eventos por cliente, pago parcial/total, cancelación con doble confirmación.
- [x] Botón "Fiados" en header cajera y acceso desde AdminHub.
- [x] Migración 0007: `dni` en `customers`, `due_date` en `debt_events`.

Refinamientos y mejoras adicionales (jul 2026):
- [x] **Clientes especiales** como entidad separada de fiados: tabla propia (`special_customers` + `special_customer_prices`, migración 0008), admins crean/editan/eliminan, cajeras solo consultan. Los precios son informativos — no afectan el carrito automáticamente. (El selector del POS que *sí* los aplicaba quedó **oculto**: `FEAT-SPECIAL-POS-SELECTOR-01`.)
- [x] **Gestión de precios especiales inline**: disponible desde la creación y edición del cliente (no solo post-creación). Typeahead de productos por nombre o PLU con precio de lista visible para referencia.
- [x] **Acordeón por tarjeta** en `SpecialCustomersScreen`: contraída por defecto, se expande al tocar la cabecera; muestra resumen del conteo de precios cuando está contraída.
- [x] **Medio de pago en fiado**: el `DebtModal` solicita el medio de pago (efectivo, débito, billetera, crédito o combinación) para el monto inicial. Los pagos se registran en `sale_payments` para que el cierre de caja los contabilice correctamente.
- [x] **Buscador de clientes en Fiados**: input de filtro por nombre en `DebtsScreen`.
- [x] **Carrito persistente**: `CashierScreen` permanece montado (oculto) al navegar a Fiados o Clientes especiales; el carrito no se pierde. El lector USB se desactiva automáticamente en segundo plano.
- [x] `CustomerSearchCreate`: short-circuit cuando el query extiende un prefijo sin resultados (evita flash y IPC innecesario); `maxLength=100` alineado al backend; truncate con `title` en el mensaje de no-encontrado.
- [x] Teléfono formateado en paso 2 del `DebtModal`.
- [x] Campo inicial de pago con auto-select al hacer foco.

**Admin móvil — catálogo para Clientes especiales (ago 2026):**
El “no hay panel de catálogo en el celular” (checklist 4.3 / TASKS_V1 BLOQUE I) se refiere a **no editar productos/precios de lista** en el teléfono (eso sigue siendo el Panel de Administración de la PC). No aplica al typeahead de Clientes especiales: esa pantalla **debe** bajar el catálogo publicado (`licenses/{tenant}/catalog/{storeId}` de todos los locales, union por `productId`) y listar **todos** los productos, ordenados por PLU ascendente, buscando por nombre o PLU. Sin recorte artificial de la lista. No espera al listener en vivo (BLOQUE I-A): un ↺ o reentrar a la sección alcanza. Lecturas: 1 documento por local, no 1 por producto. Escala de Historial / cupo Spark: **DT-08**.

**Testeo 2026-08-24:** lista y ABM celu↔PC OK; UI celu alineada a PC. Selector de precios en el POS: oculto 2026-08-27 (`FEAT-SPECIAL-POS-SELECTOR-01`).

Pendiente de largo plazo (no bloqueante):
- **Actualización masiva de precios especiales**: cuando la lista de clientes crezca, opciones posibles son (a) vista tabla cruzada producto×cliente o (b) campo "% de descuento fijo" por cliente que recalcule automáticamente al actualizar el catálogo. Documentado también en comentario de `SpecialCustomersScreen.tsx`. Requiere validar con los dueños antes de implementar.

**Cierre formal:**
- [x] `pnpm run test` — 411 tests en verde
- [x] Cobertura ≥ 80% en IPC, DB y reglas de negocio
- [x] Testeo manual aprobado por el desarrollador (jul 2026)

### Fase 7 — Pedidos, historial y reportes admin

- ABM de pedidos con estado (pendiente / listo / entregado / cancelado).
- Panel admin: historial de ventas, reportes por turno/período. (El catálogo/precios se gestionan en Fase 4.)
- Registro local de medios de pago. La app no interactúa con caja registradora ni terminal de pago.
- **Rework de cobro (hecho 2026-09-02, Pedidos PC cerrado 2026-09-04):** `FEAT-ORDER-CART-01`. Cobrar arma el carrito en el POS. Lista de Pedidos: [`CHECKLIST_TESTEO_PEDIDOS_LISTA.md`](CHECKLIST_TESTEO_PEDIDOS_LISTA.md). Carnicero celu: [`CHECKLIST_TESTEO_CARNICERO.md`](CHECKLIST_TESTEO_CARNICERO.md).

### Fase 8 — Stock ⚠️ DISEÑO ACORDADO — IMPLEMENTACIÓN BLOQUEADA

> **Especificación funcional completa:** [`docs/STOCK_DOMINIO_FUNCIONAL.md`](./docs/STOCK_DOMINIO_FUNCIONAL.md). Ese documento es la fuente de verdad del dominio. Lo que sigue es un resumen del enfoque; no duplicar definiciones aquí.

**Modelo por eventos con disponibilidad estimada.**

La charla con los dueños del negocio (jul 2026) definió el enfoque:

- El sistema no busca stock exacto. Los dueños llevan más de veinte años con estimaciones y no van a cambiar esa forma de operar. El objetivo es automatizar los cálculos que hoy hacen mentalmente y conservar evidencia histórica consultable.
- El stock no es una fotografía: es la consecuencia de eventos fechados. Los eventos son hechos observados (ingresos, ventas, conteos físicos, descartes, devoluciones, cambios de condición) o estimaciones operativas (distribución de una media res entre cortes mediante perfiles de rendimiento aprobados).
- **La aplicación proyecta, no afirma.** Cuando el desposte no fue pesado corte por corte, el sistema estima la disponibilidad probable usando el perfil vigente y lo comunica como estimación, nunca como certeza.
- **La aplicación conserva evidencia, no la descarta.** Los conteos físicos corrigen la disponibilidad actual; no borran ni reinterpretan los eventos históricos.
- **La aplicación sugiere, no decide.** Puede señalar que los datos observados divergen del perfil vigente, pero la recalibración siempre es manual y requiere aprobación de un administrador.

**Disponibilidad clasificada por condición (no por ubicación física):**
- Disponible para venta inmediata (mostrador + cámara refrigerada cuando ambos están aptos).
- Congelado (mismo producto, condición distinta: altera decisiones de compra, rotación y respaldo).
- Otros estados solo si crean una decisión operativa real.

**Eventos de registro obligatorio:** ingreso de mercadería, venta confirmada (automático desde POS), conteo físico por condición, descarte o merma excepcional, devolución al proveedor, cambio relevante de condición (congelar/descongelar).

**Descarte de mercadería** (incluyendo el caso de corte de luz prolongado) es un evento obligatorio dentro del modelo general, no una función aislada. Registra qué se descartó, cuánto, por qué y quién lo declaró.

**Decisiones pendientes que bloquean partes de la implementación** (ver spec completa):
- Modelo de ingreso para pollo, cerdo, embutidos y congelados.
- Tratamiento de devoluciones de clientes.
- Flujo de transferencias entre locales.
- Definición de umbrales para sugerencias de recalibración.
- Canal de alertas de disponibilidad baja.

### Fase 9 — Empleados, vales y asistencia

- ABM de empleados con rol (`butcher`, `cashier`, `other`).
- Registro de vales/adelantos contra salario semanal.
- Registro de asistencia con estados y justificaciones.

### Fase 10 — Dashboard remoto

- Dashboard web en Firebase (React, misma base de código o mini-app separada).
- Vista de ventas del día, turno activo y totales por medio de pago.
- (El escaneo móvil dejó de ser "emergencia" y se trata como componente central en Fase 3.)

---

## Checklist de testeo con balanza física — Fase 4

Ejecutar cuando la balanza KRETZ REPORT NX esté disponible. Prerequisitos: ver `SESION_CAMPO_2026-06-15_KRETZ_PLU.md`.

### Preparación
- [ ] Cerrar iTegra y cualquier otro programa que use el puerto COM de la balanza.
- [ ] Verificar en Administrador de dispositivos que la balanza aparece como puerto COM (driver JDATAGATE instalado). **El número de COM puede variar** entre PCs o balanzas idénticas (ej. COM8 en una, COM11 en otra).
- [ ] Ejecutar `pnpm seed:dev` para asegurarse de tener el catálogo de prueba cargado.
- [ ] Iniciar la app: `pnpm dev` o `pnpm dev:hw` (este último fuerza COM8 por variable de entorno; si la balanza está en otro COM, usar detección automática — ver abajo).
- [ ] **Detectar la balanza:** DevTools → pestaña **Hardware** → **"Detectar balanza automáticamente"**. La app sondea todos los puertos COM, se conecta al que responda R30 y guarda el puerto (sin reiniciar). Alternativa manual: ingresar el COM en el mismo panel y guardar (requiere reinicio).

### Verificación de conexión base
- [ ] Loguearse como admin en la app.
- [ ] Ir al Panel de administración.
- [ ] Hacer click en **"Cargar en balanza"** → debe aparecer el modal de confirmación (no un error).
- [ ] Si aparece error "La balanza no respondió", ir a DevTools → Hardware: verificar indicador "Conectado", ejecutar **"Detectar balanza automáticamente"** (cerrar iTegra antes) y reintentar.

### Carga masiva del catálogo
- [ ] Con el modal abierto, hacer click en **"Cargar en balanza"**.
- [ ] Verificar que la barra de progreso avanza PLU a PLU durante el envío.
- [ ] Al finalizar, el resumen debe mostrar todos los productos enviados correctamente (0 fallidos).
- [ ] En la pantalla de la balanza, navegar a la lista de PLUs y confirmar que los productos aparecen con los nombres y precios correctos (precio en pantalla = pesos con un decimal, ej. $16.322,0).
- [ ] Verificar en particular un precio redondo (ej. Pollo $4.069 → debe mostrar $4.069,0) y uno con 5 dígitos (ej. Lomo $24.466 → debe mostrar $24.466,0).

### Verificación de upsert (no destruye lo existente)
- [ ] Cambiar el precio de un producto en el panel admin (ej. Asado de tira → nuevo precio).
- [ ] Hacer "Cargar en balanza" nuevamente.
- [ ] Confirmar en pantalla de la balanza que el PLU de Asado de tira refleja el precio nuevo.
- [ ] Los PLUs que no estaban en el catálogo de la app (si hubiera alguno cargado manualmente) deben seguir intactos en la balanza.

### Caso de error controlado
- [ ] Desconectar el cable USB de la balanza.
- [ ] Intentar "Cargar en balanza" → debe mostrar el error "La balanza no respondió" sin haber enviado nada.
- [ ] Reconectar, verificar enlace (el driver reconecta automáticamente en ~5 segundos) y cargar de nuevo → debe funcionar.

### Cierre de fase 4
- [ ] Suite completa verde: `pnpm -r test`
- [ ] Typecheck: `pnpm --filter @carniceria/desktop typecheck`
- [ ] Crear tag: `git tag -a fase4-completa -m "Fase 4 cerrada: panel admin PLU + carga masiva KRETZ validada en campo"`
- [ ] Push (pendiente aprobación del desarrollador).

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
- **`apps/desktop/config/business.json` preparado** con: `business_name`, `license_key`, `default_store_id`, `timezone`, `inactivityThresholdHours`, `logo_path`, `theme`. No se versiona. Copiar del template `apps/desktop/config/business.example.json`. Ver [`apps/desktop/BUILD-PRODUCCION.md`](./apps/desktop/BUILD-PRODUCCION.md).
- **`.env.production` preparado** en la raíz del proyecto con las claves `VITE_FIREBASE_*` del proyecto Firebase. No se versiona. Las variables se incrustan en el build — no se pueden cambiar post-instalación sin recompilar.
- **Instalador `.exe` compilado** con `pnpm build:prod` (`APP_ENV=production`). Salida en `apps/desktop/release/`. Probado en una PC limpia (sin Node, sin el proyecto en disco). Verificado que el banner de pruebas **no** aparece y que el botón de bypass de login no existe.
- **Build de producción verificado**: `afterPack` no encontró artefactos de dev.
- **Driver JDATAGATE** de KRETZ descargado (compatible con REPORT NX). En USB o carpeta accesible.
- **Suite de tests en verde al 100%** antes de compilar el instalador final.

### 2. Pasos de instalación en la PC del local

Ejecutar en este orden. No saltear pasos.

1. Instalar driver JDATAGATE de KRETZ. Reiniciar si lo pide. Verificar en Administrador de dispositivos que el puerto aparece.
2. Verificar que `apps/desktop/config/business.json` y `.env.production` están completos **antes** de compilar (`pnpm build:prod`). Ver [`apps/desktop/BUILD-PRODUCCION.md`](./apps/desktop/BUILD-PRODUCCION.md).
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

---

## Deuda técnica documentada — pendiente de diseño/implementación

### DT-01: Selección incorrecta de local al iniciar sesión

**Descripción del problema:**
Al abrir caja la cajera elige el local en el que va a trabajar. Si presiona el local equivocado no puede volver atrás: solo puede cerrar la caja, lo que genera un turno/cierre sin sentido. En el peor caso, la cajera no se da cuenta del error y registra ventas, gastos y movimientos en el local incorrecto durante toda la jornada.

**Impacto real:**
- Estadísticas de venta del local incorrecto infladas/desinfladas.
- Historial cruzado entre locales.
- En el caso del local B que tiene menor volumen de ventas, unos pocos días de error pueden distorsionar significativamente los reportes del local A.

**Dos sub-problemas a resolver:**

**1. Volver atrás antes de abrir caja (corrección inmediata)** ✅ RESUELTO (jul 2026)
La pantalla "Abrir turno" ahora muestra un botón "← Cambiar local" para cajeras. Si hay más de un local activo, lleva de vuelta al selector. Si solo hay uno, va al login.

**2. Migración de datos si el error fue descubierto tarde (corrección tardía)**
Si la cajera ya registró ventas y gastos en el local incorrecto, se necesita una herramienta de admin para migrar los datos de ese turno al local correcto. Los datos involucrados son:
- Turno (`shifts.store_id`)
- Ventas (`sales.store_id`)
- Pagos de ventas (`sale_payments`)
- Gastos (`expenses.store_id`)
- Eventos de deuda a proveedores (`provider_debt_events.store_id`)
- Pedidos con seña registrados en ese turno

La migración debe ser atómica (una transacción SQLite única), requiere doble confirmación admin y debe dejar un evento de auditoría indicando que se realizó la corrección, quién la autorizó y cuándo.

**Prioridad:** Media-baja en contexto actual (2 locales con cajeras que conocen bien su lugar de trabajo). Aumenta si se agregan locales o si hay rotación frecuente de cajeras entre locales.

**Cuándo implementar:** Antes de cualquier expansión a 3 o más locales, o si se reporta el problema en producción.

---

### DT-02: Login offline en PC — caché de credenciales en `safeStorage`

**Descripción del problema:**
`signInWithEmailAndPassword` de Firebase requiere red activa. Si la PC arranca sin internet (corte de luz + router offline, por ejemplo), la cajera no puede iniciar sesión aunque la base de datos local esté intacta y toda la operación sea 100% offline.

**Por qué no alcanza con restaurar la sesión del último usuario:**
En un local con dos cajeras (mañana y tarde), la cajera de la mañana podría "saltear" el login simplemente desenchufando el cable de red para entrar automáticamente como la cajera de la tarde (el último usuario cacheado). Eso invalida la trazabilidad de acciones.

**Solución acordada — Opción E: validación local con hash en `safeStorage`:**
- Al login exitoso con Firebase, el proceso main guarda en `safeStorage` por cada usuario: `{ userId, name, role, email, hash: scrypt(password), storedAt, expiresAt: ahora + 30 días }`.
- En ausencia de internet, la pantalla de login es **idéntica** a la normal — sin botón de bypass ni modo especial visible. La cajera ingresa email + contraseña como siempre.
- El main intenta Firebase → falla por red → busca hash local para ese email → compara con `crypto.scrypt` (Node.js nativo, sin dependencias nuevas).
- Si el hash coincide: sesión válida con banner amarillo "Sin conexión — sesión guardada localmente".
- Si no coincide o el email nunca fue logueado en esa PC: "Credenciales incorrectas o sin conexión." — sin información adicional.
- Cuando vuelve internet: re-verificación silenciosa en background; si la cuenta fue deshabilitada en Firebase se fuerza logout.
- El hash expira a los 30 días para forzar re-autenticación online periódicamente.

**Limitación aceptada:** Una cajera nueva que nunca hizo login en esa PC necesita internet la primera vez. No hay solución para ese caso y no se contempla.

**Módulos a crear/modificar:**
- `electron/offlineAuth.ts` — `cacheCredentials(email, password, profile)` y `validateOffline(email, password)`.
- `electron/licensing/session.ts` — intentar `validateOffline` si Firebase lanza `auth/network-request-failed`.
- Renderer: leer flag `offlineSession` del estado de sesión para mostrar el banner.

**Prioridad:** Alta — es un escenario realista en operación diaria.

**Cuándo implementar:** Antes de la entrega al cliente / puesta en producción real. No bloquea desarrollo, pero debe estar antes del primer uso real sostenido.

---

### DT-03: Retomar turno propio al reiniciar sesión

**Descripción del problema:**
La validación anti-duplicados implementada en jul 2026 (`SHIFT_ALREADY_OPEN`) bloquea cualquier intento de abrir turno si ya hay uno abierto en ese local. El comportamiento correcto cuando el turno abierto es de la misma cajera que está iniciando sesión es **retomar ese turno automáticamente**, no mostrar un error.

Casos que este bug afecta:
- La PC se reinicia (corte de luz, actualización de Windows) en medio de un turno.
- La cajera cierra sesión sin cerrar turno y vuelve a entrar.
- La cajera inicia sesión desde el celular mientras su turno de PC sigue abierto.

**Solución:**
En el handler `OPEN_SHIFT`, si ya hay un turno abierto en el local y su `userId` coincide con `session.userId`, devolver el turno existente en lugar de retornar `SHIFT_ALREADY_OPEN`. El renderer (`OpenShiftScreen` / `App.tsx`) detecta este caso y setea `shiftId` en la sesión activa sin mostrar pantalla de apertura.

Si el turno abierto pertenece a **otra** cajera, mantener el bloqueo actual con el mensaje existente.

**Prioridad:** Alta — es un escenario cotidiano (reinicios de Windows, etc.).

**Cuándo implementar:** Antes de la entrega al cliente / primera jornada real.

---

### DT-04: Local por defecto por dispositivo PC — **hecho 2026-09-06 (último local + confirmación)**

**Descripción del problema:**
Las PCs son estáticas — cada una vive permanentemente en un local. Pedir a la cajera que seleccione el local en cada sesión es una fricción innecesaria y una fuente de error (selección de local equivocado → turno registrado en el local incorrecto → ver DT-01).

**Solución implementada (no es pin remoto ni admin en la PC del local):**
Cada usuario, en cada PC, recuerda el **último local que eligió** (`localStorage` del renderer). En el picker se resalta **Último local**. Entrar ahí es un toque. Elegir **otro** pide confirmación extra (“¿Confirmás este local?”). La primera vez en esa PC no hay resaltado ni modal. Un solo local activo se sigue eligiendo solo.

No hace falta que el admin inicie sesión en la caja. Un pin remoto por máquina (inventario de PCs en Firestore) sería otro producto; no se hizo.

Para la app móvil no aplica el mismo flujo de caja; el carnicero ya preselecciona el último local en el celu.

**Prioridad:** Media — mejora UX pero DT-01 sub-problema 1 ya mitiga el riesgo principal.

**Cuándo implementar:** Hecho 2026-09-06.

---

### DT-05: Compactación histórica de datos (data tiering)

**Descripción del problema:**
A largo plazo (2+ años), la tabla `sales` puede crecer a millones de filas. SQLite lo maneja sin problema en términos de rendimiento, pero las consultas históricas de períodos largos pueden volverse lentas y el archivo `.sqlite` puede crecer considerablemente (estimado: 200-400 MB en 3 años a volumen de carnicería con 2 locales).

**Solución acordada:**
No implementar compactación destructiva. En cambio, agregar un job diario que materialice agregados en una tabla `daily_summaries`:
- Ingresos totales por día, desglosados por medio de pago.
- Cantidad de ventas y tickets promedio.
- Total de gastos por turno y por local.
- Promedio de cierre de caja.

Las consultas históricas del panel admin leerán `daily_summaries` (N filas donde N = días) en lugar de hacer `SUM()` sobre millones de ventas. Las ventas individuales permanecen intactas e íntegras — no se destruye información.

**Por qué no ahora:**
- El volumen proyectado no genera problemas de performance en el horizonte de 3-5 años.
- Implementar ahora añade complejidad sin beneficio real inmediato.
- La compactación destructiva (borrar ventas individuales viejas) es irreversible; si surgiera necesidad de ese detalle luego, ya no estaría disponible.

**Prioridad:** Baja — para evaluar cuando el archivo `.sqlite` supere los 500 MB o las consultas históricas demoren más de 2 segundos.

**Cuándo implementar:** Largo plazo, solo si el rendimiento real lo justifica.

---

### DT-06: Sincronización multi-dispositivo en tiempo real (turno compartido)

**Visión objetivo:**
La misma cajera puede trabajar en PC y celular de forma intercambiable, como un juego con progreso en la nube. Si registra una venta en PC, el celular la ve en tiempo real. Si la luz se corta y continúa en el celular, cuando vuelve la luz la PC retoma exactamente donde dejó el celular, sin cerrar turno ni volver a abrirlo. Un solo turno, varios dispositivos, sincronizados a través de Firebase.

**Estado actual (jul 2026, aclarado 2026-08-25):**
El auto-resume en PC (`GET_USER_OPEN_SHIFT`) solo detecta turnos `source='desktop'`. El celu sube a `sync/{storeId}/shifts` y la PC **importa** a SQLite con `source='mobile'`, pero **ese turno no es la caja activa**.

Además el Historial (PC y admin celu) **lista también** `source='mobile'` con etiqueta **Móvil**. Siguen siendo dos turnos distintos (no es la caja activa de PC). El celu escribe copia operativa en `licenses/{tenant}/shifts` y `sales` para que el historial remoto las vea.

Workaround operativo: cerrar en el celu y abrir otro en la PC. Quedan dos IDs de turno. Cuando se implemente DT-06, el objetivo es **un** turno y varios dispositivos, no fusionar a mano dos cierres viejos.

Estadísticas “por turno” en el futuro: o se deja de filtrar `source` y se muestran dos jornadas (Mañana PC + Mañana celu) sumables por día/cajera/local, o se unifica en vivo (esta deuda). No hay un “mismo turno con 2 cajas” en el modelo actual.

**Prerequisitos técnicos para implementar la visión completa:**
1. **Sync operacional PC → Firestore en tiempo real**: ventas, gastos, estado del turno (monto en caja) se pushean a Firestore al confirmar cada operación (outbox pattern, igual que proveedores).
2. **Sync Firestore → PC en tiempo real**: `onSnapshot` listener que reciba updates de otro dispositivo del mismo usuario y los aplique al SQLite local.
3. **Sync operacional mobile → Firestore**: la app móvil ya escribe en Firestore (modelo actual), pero las ventas y gastos aún no.
4. **Resolución de conflictos**: si dos dispositivos registran operaciones simultáneas (el usuario tiene la app abierta en ambos), se necesita una estrategia de merge (CRDT o timestamp-last-write-wins son opciones válidas para este dominio).
5. **Auto-resume cross-device**: `GET_USER_OPEN_SHIFT` incluye `source='mobile'` y el IPC `OPEN_SHIFT` detecta turnos abiertos en cualquier dispositivo, ofreciendo reanudar con los datos ya sincronizados.

**Impacto arquitectónico:**
Mueve ventas y gastos de "datos 100% locales" a "datos sincronizados con Firestore", lo cual es una extensión natural del modelo que ya se usa para proveedores (Fase S1). Es el paso más grande hacia la arquitectura de nube completa descrita en la visión de largo plazo del proyecto.

**Prioridad:** Media-alta — el escenario de corte de luz es poco frecuente pero no improbable, y la sincronización multi-dispositivo es una expectativa central del producto a largo plazo.

**Cuándo implementar:** Fase futura dedicada (sugerido: Fase S2 — Sync operacional). No bloquea ninguna fase actual.

---

### DT-07: Historial de proveedores a escala + memoria del celular (acordado 2026-08-20)

**Estado (2026-09-04):** código de checkpoint + job + listener hecho. Documentación de la oleada: `docs/FIRESTORE_DT07_DT08.md`. Pendiente de producción: deploy de índices/reglas, `--apply` del backfill de `createdAtServer`, y recién ahí `mobile:deploy`. El detalle de **un** proveedor sigue pidiendo sus eventos (no el ledger entero al boot).

**Problema:**
Hoy el historial admin de PC pide a Firestore **todos** los eventos de un proveedor (`where providerId == X`, sin fecha ni `limit`). El celu admin, al entrar a Proveedores, hace `getDocs` de **toda** la colección `providerDebtEvents` para armar saldos e historial. El listener de PC (`onSnapshot` de esa colección) además **copia todos los eventos al SQLite de cada PC**.

Un proveedor que va lun–sáb a ambos locales ≈ 12 eventos/semana ≈ 600/año. Varios así, en meses, hace inviable “traer todo” (lecturas Firebase, RAM en celu, disco en PC). El admin **no** necesita enero en pantalla si está en agosto.

**Uso real del historial (no es un feed diario):**
- “¿Cuánto le pagábamos en enero a este proveedor?”
- “El proveedor no se acuerda qué pasó en X fecha — ¿qué tenemos registrado?”
Filtro **desde–hasta** (o por mes) para ese recorte. Default razonable: mes en curso / últimos ~30 días. No bajar feb–ago si solo pide enero.

**Checkpoint de saldo (acordado — buena idea):**
El saldo actual **no** debe recalcularse recorriendo todo el historial. Cada tanto (p. ej. cierre de mes, o cada N eventos) materializar un **checkpoint** por proveedor+local: `{ providerId, storeId, asOf, balance }`. Deuda vigente = último checkpoint + eventos posteriores. Los eventos viejos **no se borran** (igual que DT-05: sin compactación destructiva). El historial de un rango se consulta a Firestore con `providerId` + `createdAt` (índice compuesto + `limit` / cursor). El saldo de las cards sale del checkpoint, no de bajar la colección.

**Memoria en celulares de cajeras:**
Varias cajeras tienen el teléfono lleno (a veces no abre WhatsApp). **Requisito:** el celu no es el archivo histórico. Sesión + lo mínimo para operar offline (catálogo, turno/ventas pendientes). Historial largo y ledgers viven en Firebase y se piden **de a páginas / por rango**. No persistir la colección entera en IndexedDB/SQLite del teléfono. Aplica a admin móvil y, cuando escale, a no cachear ledgers de proveedores en el POS.

**Relacionado:** DT-05 (summaries de ventas en SQLite, otro dominio). DT-08 (mismo criterio aplicado a `sales` / Historial). UX-MOB-REFRESH-01 (↻ recargar lo justo) es otra cosa.

**Prioridad:** Media — no bloquea el testeo actual; conviene antes de meses de uso real, sobre todo en celu.

**Cuándo implementar:** Hecho en código (2026-09-04) junto con DT-08. Producción: ver `docs/FIRESTORE_DT07_DT08.md` §9.

---

### DT-08: Lecturas Firestore — Historial de ventas y “pedir solo lo que se mira” (acordado 2026-08-24)

**Estado (2026-09-04):** recortes de Historial / pedidos / turnos / staging móvil / vales hechos (palanca 1). Documentación: `docs/FIRESTORE_DT07_DT08.md`. **No hecho:** cache + debounce del ↻ (palanca 2), mensaje de cuota agotada, historial de cajera. Conviene tener índices desplegados **antes** de 6–12 meses de uso real a 350 ventas/día.

Fuente de verdad de este tema. DT-05 y DT-07 son piezas del mismo rompecabezas; no se contradicen.

#### Principio (innegociable de producto)

Las personas que usan la app (dueños, cajeras; ≤10 por día, no técnicas) **no** tienen que saber qué es Firebase ni dosificar clics. No hay “máximo X veces al día”. Si el uso normal puede agotar el cupo, **la consulta está mal**, no el usuario. Tampoco hay un botón secreto para “romper” la app: el único escenario feo es una pantalla que pide **todo el archivo** cuando ya es grande.

#### Criterio ampliado (2026-08-24): imposible de agotar a mano

Pedido de producto: aunque alguien (admin, cajera, carnicero, o varios a la vez) pase el día generando peticiones **a propósito**, que **humanamente** no pueda tumbar el sync. Años de datos no cambian eso: la app pide cada vez menos relativo al archivo, nunca “todo”.

**Qué sí es posible**

Con queries recortadas (turno / fecha / página) el costo de **una** pantalla deja de crecer con los meses. Un turno de 150 ventas ≈ 150–250 lecturas al abrir el detalle, no 50.000. Abrir Historial el 24 de agosto de 2028 cuesta lo mismo que abrirlo mañana, porque no se baja 2026–2028.

Eso solo no alcanza contra un mash de ↻: 50.000 / 250 ≈ 200 refrescos. Un humano acelerado puede llegar. Por eso DT-08, cuando se implemente, incluye **tres palancas juntas**, no un cartel de “no pulses tanto”:

1. **Pedir solo lo visible** — `where shiftId` / rango de fechas / `limit` de página. Prohibido `getDocs` de colecciones que crecen. Default de lista: hoy o últimos días, no “desde que existe la app”. No hay acción de producto que signifique “traer el archivo entero”.
2. **No volver a pagar lo mismo** — cache de sesión del detalle ya abierto; salir y entrar al mismo turno no re-descarga. El ↻ solo pega si pasó un mínimo (p. ej. 10–30 s) o si hay dato nuevo. Varios dispositivos: cada uno paga su primer snapshot; no clonar `onSnapshot` de colecciones grandes en el celu.
3. **Páginas chicas y estables** — ABM (locales, personal, clientes especiales, catálogo = 1 doc/local) ya está en este régimen. El riesgo es Historial + ledger de proveedores (DT-07).

Con (1)+(2), 8 h de alguien obsesivo quedan en el orden de miles de lecturas, no de 50.000. Varios usuarios a la vez no lo multiplican al archivo completo: multiplican el recorte (turnos del día).

**Qué no es posible (y no hace falta)**

Un **script** que dispare `getDocs` en loop no se puede garantizar en Spark: no hay rate-limit nuestro en el servidor. No es el threat model (carnicería, no atacante). No se pone “máximo X consultas al día” en la UI. No se sube a Blaze “por las dudas”.

**Dónde aplicar** (hecho 2026-09-04 salvo lo marcado)

| Lugar | Qué cambia |
|---|---|
| `apps/mobile/src/lib/adminHistory.ts` | `fetchAdminShifts` / `fetchAdminSalesForShift` / vales de local: hoy `getDocs` de la colección y filtro en memoria. Pasar a `where` fecha/local/turno + `limit`. |
| `apps/mobile/src/lib/adminFirestore.ts` | Gastos/pedidos/deudas de proveedor si aún bajan la colección entera. |
| `apps/desktop/electron/licensing/historyFirestore.ts` | `fetchHistoryShiftsFromFirestore` (lista): mismas 5 colecciones enteras. La lista debe armarse desde `shifts` recortados, no sumando todas las `sales`. El detalle **ya** va por `shiftId` (+ fallback `saleId` de fiados viejos). |
| Renderer Historial (celu + PC remota) | Cache del último detalle; debounce del ↻. **Pendiente.** |
| DT-07 en la misma oleada | `providerDebtEvents` no puede ser `onSnapshot` de todo el ledger al boot de cada PC. |

No reformular el producto (seguir viendo el ticket de hace 8 meses si se pide **ese** día). Reformular **cómo se pide**: el archivo vive en Firestore; el cliente no lo descarga hasta que alguien abre ese recorte.

Spark (plan gratis): **50.000 lecturas/día**, **20.000 escrituras/día**. **No factura** si te pasás: **corta** el sync hasta el día siguiente. Síntoma: “no carga / no sincroniza”, no un cargo. Aviso claro en la UI cuando Firestore devuelva cuota agotada = mejora secundaria (hoy no hay copy dedicado); no reemplaza arreglar las consultas.

#### Qué es una lectura (para no mezclar)

Una lectura = **un documento** que Firestore devuelve.

| Acción | Lecturas |
|---|---|
| `getDoc` de 1 documento que existe | 1 |
| `getDocs` / primer `onSnapshot` de una colección con N docs | **N** |
| Cambio posterior en un `onSnapshot` ya abierto | 1 por documento que cambió, **por cada dispositivo** que esté escuchando |
| Campos o arrays **dentro** de un documento (104 productos, 8 ítems de una venta) | **0 extra** |

El celu admin hoy, al abrir una sección, hace `getDocs` de esa colección (`adminFirestore.ts`). Salir y volver a entrar = otra vez N. La PC, al login, deja `onSnapshot`: el primer aviso = N; después, un rename = 1 por PC abierta.

Eso **no** es un problema en colecciones chicas (3 clientes especiales, 8 locales, 7 empleados). Abrir Clientes especiales 50 veces × 6 personas sigue en cientos de lecturas.

**Celu → PC se ve al toque, PC → celu no:** la PC tiene listener; el celu no. Es asimetría de diseño, no un leak de cuota. No hace falta clonar todos los listeners en el teléfono “por las dudas”.

#### Lo que ya está bien — catálogo

No es “104 productos × veces que entré”. Cada local es **un** documento `licenses/{tenant}/catalog/{storeId}` con `products: [...]` adentro (`catalogPublish.ts` `setDoc`; celu POS `getDoc` en `syncCatalog`; Clientes especiales `getDocs` de la colección `catalog` = **1 lectura por local**, no por producto). ~100 productos caben holgados (límite ~1 MB/doc). BLOQUE I-A (listener en vivo del catálogo) es otra tarea; no es DT-08.

Cada **venta** sí es su propio `sales/{saleId}`; ítems y pagos van **embebidos** (`saleSync.ts`). Una venta de 8 productos = 1 lectura, no 9. Lo que escala es **cuántas ventas pedís**, no los renglones de cada ticket. 350 ventas/día ≈ 350 escrituras; lejos de 20.000.

#### Volumen real (techos, 2 locales)

Local grande ≤200 ventas/día; el otro ≤150. Techo combinado **350/día** × ~26 días ≈ **9.000/mes**.

| Tiempo | Docs en `sales` | Un `getDocs` de toda la colección |
|---|---|---|
| 1 mes | ~9.000 | cómodo |
| 3 meses | ~27.000 | más de la mitad del cupo diario |
| 6 meses | ~54.000 | **un** abrir Historial se pasa de 50.000 |
| 1 año | ~100.000 | un abrir ni arranca |

Si admin y una cajera abren Historial el mismo día con el patrón actual, se duplica. Nadie está usando mal la app.

Historial **en la PC del local** contra SQLite de esa caja = **0 lecturas** Firebase. El cupo duele cuando el dato viaja por red: celu, admin en casa, PC remota (`historyFirestore.ts`).

Dispositivos: hasta **3 PCs** abiertas (caja del local grande, PC de dueños, futura PC del segundo local). Suelen apagarse: cada boot **vuelve a cobrar** el primer snapshot de cada listener, incluida `providerDebtEvents` entera (DT-07). Colecciones chicas: irrelevante. Ledger de proveedores creciendo: el otro lugar donde el cupo se muerde **sin** abrir Historial.

#### Qué está mal hoy (código)

**Actualizado 2026-09-04:** la lista de Historial y el detalle de turno en celu **ya no** bajan colecciones enteras (ver `docs/FIRESTORE_DT07_DT08.md`). Lo que sigue abierto está en §10 de ese doc (cache/↻, detalle de un proveedor, `refreshRemoteData`).

Texto original del diagnóstico 2026-08-24 (para no perder el problema que se acordó):

**Lista de Historial** (celu `adminHistory.ts` `fetchAdminShifts` + `fetchAdminSalesForShift`; PC remota `fetchHistoryShiftsFromFirestore`): `getDocs` de **todas** las `sales` (y turnos, gastos, pedidos, deudas) y filtro **en memoria**. Pedir “el martes” igual baja enero–agosto.

**Detalle de un turno en PC** (`fetchHistoryShiftDetailFromFirestore`): ya hace `query(..., where('shiftId', '==', shiftId))`. Comentario en código: no baja la colección entera, a diferencia de la lista. Ese es el patrón correcto.

**Detalle de un turno en celu** (`fetchAdminSalesForShift`): todavía `getDocs` de **toda** `sales` y después `shiftId`. Peor que el detalle de PC.

Misma familia: fiados/eventos de cliente y gastos si se listan enteros. DT-07 cubre `providerDebtEvents`.

#### Qué hay que hacer

1. **Historial de ventas (celu y PC remota):** **hecho.** Lista de turnos por **fecha y local** (query a `shifts` acotada, default 7 días). Al abrir un turno: `where shiftId == ese`. Totales de la lista por `shiftId in (...)`, no bajando `sales` entero.
2. **Cache + ↻ barato** (criterio “imposible a mano”): **pendiente.** El detalle ya visto no se vuelve a bajar al navegar; el botón Actualizar tiene intervalo mínimo o solo pega deltas. Sin esto, un mash de ↻ sobre un turno grande todavía puede acercarse al cupo.
3. **DT-07** en la misma oleada: **hecho en código** (checkpoint + job + no copiar el ledger entero al encender). Backfill de `createdAtServer` pendiente de `--apply`.
4. **Historial para cajeras** (idea de producto, no implementada): sí se puede — “los días que yo trabajé” / un día concreto. **Obligatorio** el mismo recorte por turno o fecha (~100–200 lecturas). Prohibido clonar el Historial admin actual (`getDocs` de todo). Admin y cajera el mismo día: con query por turno, suma chica; con “traer todo”, cada uno paga el archivo completo.
5. **DT-05** (`daily_summaries`): para “¿cómo nos fue en marzo?” sin pintar 6.000 tickets. **No borra** ventas. No arregla el `getDocs` de Firestore. SQLite local, prioridad baja, cuando el `.sqlite` pese o las sumas anden lentas.
6. **No compactar destruyendo.** A los 3 meses el detalle del ticket sigue existiendo por si hace falta. Lo que no se hace es **bajarlo** hasta que alguien pida ese día. El celu no es el archivo (DT-07): no cachear historial largo en el teléfono.
7. **Mensaje de cuota agotada** (secundario): si Spark cortó, decirlo en español; no sustituye (1)–(3).

#### Relación entre DTs

| Ítem | Qué resuelve | Qué no |
|---|---|---|
| DT-05 | Sumas lentas / tamaño SQLite a años | Lecturas Firestore del Historial |
| DT-07 | Ledger proveedores pedido entero + RAM celu + listener PC | `sales` |
| DT-08 (este) | Historial de ventas / principio general de queries | Compactar SQLite |

#### Prioridad y cuándo

Media. Código de recortes + checkpoint **hecho 2026-09-04** (`docs/FIRESTORE_DT07_DT08.md`). Falta el paso a producción (índices, backfill, deploy). El 80 % del producto (caja, catálogo, ABM chico) **ya escala**. Lo que queda de DT-08 es palanca 2 (cache/↻) y el detalle de un ledger individual a escala.

---

### FEAT-SPECIAL-POS-SELECTOR-01: Aplicar precios especiales desde el POS (código vivo, UI oculta — 2026-08-27)

La lógica existe: header del Área de Venta, desplegable “Precio de lista” / nombre del cliente; al escanear o Manual, `specialPriceByProductId` sustituye el de catálogo (`CashierScreen` + `ScanInput` / `barcodeItem`).

**Producto acordado:** los clientes especiales son **consulta**. La cajera mira Menú → Clientes especiales y controla que el ticket tenga esos precios; el POS no cambia el precio de lista solo.

**Qué se hizo:** no se borró el código. Flag `SHOW_SPECIAL_CUSTOMER_POS_SELECTOR = false` en `apps/desktop/src/routes/CashierScreen.tsx`. Poner `true` restaura el desplegable y el auto-apply.

No implementar otra idea de “consulta en caja” hasta que el desarrollador lo pida.

### FEAT-ORDER-CART-01: Pedido con presupuesto + cobro en POS (hecho 2026-09-02; Pedidos PC testeado 2026-09-04)

El Cobrar inyecta el carrito en el POS. `budgetItems` es el presupuesto; las cantidades reales se tipear al cobrar. Checklist de lista PC: `CHECKLIST_TESTEO_PEDIDOS_LISTA.md`. **Alcance v1: solo PC.** Celu después.

#### Al crear el pedido

- Sigue nombre, teléfono, fecha, seña, notas.
- Además, un **carrito de presupuesto**: producto del catálogo + kg o unidades **aproximados**. Total estimado en vivo (precio de lista de ese momento).
- Esos kg/u. **no** son la venta. El cliente puede decir “2 kg de asado”; al preparar puede pesar más o menos.

#### Al retirar (cajera, turno abierto)

1. Menú → Pedidos → buscar (nombre / qué pidió) → **Cobrar**.
2. **Modal de pesos:** líneas precargadas, cantidades **vacías**, placeholder del estimado. Se pueden sacar líneas. **Solo tipeo** (sin escaneo de balanza en ese modal).
3. Confirmar → el **POS** queda con el carrito ya armado (precios, total). En **Total de la venta** se descuenta la seña. Se pueden agregar más ítems (escaneo / Manual) como una venta normal.
4. Precio al cobrar = **lista al momento del retiro** (el estimado era orientativo).
5. **Siempre hay venta** con los kilos reales. Si la seña cubre el total → $0 a cobrar ahora (la seña ya entró al crear el pedido).
6. **Cancelar el carrito del pedido:** no hay venta; el pedido sigue pendiente, como si no se hubiera tocado Cobrar.
7. Sin turno abierto y hay resto → pedir abrir turno. No cobrar un pedido ya entregado.
8. ~~Sacar “Marcar listo” (desktop) cuando se implemente este flujo.~~ **Anulado (2026-09-02):** “Marcar listo” se conserva. Los carniceros lo usan desde el celular; la cajera lo ve en PC para cobrar. Ver FEAT-BUTCHER-01.

#### Seña de más

Si al retirar saca productos y el total queda **bajo** la seña: **no** se devuelve sola (la seña reserva). Caso excepcional (merma, culpa del local): la cajera registra un **Gasto** de devolución a mano. No hace falta un flujo extra en Cobrar.

### FEAT-PAYROLL-01: Pago de sueldo en caja + archivo semanal (1.0 — hecho 2026-08-25)

Pedido en testeo de Liquidación. Implementado: UI de pago en PC, nota opcional, snapshot de vales, consulta de semanas anteriores. **No** hay campo de ajuste de monto (el neto es siempre sueldo − vales; la nota explica recortes humanos).

#### Qué hay

1. **Registrar el pago** (cajera o admin con turno abierto): Menú caja → Liquidación, **solo la semana en curso** (lun–dom). ← consulta archivo: **no** se puede pagar una semana anterior. Un pago por carnicero por semana. Si ya está pagado: conflicto. Si se olvidó hasta el lunes, esa semana queda sin pago en el archivo (no hay “pago atrasado” en la app).
2. **El pago es el archivo.** 1 documento `salaryPayments/{id}` por carnicero por semana. Congela sueldo, vales, neto, nota opcional y lista de vales al pagar.
3. **Consulta:** PC y celu navegan semanas. Si hay cierre, se muestra ese archivo (no se recalcula). Query `weekStart ==` / recorte de vales — no `getDocs` de toda la colección.
4. **Nota opcional** (máx. 200): ej. “Le pagué menos porque esa semana llegó tarde 2 veces”. No cambia el neto en caja.

Spark: ~4 carniceros × 52 semanas ≈ 200 docs/año.

#### UX-FLICKER-01 — parpadeo al cambiar de semana (hecho 2026-08-25)

**Causa:** al cambiar `weekStart`, el primer frame de React sigue con `vales`/`payments` de la semana anterior. Se filtran a la semana nueva → no matchean → tarjetas chicas (sin lista de vales). Milisegundos después llega la caché o el fetch y las tarjetas crecen. No se nota en semanas sin vales (mismo alto). El mismo patrón (pintar una clave de pantalla con datos de otra) es el sospechoso en otras listas de la app; no se tocó el resto.

**Solución (reaplicable):** `resolveWeekView` en `apps/mobile/src/lib/payrollWeekCache.ts`. Si `dataWeekStart !== weekStart`, usar la caché de esa semana o `waiting: true` (spinner, no tarjetas vacías). No mezclar el filtro de la pantalla con datos de otra clave.

#### Fuera de 1.0

- Campo de ajuste que cambia el neto (monto aparte de la nota).
- Regla automática “tarde = $X”.
- Pagar desde el admin móvil (el celu solo consulta el archivo).
- Recalcular un cierre viejo si cambia el sueldo o se anula un vale.
- **Aguinaldo** (`FEAT-PAYROLL-02`): no está modelado. Queda pendiente; no mezclar con el sueldo semanal hasta que el desarrollador lo pida.
- Pago de una semana ya cerrada (atraso / caja flaca): no se permite. Si hace falta, es otra tarea.

### FEAT-CASH-INJECT-01: Aporte de efectivo a caja (hecho 2026-08-28)

Caso raro: llega un proveedor, la cajera no tiene efectivo suficiente, los admins le mandan plata para saldar. El gasto/saldar proveedor **resta** caja; el aporte es el movimiento inverso.

**Producto:** registrar un ingreso de efectivo al turno (monto + nota, ej. “ingreso admin para proveedor X”). `expenses.kind = 'inject'`. Suma al efectivo esperado en vivo. No es un gasto ni un vale. Misma idea en PC (sidebar Ingreso) y celu.

Parte del pack de emergencia del celu: `FEAT-MOB-EMERGENCY-01`.

### FEAT-MOB-EMERGENCY-01: Qué es “suficiente” en el POS del celular (hecho 2026-08-28)

El celu **no** es un segundo POS completo. Es el respaldo cuando la PC no está (corte de luz, PC rota). Si clonáramos todo, la PC dejaría de ser la caja del día y aparecerían dos fuentes de verdad + DT-06 (turno compartido en vivo).

**Criterio:** en emergencia hay que **seguir vendiendo y no perder la plata**. Lo que no mueve caja ni cierra una venta puede esperar a que vuelva la PC.

| En el celu (pack emergencia) | No en el celu (quedan en PC) |
| --- | --- |
| Abrir/cerrar turno, cobro, venta (scan + manual) | Clientes especiales / conteo / asistencia / pedidos |
| Efectivo esperado en vivo | Catálogo / balanza / precios |
| Gastos **con proveedor** (lista + deuda de este local) | Saldar dedicado / deuda cross-local |
| Ingreso de efectivo (`FEAT-CASH-INJECT-01`) | |
| Ventas de **este** turno (anular si hace falta) | |
| **Fiado en el cobro** (cliente + seña opcional) | |
| **Vales y liquidación** (caja del celu; DT-06) | |

**Fiado:** no se puede colgar “después” sobre la misma venta. En PC el fiado es un botón en Cobrar: la venta nace `isDebt` y el ledger apunta a esa venta del turno activo. Si en el celu se cobra como venta normal, `CREATE_DEBT` no la convierte luego (tiene que ser del turno abierto y no estar ya confirmada como no-fiado de otro flujo). Papel + cargar el fiado cuando vuelve la PC = la deuda existe, pero **no es la misma venta** y el momento del corte no queda atado al cliente. Por eso el fiado **sí** entra al pack de emergencia.

Historial largo y proveedores en celu = admin (ya existe), no el POS de cajera.

**Turno celu no se ve “en vivo” en el POS de PC:** no es un bug de esta pasada. Es **DT-06** (turno compartido). Hoy el celu sube a Firestore y la PC **importa** con `source='mobile'`, pero ese turno **no** es la caja activa del escritorio. Workaround: cerrar en el celu y abrir otro en la PC (quedan dos turnos en historial). Unificar en vivo = fase S2, no mezclar con el testeo.

Implementado en POS móvil: gastos con proveedor (lista + deuda de este local), ingreso de efectivo, ventas del turno con anular, fiado en el cobro, **vales y liquidación de la semana en curso**. El celu no clona saldar dedicado, deuda cross-local, pedidos ni catálogo. Vales/sueldo del celu quedan en el turno `source=mobile` (DT-06).

---

### FEAT-BUTCHER-01: Cuenta de carnicero — solo celu (implementado 2026-09-02)

**Track B (PC):** columnas `readyAt/readyBy/readyByName/budgetItems` en `orders`. Botón Listo con auditoría. Cobrar → inyecta carrito en POS (sin venta ficticia). Seña como crédito.

**Track A (empleados):** columna `employees.firebaseUid`. IPC `GRANT_BUTCHER_ACCESS` / `REVOKE_BUTCHER_ACCESS`. La UI viva es **Empleados** (`StaffScreen`): Dar acceso / Revocar en la ficha del carnicero. `EmployeesScreen` no está en el menú. Desktop rechaza login de carnicero. Helper `tenantAuth.ts` compartido.

**Shell móvil:**
- `ButcherApp.tsx`: selector de local (persiste en localStorage), pedidos pending del local agrupados por día/turno, botón Listo (solo con red).
- "Mi semana": sueldo + vales + neto semana en curso. Sin historial de semanas anteriores.
- `butcherOrders.ts` / `butcherPayroll.ts`: queries filtradas por `employeeId`/`storeId` (no baja colecciones enteras).

**Fuera de alcance:** UI carnicero en PC, historial de sueldos carnicero, asignar pedido a carnicero, carrito de pedidos en celu, stock.

**Reglas Firestore:** los permisos `request.auth != null` existentes cubren al carnicero. Restricción fina (update solo `pending→ready`) se aplica en el código de la app; no requiere `get()` por request.

---

### FEAT-CASH-HANDOVER-01: Entrega del cambio (billetes) entre turnos — **pendiente, antes de v1.0** (acordado 2026-09-07)

Hoy el cierre de PC ya deja anotar cuántos billetes de cada valor quedan en la registradora (`bill_denominations`) y calcula el total. Ese desglose **no se muestra** al abrir el turno siguiente: la apertura solo pide un monto suelto (`openingCash`). En el local eso sigue en la hoja del día. El celu ni cuenta billetes al cerrar ni al abrir.

**Producto:** el “cambio” que deja una cajera es lo que ve (y puede corregir) la que abre. La corrección **no reescribe** el cierre anterior.

#### Ciclo (mismo local)

1. Cierre: conteo de billetes que **quedan en la registradora** (no lo entregado / caja fuerte). Filas vacías permitidas. El total de esa grilla es lo dejado.
2. Apertura del turno siguiente (puede ser la misma persona): misma grilla **precargada** con lo que declaró la anterior. El `openingCash` es el total calculado de esa grilla (editable).
3. Si coinciden los billetes, confirma sin tocar. Si no, corrige cantidades. Eso es “lo que encontré”, no un parche al cierre de la otra.
4. Auditoría conserva **las dos versiones**: lo que la que cerró dijo que dejaba vs lo que la que abrió dijo que encontró (quién, cuándo, diferencia). La de la mañana puede demostrar lo que ella guardó aunque la de la tarde mienta o cuente mal (y al revés).

Fuente del precargado: último turno **cerrado de ese local** (no tiene que ser “ayer”; cubre mañana→tarde, tarde→mañana, mismo día o después de un domingo cerrado).

#### Cierre: conteo obligatorio, cero con confirmación

En **producción** no se salta el paso de billetes. Cerrar con **todas las filas en 0** (caja vacía) es un caso raro pero válido: no bloquear; pedir un modal (“¿Confirmás que no queda ningún billete en caja?”). Un skip accidental es difícil; un vacío deliberado (se entregó todo) sigue posible.

En **`APP_ENV=dev`** se puede omitir el conteo para no frenar pruebas (mismo espíritu que el bypass de login).

#### Alcance v1.0: PC **y** POS de emergencia del celu

Misma grilla al cerrar y al abrir en ambos. Si una cierra en celu y la otra abre en PC (o al revés), el desglose tiene que estar en Firestore: hoy `bill_denominations` es **solo SQLite** y `shiftSync` no lo sube. Hay que persistir el desglose en el doc del turno (array chico, ~10 denominaciones; no es una colección que crece — DT-08 no aplica como ledger).

DT-06 (un turno vivo en PC+celu a la vez) **no** es este FEAT. Acá el relevo es **cierre → apertura del siguiente**.

#### Datos (al implementar)

- El cierre ya escrito **no se updatea** cuando la siguiente corrige.
- El turno que **abre** guarda su propio conteo de apertura (distinto del de cierre del anterior).
- Historial admin: en el turno cerrado, “dejó”; en el que abre, “encontró”; si no calzan, la diferencia visible.
- Denominaciones vigentes las de cierre actuales (`CloseShiftScreen`: 20000…10). No hace falta el de $5.000.

#### Fuera de este FEAT

- No mezclar con DT-02 / DT-03 / DT-06.
- No cambiar el flujo de “monto entregado / caja fuerte” del arqueo; el cambio es solo lo que queda en la registradora.
- No es stock (Fase 8).

**Cuándo implementar:** cuando el desarrollador lo pida; queda **antes de v1.0**. No codear hasta entonces.

---

### FEAT-AUTH-PASSWORD-01: Cambio de contraseña por el usuario + mail en español — **pendiente, antes de v1.0** (acordado 2026-09-07)

Hoy no hay forma de que cajera, admin o carnicero **cambien su contraseña**. El alta manda `sendPasswordResetEmail` (definir la primera vez). El mail de Firebase está en **inglés genérico**.

**Producto:**
- Cada usuario lo hace **por su cuenta**, no el admin. Admin no resetea ni ve la clave.
- Login (PC y celu): enlace **¿Olvidaste tu contraseña?** → mail de restablecer (mismo `sendPasswordResetEmail` que el alta).
- Ya logueado: cambiar clave (pide la actual + la nueva). `updatePassword` de Firebase Auth exige login reciente; si no, reautenticar o mandar al flujo de mail.
- El mail: asunto y cuerpo en español, con el nombre del negocio desde `business.json` (no hardcodear marca en código). El HTML/textos de plantilla de Auth **no viven en el repo**: se editan en Firebase Console → Authentication → Templates (Password reset). El remitente en Spark sigue siendo el de Firebase (`noreply@…firebaseapp.com`); SMTP propio / dominio = Blaze, fuera de este FEAT salvo que se pida.

**Cuándo implementar:** cuando el desarrollador lo pida; queda **antes de v1.0**. No codear hasta entonces.
