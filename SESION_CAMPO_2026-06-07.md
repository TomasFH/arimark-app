# Sesión de campo — 07/06/2026

Pruebas realizadas en la carnicería (ubicación real del hardware). Esta sesión fue la primera vez que
la app corrió en `APP_ENV=fieldtest` contra el hardware real. Leer este documento antes de
continuar el desarrollo relacionado con hardware.

---

## Estado de la app al inicio de la sesión

- **Entorno:** `fieldtest` (drivers reales, BD separada, sin Firebase, sin banner de sandbox)
- **Comando de inicio:** requiere setear variables de entorno manualmente antes de `pnpm dev:fieldtest`
  porque `cross-env` en el script pisaba los valores. Se corrigió el script eliminando los
  `SAM4S_IP=`, `SAM4S_USER=`, `SAM4S_PASSWORD=` vacíos del `dev:fieldtest` en `package.json`.
- **DB fieldtest:** `C:\Users\User\AppData\Roaming\carniceria-app\fieldtest\app.sqlite`
- **Inicio correcto:** log `[main] Iniciando app { version: '0.1.0', env: 'fieldtest' }`

### Cómo arrancar la app en fieldtest con credenciales de la SAM4S

Correr en PowerShell desde la raíz del proyecto:

```powershell
$env:Path = "C:\Windows\System32;C:\Windows;C:\Windows\System32\Wbem;C:\Program Files\nodejs;C:\Users\User\AppData\Roaming\npm;" + $env:Path
$env:SAM4S_IP       = "192.168.1.1"
$env:SAM4S_USER     = "user"
$env:SAM4S_PASSWORD = "<contraseña — ver keyring>"
pnpm dev:fieldtest
```

> **NUNCA** poner la contraseña en texto plano en ningún archivo commiteado.
> La contraseña es el Número de Registro del equipo SAM4S (todo en mayúsculas).

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

## SAM4S NR-330F — estado y hallazgos críticos

### Datos del equipo (leídos desde el web panel)
- **Firmware:** Versión 1.02
- **ID / Nº de Registro:** SESHRA0000051752
- **Punto de venta:** 00003
- **Fecha de Fiscalización:** 04/06/2026
- **Estado Fiscal:** Normal
- **Último cierre diario:** 0005 / 3650 (07/06/2026)
- **¿Jornada abierta?:** NO
- **¿Documento abierto?:** NO
- **IP:** 192.168.1.1 (estática, default de fábrica)
- **Máscara:** 255.255.255.0
- **Puerta de enlace:** 0.0.0.0

### Conexión física
- La SAM4S se conecta directamente a la PC mediante un cable Ethernet cruzado (o switch).
- La PC necesita IP estática en el adaptador Ethernet: `192.168.1.10`, máscara `255.255.255.0`.
- Verificar conectividad con `ping 192.168.1.1` antes de arrancar la app.

### Web panel — lo que expone
Accesible en `http://192.168.1.1/` con credenciales `USER` / `<Nº de Registro en mayúsculas>`.
El menú izquierdo contiene:
- **Estado** — info del contribuyente y estado fiscal
- **Operaciones Fiscales:** Certificados Digitales, Baja Fiscal, Cambio de Datos, Descarga de Datos
- **Configuración:** General, Impresora, Comunicación
- **Diagnóstico**

**No existe ninguna sección de ventas, transacciones ni API REST.**

### HALLAZGO CRÍTICO — el driver HTTP actual NO SIRVE para ventas

El `FiscalRealDriver` en `electron/hardware/fiscal/fiscalDriver.ts` intenta hacer:
- `GET /api/status` → respondió HTTP 200 ✓ (es la página de Estado del web panel)
- `POST /api/payment` → **no existe**
- `POST /api/receipt` → **no existe**

Estos endpoints fueron inventados siguiendo convenciones REST estándar. El web server de la
SAM4S **no tiene ningún endpoint para registrar ventas**. Su único propósito es la gestión del
ciclo de vida fiscal (alta/baja, descarga de reportes para AFIP, configuración).

### Cómo se registran ventas programáticamente en la SAM4S NR-330F

Mediante el **protocolo HOST por puerto serial**. Los puertos seriales 1 y 2 (RJ45) aceptan
el tipo de dispositivo "HOST", que permite a un sistema externo enviar comandos para:
- Abrir un documento fiscal
- Registrar ítems (por departamento o PLU)
- Cerrar el documento especificando el medio de pago
- Obtener el número de comprobante

El puerto USB (puerto 3) también puede configurarse como "SERIAL PC" (115200 baud) para lo mismo.

### Lo que falta para poder integrar ventas con la SAM4S

1. **Conseguir el manual de protocolo HOST de la NR-330F** (documento técnico separado al
   manual de usuario). Pedirlo a SER S.A. (Sistemas Electrónicos de Registración S.A.,
   Loyola 554, CABA) o al distribuidor que instaló el equipo.
   Se llama típicamente *"Manual de Comunicación HOST"* o *"NR-330F Host Protocol Manual"*.

2. **Reimplementar `FiscalRealDriver`** usando serial (no HTTP):
   - Conectar por USB ("SERIAL PC") o por los puertos RJ45
   - Implementar los comandos HOST para abrir venta, agregar ítems, cerrar con medio de pago
   - La conexión HTTP puede mantenerse solo para verificar estado (`/` devuelve 200 si la
     caja está encendida y en red), pero NO para transacciones

3. **Rediseñar `fiscalDriver.interface.ts`** si el protocolo HOST requiere una firma diferente.

---

## Estado del proceso de la app al finalizar la sesión

- La app arranca y carga la pantalla de login correctamente
- Login con `cajera1` funciona
- La KRETZ y la SAM4S aparecen conectadas en el DevTools panel (aunque la conexión SAM4S
  solo verifica que el web panel responde, no que las ventas funcionan)
- El simulador de pedidos ("Simulador" tab) solo está disponible en `sandbox`, no en `fieldtest`.
  Para poder probar el flujo de cobro sin hardware de escaneo real, hay que habilitarlo en `fieldtest`.

---

## Pendientes técnicos derivados de esta sesión

| # | Área | Tarea | Bloqueante |
|---|------|-------|-----------|
| 1 | SAM4S | Conseguir manual de protocolo HOST NR-330F | Proveedor / SER S.A. |
| 2 | SAM4S | Reimplementar `FiscalRealDriver` con serial HOST en lugar de HTTP | Tarea #1 |
| 3 | SAM4S | Actualizar tests de `fiscalDriver.test.ts` para el nuevo protocolo | Tarea #2 |
| 4 | KRETZ | Rediseñar flujo de integración: EAN-13 por lector USB, no serial de la balanza | — |
| 5 | KRETZ | Definir qué hacer con ventas ≥ $1.000 (sin código de barras en ticket) | Decisión del desarrollador |
| 6 | UI | Habilitar simulador de pedidos en `fieldtest` para poder probar cobros sin lector físico | — |
| 7 | Script | Documentar en README el proceso de arranque en `fieldtest` con variables de entorno | — |

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
