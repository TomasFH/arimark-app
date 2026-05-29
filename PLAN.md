# Plan de desarrollo — App de gestión para carnicerías

## Resumen ejecutivo

Construir una app de gestión integral para carnicerías sobre **Electron + React + TS + Vite + Tailwind + SQLite/Drizzle**, offline-first, con licencias en Firebase, hardware periférico (balanza KRETZ + caja SAM4S) y dashboard web remoto. El código base es agnóstico al cliente: el primer despliegue es Arimark, pero todos los nombres/colores/logos vienen de configuración, no del código.

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
- **`@napi-rs/keyring`** para el password de la caja SAM4S (accesible desde Credential Manager de Windows si el técnico necesita inspeccionarlo).
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

- La tabla local `users` mantiene a las **cajeras** (login local con bcrypt).
- Los **admins** se autentican exclusivamente con Firebase Auth. En la PC del local, un flujo de "login admin" valida contra Firebase Auth y crea una sesión local efímera. Cero passwords de admin en local.
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
- `electron/hardware/fiscal/__mocks__/fiscalDriver.ts` — modos via `FISCAL_MOCK_MODE`: `normal`, `timeout`, `http_error`, `malformed_response`, `disconnect`.
- En sandbox: mocks automáticos. En tests: se importan directamente. En producción: no incluidos en el bundle (`afterPack` lo verifica).

**Testing de DB en memoria**

- `electron/db/__tests__/helpers/inMemoryDb.ts` — instancia `:memory:` con migraciones aplicadas. Usado en todos los tests que tocan DB.
- Tests de transacciones complejas obligatorios antes de cerrar cada fase:
  - Fase 2: venta multi-pago, rollback si la caja falla a mitad de la transacción.
  - Fase 3: cierre de jornada con diferencia de caja, cierre a ciegas.
  - Fase 4: ledger de deudas — saldo algebraico, imposibilidad de sobreescritura, cobro cruzado entre locales.

---

## Diagrama de arquitectura

```
Renderer React
  └── window.hw (preload IPC tipado)
        └── Electron Main
              ├── Handlers IPC + zod
              ├── SQLite + Drizzle ORM
              ├── Firebase (licencias + sync)
              ├── KRETZ serial (balanza)
              └── SAM4S HTTP (caja fiscal)
```

---

## Roadmap por fases

### ✅ Fase 0 — Bootstrap, licencias y sesiones (COMPLETA)
Tag: `fase0-complete` | Commit: `935959f` | Tests: 90 en verde

Entregado:
- Stack completo: Electron + React + TS + Vite + Tailwind + Drizzle + Vitest + pnpm
- DB: schema 22 tablas, migración `0000`, runner con backup previo y rollback
- Seguridad: `safeStorage`, `@napi-rs/keyring`, sandbox/producción separados, `afterPack`
- Config por cliente: `business.json` con loader Zod tipado
- Licencias: `signInAnonymously`, activación con código único, ventana 48h offline, sesiones por rol
- Login UI: pantallas de activación, licencia inválida, cajera y admin
- Datetime: capa UTC con helpers de presentación por timezone
- Hardware: interfaces + mocks con modos de fallo inyectables (KRETZ y SAM4S)
- `electron-updater`: auto-check periódico, instalación solo fuera de turno activo
- Firestore rules: `installations/{uid}`, sesiones y activity_log con permisos estrictos

---

### 🔜 Fase 1 — Hardware real: KRETZ + SAM4S

**Objetivo:** pasar de mocks a drivers reales; cablear hardware al proceso main; exponer IPC de tickets y pagos.

**Bloqueante documentado:** el modo de emergencia con escaneo de tickets de balanza **no se implementa** hasta haber inspeccionado empíricamente el código de barras/QR del ticket de la KRETZ RPF US30P2CAR con la configuración de código por producto activa. El agente se detiene y solicita esos datos si llega a ese punto.

Entregables:
1. `electron/hardware/kretz/kretzDriver.ts` — driver real via `serialport`, protocolo R30, parseo de `ScaleTicketData`, eventos `ticket`/`connected`/`disconnected`/`error`.
2. `electron/hardware/fiscal/fiscalDriver.ts` — driver real via HTTP contra SAM4S NR-330F, credenciales desde `secureStorage`, `processPayment` + `issueCashReceipt`.
3. Hardware manager en main — sandbox usa mocks, producción usa drivers reales; gestiona conexión, reconexión y actualiza `setHardwareStatus()`.
4. IPC nuevos (con zod + tests):
   - Suscripción/emisión de tickets de balanza al renderer.
   - Procesamiento de pagos fiscales.
   - Configuración de puerto serial / IP de hardware.
5. Tests: los cuatro modos de fallo de KRETZ (`timeout`, `garbage`, `disconnect`, `malformed_response`) implementados y testeados. (SAM4S ya los tiene.)

Criterio de cierre: `pnpm run test` 100% verde, cobertura ≥ 80%, build de prod limpio, commit + tag `fase1-complete`.

---

### Fase 2 — Ventas (POS)

- Cola FIFO de `scale_tickets` en pantalla de cajera.
- Cobros combinados (efectivo + débito + billetera).
- Ventas manuales con aprobación admin.
- Test obligatorio: venta multi-pago, rollback si la caja falla a mitad de transacción.

### Fase 3 — Cierre de jornada y gastos

- Apertura de turno con cambio inicial.
- Registro de gastos durante jornada.
- Cierre con conteo de billetes, cierre a ciegas opcional.
- Diferencia de caja automática.
- Test obligatorio: cierre con diferencia de caja, cierre a ciegas.

### Fase 4 — Clientes especiales y deudas

- ABM de clientes (restaurant, mayorista, otros).
- Precios especiales por cliente.
- Modelo de ledger en `debt_events` — nunca sobreescritura, saldo algebraico.
- Cobro cruzado entre locales sin duplicados.
- Test obligatorio: ledger completo con pagos parciales y cobros cruzados.

### Fase 5 — Pedidos y panel admin

- ABM de pedidos con estado (pendiente / listo / entregado / cancelado).
- Panel admin: catálogo de productos, precios, historial, reportes por turno/período.
- `pending_fiscal_payments`: cobros digitales fuera de horario registrados por admin, confirmados por cajera.

### Fase 6 — Stock ⚠️ BLOQUEADA

**No codificar hasta que el desarrollador confirme haber tenido la charla con el carnicero titular sobre el manejo de ingreso de mercadería.** La estructura de `stock_entries` existe en el schema pero el flujo operativo está pendiente de definición.

### Fase 7 — Empleados, vales y asistencia

- ABM de empleados con rol (`butcher`, `cashier`, `other`).
- Registro de vales/adelantos contra salario semanal.
- Registro de asistencia con estados y justificaciones.

### Fase 8 — Dashboard remoto y emergencia móvil

- Dashboard web en Firebase (React, misma base de código o mini-app separada).
- Vista en tiempo real de ventas del día, turno activo, totales por medio de pago.
- Modo emergencia: hoja de barcodes plastificada como fallback inicial para escaneo de tickets KRETZ (implementar solo cuando haya datos empíricos del ticket).

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

- **Firebase**: Firestore y Authentication activos. Reglas de Firestore deployadas (versión con `installations/{uid}`). Proyecto real de producción, no el emulador.
- **Licencia generada**: documento `licenses/{license_key}` en Firestore con `activo: true`. `license_key` anotado.
- **Código de activación de un solo uso**: generado y guardado. Se entrega al cliente junto con la `license_key`. Una vez usado, no sirve más.
- **`business.json` preparado** con: `business_name`, `timezone`, `logo_path`, `license_key`, `default_store_id` (UUID generado previamente), `theme`.
- **Instalador `.exe` compilado** con `APP_ENV=production`. Probado en una PC limpia (sin Node, sin el proyecto en disco). Verificado que el banner de sandbox **no** aparece.
- **Build de producción verificado**: `afterPack` no encontró artefactos de sandbox ni tokens de Cloudflare Tunnel.
- **Driver JDATAGATE** de KRETZ descargado (compatible con RPF US30P2CAR). En USB o carpeta accesible.
- **Credenciales SAM4S** a mano: IP, usuario y contraseña HTTP Basic Auth.
- **Suite de tests en verde al 100%** antes de compilar el instalador final.

### 2. Pasos de instalación en la PC del local

Ejecutar en este orden. No saltear pasos.

1. Verificar red local: ping a la IP de la SAM4S. Si falla, resolver antes de continuar.
2. Instalar driver JDATAGATE de KRETZ. Reiniciar si lo pide. Verificar en Administrador de dispositivos que el puerto aparece.
3. Copiar `business.json` a la ruta que la app espera antes de abrirla por primera vez.
4. Ejecutar el instalador `.exe`. Aceptar UAC si aparece.
5. Primera apertura: ingresar `license_key` y código de activación. Verificar que la respuesta de Firebase es exitosa y que la pantalla avanza al login.
6. Configurar credenciales SAM4S desde panel admin. Verificar con "Probar conexión".
7. Crear el primer local desde panel admin (usar el UUID de `default_store_id`).
8. Crear la primera cajera con contraseña provisoria.
9. Conectar la balanza por USB-B. Verificar indicador de hardware en la app.

### 3. Verificación antes de dejar al cliente solo

No retirarse sin completar este circuito:

- **Venta de punta a punta**: carnicero pesa → cajera ve ticket → confirma → cobro → venta en historial.
- **Venta digital**: débito o billetera, SAM4S responde, `fiscal_receipt_issued` correcto.
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
