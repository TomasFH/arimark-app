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
| Balanza | `serialport` (protocolo R30, KRETZ RPF US30P2CAR) |
| Caja registradora | HTTP (`node:http`, SAM4S NR-330F) |
| Licencias | Firebase Firestore + Firebase Authentication |
| Almacenamiento seguro | `electron.safeStorage` + `@napi-rs/keyring` |
| Build | electron-builder (NSIS, Windows) |
| Gestor de paquetes | **pnpm** (obligatorio) |

## Reglas innegociables

Ver [`AGENTS.md`](./AGENTS.md) para el conjunto completo de reglas que gobiernan este proyecto.

## Modos de operación

| Modo | `APP_ENV` | Base de datos | Hardware | Firebase |
|---|---|---|---|---|
| Sandbox / desarrollo | `sandbox` | `userData/sandbox/app.sqlite` | Mocks | Desactivado |
| Producción | `production` | `userData/app.sqlite` | Real | Activo |

**Los datos de sandbox nunca se mezclan con producción.**

## Configuración por cliente

Copiar `config/business.example.json` a `config/business.json` e ingresar los datos reales del cliente:

```json
{
  "business_name": "Nombre del negocio",
  "license_key": "...",
  "timezone": "America/Argentina/Buenos_Aires",
  "default_store_id": "...",
  "logo_path": "",
  "theme": {}
}
```

`config/business.json` **no se versiona** (está en `.gitignore`).

## Comandos

```bash
pnpm install          # instalar dependencias
pnpm dev:sandbox      # iniciar en modo sandbox
pnpm dev:prod         # iniciar en modo producción (requiere business.json y Firebase)
pnpm build:prod       # compilar instalador de producción
pnpm test             # ejecutar suite completa
pnpm test:coverage    # suite + reporte de cobertura
pnpm db:generate      # generar migraciones desde schema.ts
```

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
    fiscal/            ← driver caja SAM4S (HTTP)
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
