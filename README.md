# carniceria-app

App de gestión integral para carnicerías. Offline-first, construida sobre Electron + React + TypeScript + SQLite/Drizzle.

## Propósito

- **Instancia inicial**: Arimark (cliente familiar del desarrollador).
- **Producto comercializable**: la misma base de código, personalizable por cliente via `config/business.json`. Ningún nombre de cliente está hardcodeado en el código fuente.

## Stack

| Capa | Tecnología |
|---|---|
| Desktop | Electron |
| Frontend | React + TypeScript + Vite |
| Estilos | Tailwind CSS |
| Base de datos | SQLite + Drizzle ORM (`better-sqlite3`) |
| Validación | Zod (runtime IPC) |
| Testing | Vitest |
| Balanza | `serialport` (protocolo R30, KRETZ REPORT NX) |
| Licencias | Firebase Firestore + Firebase Authentication |
| Almacenamiento seguro | `electron.safeStorage` |
| Build | electron-builder (NSIS, Windows) |
| Gestor de paquetes | **pnpm** (obligatorio) |

## Reglas innegociables

Ver [`AGENTS.md`](./AGENTS.md) para el conjunto completo de reglas que gobiernan este proyecto.

## Modos de operación

| Modo | `APP_ENV` | Base de datos | Hardware | Firebase | Login bypass |
|---|---|---|---|---|---|
| Pruebas / desarrollo | `dev` | `userData/dev/app.sqlite` | Mock o real según `KRETZ_PORT` | Desactivado | Disponible |
| Producción | `production` | `userData/app.sqlite` | Real | Activo | No disponible |

**Los datos de pruebas nunca se mezclan con producción.**

En modo `dev`, si se define `KRETZ_PORT=COM8`, se usa el driver real de la balanza. Si no está definido, se usa el mock. Esto permite usar el mismo entorno de pruebas tanto en la PC de desarrollo (sin balanza) como en la carnicería (con balanza real).

## Configuración por cliente

Copiar `apps/desktop/config/business.example.json` a `apps/desktop/config/business.json` e ingresar los datos reales del cliente:

```json
{
  "business_name": "Nombre del negocio",
  "license_key": "...",
  "timezone": "America/Argentina/Buenos_Aires",
  "default_store_id": "...",
  "logo_path": "",
  "theme": {},
  "inactivityThresholdHours": 2
}
```

`apps/desktop/config/business.json` **no se versiona** (está en `.gitignore`). En el instalador `.exe` se empaqueta automáticamente en `resources/business.json`.

## Comandos

```bash
pnpm install          # instalar dependencias
pnpm dev              # modo pruebas con mock de balanza (desarrollo local)
pnpm dev:hw           # modo pruebas con balanza real en COM8 (carnicería)
pnpm dev:prod         # modo producción desde fuente (requiere business.json y Firebase)
pnpm build:prod       # compilar instalador de producción (.exe)
pnpm test             # ejecutar suite completa
pnpm test:coverage    # suite + reporte de cobertura
pnpm db:generate      # generar migraciones desde schema.ts
pnpm seed:dev         # poblar DB de dev con datos de prueba (cajeras, productos)
```

## Build de producción (instalador `.exe`)

Ver [`apps/desktop/BUILD-PRODUCCION.md`](./apps/desktop/BUILD-PRODUCCION.md) para el protocolo completo: prerrequisitos (`business.json`, `.env.production`, Firebase), comando `pnpm build:prod`, diferencias con `pnpm dev`, ubicación de logs y verificación post-build.

## Onboarding al local real

Ver la sección "Checklist de primer deploy" en [`PLAN.md`](./PLAN.md) antes de instalar en la PC del cliente.

## Arquitectura

```
electron/
  main.ts              ← proceso main (único acceso a hardware y Firebase)
  preload.ts           ← expone window.hw al renderer
  db/                  ← cliente SQLite, schema, migraciones, backups
  hardware/
    kretz/             ← driver balanza KRETZ (protocolo R30)
  licensing/           ← Firebase Auth, verificación de licencia, sesiones
  ipc/                 ← handlers IPC tipados con validación zod

src/
  main.tsx             ← entry del renderer
  App.tsx
  routes/              ← páginas
  components/          ← componentes UI
  lib/                 ← utilidades (datetime, format)
  types/
    hw-api.ts          ← tipos compartidos main↔renderer (window.hw)

config/
  business.example.json

drizzle/               ← migraciones SQL versionadas
```
