# Sesión de campo — 07/06/2026

Pruebas realizadas en la carnicería (ubicación real del hardware). Esta sesión fue la primera vez que
la app corrió en `APP_ENV=fieldtest` contra el hardware real. Leer este documento antes de
continuar el desarrollo relacionado con hardware.

> **Actualización 15/06/2026:** El serial USB sí sirve para **gestión de PLUs** (comandos R30 `2005`/`5005`).
> Ver documentación completa en `SESION_CAMPO_2026-06-15_KRETZ_PLU.md`.

---

## Estado de la app al inicio de la sesión

- **Entorno:** `fieldtest` (drivers reales, BD separada, sin Firebase, sin banner de sandbox)
- **Comando de inicio:** `pnpm dev:fieldtest` con `KRETZ_PORT` configurado.
- **DB fieldtest:** `C:\Users\User\AppData\Roaming\carniceria-app\fieldtest\app.sqlite`
- **Inicio correcto:** log `[main] Iniciando app { version: '0.1.0', env: 'fieldtest' }`

### Cómo arrancar la app en fieldtest

Correr en PowerShell desde la raíz del proyecto:

```powershell
$env:Path = "C:\Windows\System32;C:\Windows;C:\Windows\System32\Wbem;C:\Program Files\nodejs;C:\Users\User\AppData\Roaming\npm;" + $env:Path
$env:KRETZ_PORT = "COM8"
pnpm dev:fieldtest
```

---

## KRETZ REPORT NX — estado y hallazgos

### Conexión
- **Puerto:** COM8 (USB Serial Port — aparece en el Administrador de dispositivos al enchufar el USB)
- **Baud rate:** 115200
- **Configurado en:** `KRETZ_PORT=COM8` como variable de entorno (o desde el panel DevTools de la app)
- **Reconexión automática:** el driver reintenta con backoff exponencial; si la balanza no está
  enchufada, reintenta cada 5 → 10 → 20 → 30 segundos hasta conectar. No hace falta reiniciar la app.

### Puerto serial — lo que sabemos empíricamente
El puerto COM8 **abre correctamente** (log `[kretz] Puerto serial abierto { port: 'COM8' }`),
pero **nunca emite datos de ventas en tiempo real**. Se confirmó con Serial Port Monitor externo
y con el log de diagnóstico de bytes crudos en `kretzDriver.ts`. La razón:

- El modelo presente es **KRETZ REPORT NX** (no RPF US30P2CAR como se asumía al diseñar el R30 parser).
- En el REPORT NX el puerto USB/Serial es **solo para programación** (configuración de PLUs,
  parametrización, volcado de datos). No transmite ventas en tiempo real.
- La transmisión de ventas en tiempo real ("Ticket Online") requiere la variante NX con
  **Ethernet/WiFi**, que este equipo no tiene.

### Estrategia de integración adoptada: EAN-13 por escaneo
Dado que el serial no sirve para ventas, se adoptó la estrategia de **código de barras en el ticket**:

1. La KRETZ imprime un ticket con código EAN-13 al cerrar cada venta.
2. Un lector de código de barras conectado a la PC escanea ese código.
3. La app decodifica el EAN-13 para extraer PLU, peso y precio.

**Formato EAN-13 confirmado empíricamente:**
```
[ prefijo 2 dígitos ][ PLU 4 dígitos ][ peso/unidades 6 dígitos ][ dígito verificador 1 ]
```

**Limitación crítica conocida:** La KRETZ REPORT NX **no imprime el código de barras si el
precio del ítem es ≥ $1.000**. En ventas de carnicería con precios altos esto es un problema serio.
Para esos casos no hay integración automática con la app.

**Otra limitación:** Si el precio se ingresa manualmente en la balanza (sin usar PLU), el código
generado tiene `PLU=0000`, con lo que la app no puede identificar el producto.

### Estado del driver en el código
`electron/hardware/kretz/kretzDriver.ts` implementa el driver serial para el REPORT NX.
El parser `r30Parser.ts` existe pero **es incorrecto para este modelo** — fue diseñado para el
protocolo R30 del RPF US30P2CAR. Queda pendiente rediseñar el flujo de integración basado
en el escaneo del EAN-13 (ver sección de pendientes al final).

---

## Registro de ventas externas — decisión posterior

Después de esta sesión se decidió que la app no interactúa con la registradora. Las cajeras
continúan operándola manualmente como parte del flujo actual del negocio. La app solo registra
la venta y el medio de pago para gestión interna.

---

## Estado del proceso de la app al finalizar la sesión

- La app arranca y carga la pantalla de login correctamente
- Login con `cajera1` funciona
- La KRETZ aparece conectada en el DevTools panel
- El simulador de pedidos ("Simulador" tab) solo está disponible en `sandbox`, no en `fieldtest`.
  Para poder probar el flujo de cobro sin hardware de escaneo real, hay que habilitarlo en `fieldtest`.

---

## Pendientes técnicos derivados de esta sesión

| # | Área | Tarea | Bloqueante |
|---|------|-------|-----------|
| 1 | KRETZ | Rediseñar flujo de integración: EAN-13 por lector USB, no serial de la balanza | — |
| 2 | KRETZ | Definir qué hacer con ventas ≥ $1.000 (sin código de barras en ticket) | Decisión del desarrollador |
| 3 | UI | Habilitar simulador de pedidos en `fieldtest` para poder probar cobros sin lector físico | — |
| 4 | Script | Documentar en README el proceso de arranque en `fieldtest` con variables de entorno | — |

---

## Notas adicionales

- El `r30Parser.ts` puede quedar en el repo como referencia, pero debe marcarse como
  **no usado en producción** hasta tanto no haya un modelo de balanza que use ese protocolo.
- La regla del AGENTS.md que dice *"no implementar modo de emergencia con escaneo de tickets
  de balanza hasta haber inspeccionado empíricamente el código de barras"* se puede considerar
  **cumplida**: el formato EAN-13 fue verificado in-situ y está documentado arriba.
- El campo `business.json` no existe en la instalación fieldtest; la app cae a config ficticia de campo
  (log: `[businessConfig] business.json no encontrado — usando config ficticia de campo`). Esto es
  comportamiento esperado y no es un error.
