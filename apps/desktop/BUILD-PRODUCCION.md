# Build de producción — instalador `.exe`

Guía para compilar el instalador Windows (NSIS) que se entrega al cliente, en contraste con el desarrollo local con `pnpm dev`.

---

## Desarrollo (`pnpm dev`) vs instalador (`.exe`)

| Aspecto | `pnpm dev` / `pnpm dev:hw` | Instalador `.exe` (`pnpm build:prod`) |
|---|---|---|
| Comando | `pnpm dev` desde la raíz del monorepo | `pnpm build:prod` desde la raíz |
| `APP_ENV` | `dev` | `production` |
| Base de datos | `%APPDATA%/@carniceria/desktop/dev/app.sqlite` | `%APPDATA%/@carniceria/desktop/app.sqlite` |
| Firebase / licencias | Desactivado | Activo — login obligatorio |
| Banner "MODO PRUEBAS" | Visible | **No aparece** |
| Botón "Saltar login" | Disponible | **No existe** |
| Balanza KRETZ | Mock (sin `KRETZ_PORT`) o real (`pnpm dev:hw`) | Driver real; puerto configurado desde el panel admin |
| `business.json` | `apps/desktop/config/business.json` | Empaquetado en `{instalación}/resources/business.json` |
| Variables Firebase (`VITE_FIREBASE_*`) | No requeridas en dev | Inyectadas en el **build** desde `.env.production` |
| Consola / terminal | Se abre junto a Electron en dev | **No hay consola** — logs solo en archivo |
| Logs | Consola + `%APPDATA%/…/logs/` | `%APPDATA%/@carniceria/desktop/logs/` |
| Actualizaciones auto | No | `electron-updater` (cuando esté cableado) |

**Los datos de dev y producción nunca se mezclan.** Una PC puede tener ambas bases en carpetas distintas bajo `userData/`.

---

## Prerrequisitos antes de compilar

Ejecutar **desde la raíz del monorepo** (`carniceria-app/`):

1. **Suite de tests en verde**
   ```bash
   pnpm test
   ```

2. **`apps/desktop/config/business.json`** — copiar del template y completar con datos reales del cliente:
   ```bash
   cp apps/desktop/config/business.example.json apps/desktop/config/business.json
   ```
   Campos obligatorios:

   | Campo | Descripción |
   |---|---|
   | `business_name` | Nombre visible en la UI |
   | `license_key` | Clave de licencia en Firestore (`licenses/{key}`) |
   | `default_store_id` | UUID del local principal (FK en SQLite) |
   | `timezone` | Zona horaria IANA (default: `America/Argentina/Buenos_Aires`) |
   | `inactivityThresholdHours` | Horas sin ventas antes del aviso de cierre automático de turno (default: `2`, rango: 0.5–24) |
   | `logo_path` | Ruta al logo (opcional, vacío si no hay) |
   | `theme` | Colores `primary` / `accent` (opcional) |

   Este archivo **no se versiona** (está en `.gitignore`). El instalador lo empaqueta automáticamente vía `extraResources` de electron-builder.

3. **`.env.production`** en la raíz del monorepo con las claves del proyecto Firebase de producción:
   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_STORAGE_BUCKET=...
   VITE_FIREBASE_MESSAGING_SENDER_ID=...
   VITE_FIREBASE_APP_ID=...
   ```
   Las variables `VITE_*` se **incrustan en el bundle del renderer en tiempo de build**. No se pueden cambiar editando un archivo después de instalar: hay que recompilar el instalador.

4. **Firebase listo**: Firestore + Authentication activos, reglas de seguridad deployadas (incluido acceso de admins a `licenses/{key}/users/{userId}`), licencia y cuentas de usuario creadas.

5. **Migraciones de DB** incluidas en el paquete (`drizzle/` se copia al instalador). Se aplican automáticamente en el primer arranque.

---

## Compilar el instalador

Desde la raíz del monorepo:

```bash
pnpm build:prod
```

El script ejecuta, en orden:
1. `tsc` — compila el proceso main de Electron (`dist-electron/`)
2. `vite build` — compila el renderer React (`dist/`)
3. `electron-builder` — genera el instalador NSIS con `APP_ENV=production`

**Salida:** `apps/desktop/release/Carniceria App Setup X.X.X.exe`

El hook `afterPack` verifica que el build no contenga artefactos de desarrollo (mocks, tokens de Cloudflare Tunnel, etc.). Si encuentra alguno, **el build falla**.

---

## Instalación en la PC del cliente

1. Instalar driver JDATAGATE de KRETZ si se va a usar la balanza (solo gestión de PLUs).
2. Ejecutar el `.exe`. Aceptar UAC si aparece.
3. Primera apertura:
   - Se crea `%APPDATA%/@carniceria/desktop/app.sqlite` con las migraciones.
   - Se crea el local por defecto en SQLite a partir de `default_store_id` de `business.json`.
   - Aparece la pantalla de login **sin** banner amarillo ni bypass.
4. Login con credenciales Firebase Auth (admin o cajera).
5. Cajera: abrir turno → operar → cerrar caja al finalizar la jornada.

No hace falta copiar `business.json` manualmente post-instalación si se compiló con el archivo presente en `apps/desktop/config/`.

---

## Comportamientos de producción relevantes

### Cierre de turno

- **Manual:** botón "Cerrar caja" en la pantalla de caja → arqueo → logout.
- **Automático por inactividad:** si no hubo ventas en `inactivityThresholdHours` horas, aparece un modal con countdown de 5 minutos. Sin respuesta → cierre silencioso del turno y logout.
- **Cierre inesperado de la app** (X, Alt+F4, corte de luz): el turno **permanece abierto** en SQLite. La cajera lo retoma al volver a loguearse.

### Logs

En producción no hay salida en consola. Para diagnosticar problemas:

```
%APPDATA%/@carniceria/desktop/logs/main.log
```

Los mensajes `debug` y `warn` (p. ej. reconexión de balanza sin puerto configurado) van al archivo pero no a la consola.

### Configuración post-instalación

| Qué | ¿Editable sin recompilar? | Dónde |
|---|---|---|
| `inactivityThresholdHours` | Sí — editar `resources/business.json` y reiniciar la app | `{Program Files}/Carniceria App/resources/business.json` |
| Credenciales Firebase | **No** — requiere recompilar con `.env.production` actualizado | — |
| Puerto serial KRETZ | Sí — desde el panel admin de la app | Guardado en `safeStorage` |
| Datos operativos (ventas, turnos) | Sí — son locales en SQLite | `%APPDATA%/…/app.sqlite` |

---

## Verificación post-build (antes de entregar al cliente)

- [ ] Instalar el `.exe` en una PC **sin Node.js** ni el repo en disco.
- [ ] Confirmar que **no** aparece el banner "MODO PRUEBAS".
- [ ] Confirmar que **no** existe el botón "Saltar login".
- [ ] Login admin y cajera contra Firebase Auth real.
- [ ] Abrir turno → registrar una venta → cerrar caja con arqueo.
- [ ] Verificar que `%APPDATA%/…/logs/main.log` registra eventos.
- [ ] Verificar que `%APPDATA%/…/backups/` contiene backup post-migración.

Ver también el **Checklist de primer deploy** en [`PLAN.md`](../../PLAN.md).

---

## Modo intermedio: `pnpm dev:prod`

Permite probar el flujo de producción **desde fuente** (con hot reload de Vite) sin compilar el instalador:

```bash
pnpm dev:prod
```

Requiere `business.json` y `.env.production` igual que el build. Usa `APP_ENV=production` pero la base de datos sigue siendo la de **dev** (`userData/dev/app.sqlite`) porque el ejecutable no está empaquetado — útil para probar login Firebase y licencias sin generar el `.exe`.

**No usar `dev:prod` para operación real del cliente.** Solo para validación pre-build.
