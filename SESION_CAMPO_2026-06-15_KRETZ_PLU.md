# Sesión de campo — 15/06/2026 — Comunicación KRETZ y gestión de PLUs

Pruebas realizadas en la carnicería con balanza **KRETZ REPORT NX** conectada por USB (COM8).
Esta sesión cerró el flujo de **crear y actualizar PLUs desde la app** vía protocolo R30, replicando
lo que hace iTegra pero con la UI de arimark-app.

Leer este documento antes de tocar `electron/hardware/kretz/` o `PluManagerPanel.tsx`.

Documento relacionado (sesión anterior, contexto general): `SESION_CAMPO_2026-06-07.md`.

---

## Resumen ejecutivo

| Objetivo | Estado |
|----------|--------|
| Conectar balanza por USB (COM8 @ 115200) | ✅ Funciona |
| Probar enlace R30 (`0002`) | ✅ Funciona |
| Leer PLU existente (`5005`) | ✅ Funciona (con búsqueda por número real) |
| Crear/actualizar PLU (`2005`) | ✅ Funciona (formato compatible iTegra) |
| Precios ≥ $10.000 (ej. $15.000, $21.000) | ✅ Funciona |

---

## Cómo arrancar para probar PLUs

```bash
pnpm dev:fieldtest
```

Requisitos:
- Balanza enchufada por USB → **COM8** (verificar en Administrador de dispositivos).
- **Cerrar iTegra** y cualquier otra app que use COM8 antes de probar.
- Login admin en la app → DevTools → pestaña **PLUs**.

Variables de entorno relevantes (ya vienen en el script `dev:fieldtest`):

```
APP_ENV=fieldtest
KRETZ_PORT=COM8
```

---

## Arquitectura implementada

```
PluManagerPanel (renderer)
    ↓ window.hw.kretzSendPlu / kretzReadPlu / …
preload.ts
    ↓ IPC tipado
kretzPlu.handler.ts (validación Zod)
    ↓
HardwareManager
    ↓
kretzDriver.ts (cola serial, polling activo)
    ↓
r30Protocol.ts (encode/decode tramas R30)
    ↓
COM8 @ 115200 baud
```

Archivos clave:
- `electron/hardware/kretz/r30Protocol.ts` — protocolo R30, build/parse PLU
- `electron/hardware/kretz/kretzDriver.ts` — driver serial con cola de comandos
- `electron/ipc/kretzPlu.handler.ts` — handlers IPC
- `src/components/PluManagerPanel.tsx` — UI de gestión de PLUs

---

## Protocolo R30 — comunicación con la balanza

### Modelo master-slave (polling)

La REPORT NX **no emite datos espontáneamente** por USB. La PC debe **preguntar** (polling).
Serial Port Monitor sin tráfico no significa que la balanza esté rota: hay que enviar comandos.

Referencia: mini-app `herramienta-arimark` (peso en vivo con comando `1524`).

### Parámetros de conexión confirmados

| Parámetro | Valor |
|-----------|-------|
| Puerto | COM8 (USB Serial Port) |
| Baud rate | 115200 |
| Formato | 8N1 |
| Protocolo | R30 (tramas STX/ETX + checksum) |

### Comandos R30 usados

| Comando | Función |
|---------|---------|
| `0002` | Test de enlace (sin sonido) |
| `1524` | Estado en vivo (peso, precio en pantalla) |
| `2005` | Alta / modificación de PLU |
| `3005` | Baja de PLU |
| `5001` | Cantidad de registros PLU (entidad `05`) |
| `5005` | Lectura de un PLU |

### Formato de trama (PC → balanza)

```
STX (0x02) + "C01" + cmd(4) + datos + checksum(2 ASCII) + ETX (0x04)
```

### Códigos de respuesta relevantes

| Código | Significado | Cuándo lo vimos |
|--------|-------------|-----------------|
| `01` | OK | Enlace, lectura y escritura exitosos |
| `11` | Error de longitud de datos | Payload con bytes incorrectos (138 vs 135) |
| `20` | Registro inexistente | PLU no encontrado |
| `21` | Error de datos del registro | Payload con longitud OK pero campos inválidos |
| `40` | Tabla vacía / sin registros | Posición interna sin PLU |

Fuente: documento **Protocolo de comunicación Kretz R30** (Multiprotocolo REPORT NX).

---

## Problemas encontrados y soluciones — comunicación

### 1. Puerto abierto pero “sin conexión” en test de enlace

**Síntoma:** Pestaña Hardware mostraba verde (puerto COM8 abierto), pero “Verificar conexión”
en PLUs decía que no había enlace.

**Causa:** `parseResponse()` exigía mínimo 8 caracteres internos. La respuesta de `0002` tiene
exactamente 7 (sin campo datos) y se descartaba como “trama inválida”.

**Solución:** Cambiar mínimo de `inner.length < 8` a `inner.length < 7` en `r30Protocol.ts`.

---

### 2. Solo un programa puede usar COM8

**Síntoma:** iTegra o la mini-app abiertas → la app no recibe respuestas.

**Solución operativa:** Cerrar iTegra antes de usar arimark-app. No es bug de código.

---

### 3. Cola de comandos serial

**Problema:** Enviar comandos en paralelo corrompe la comunicación.

**Solución:** `kretzDriver.ts` encola transacciones (`_queue`) — nunca dos comandos simultáneos.

---

## Problemas encontrados y soluciones — lectura de PLUs (`5005`)

### 4. Buscar “PLU 1” devolvía el PLU 5 (único existente)

**Síntoma:** En la balanza solo existía PLU 5 (“Vacío x2”). Al buscar PLU 1, 2 o 3, la app
mostraba el PLU 5. Al buscar PLU 6, correctamente decía “no encontrado”.

**Causa inicial (incorrecta):** Se asumió que `5005` usa índice 0-based del número de PLU
(usuario escribe 1 → se envía posición 0). Eso lee la **posición interna 0**, no el PLU cuyo
número es 1.

**Solución definitiva:** `readPlu()` escanea posiciones `0 … count-1`, parsea cada registro y
**filtra por el campo `number` del PLU** (6 dígitos en la respuesta). Solo devuelve resultado si
el número real coincide.

**Log de referencia (PLU 5 en posición 0):**
```
5005 data: '000005001000Vacio x2...00005P00000002100000000000000010000000000000000000000010000000010000000'
dataLength: 135
priceField @ offset 77: '210000'
```

Interpretación del registro leído:
- Número PLU: `000005` → **5**
- Departamento: `001`
- Familia: `000` ← importante para escritura
- Nombre: `Vacio x2`
- Código artículo: `00005`
- Tipo: `P` (pesable)
- Precio raw: `210000` → **$21.000,0** en pantalla

---

### 5. Conteo de PLUs mal parseado

**Síntoma:** Respuesta `05010000` se interpretaba como miles de PLUs.

**Causa:** Se tomaban demasiados dígitos del tail.

**Solución:** Parsear bytes 2–4 de la respuesta → `01` = **1 PLU** almacenado.

---

## Problemas encontrados y soluciones — creación/actualización de PLUs (`2005`)

Esta fue la parte más difícil. Varios intentos fallaron con códigos `11` y `21` antes de
replicar exactamente el formato que iTegra escribe en la balanza.

### 6. Error `11` — longitud de datos incorrecta

**Síntoma:** Al enviar precios altos ($15.000), la balanza respondía `11`.

**Hipótesis incorrecta inicial:** “La balanza necesita payload de 138 bytes (7 dígitos de precio).”

**Evidencia empírica que la refutó:**
- iTegra creó PLU de $21.000 exitosamente.
- Lectura `5005` del PLU creado por iTegra: **`dataLength: 135`** (no 138).
- Precio almacenado: `210000` (6 caracteres, no 7).

**Conclusión:** En REPORT NX con visor LCD, el campo precio tiene **6 dígitos**, no 7.
El manual R30 lo confirma: *“Report Nx: en modelos con visor LCD el número de dígitos de los
valores de precios es 6 y no 7”*.

**Payload total comando `2005`:** **135 bytes** (modo iTegra compatible).

Enviar 138 bytes → siempre `11`.

---

### 7. Escala de precio — pesos × 10, no pesos × 100

**Síntoma:** Usuario ingresa $10.000 → balanza muestra $100,00.

**Causa:** Se multiplicaba por 100 (asumiendo 2 decimales implícitos tipo centavos).

**Formato real en REPORT NX LCD:**
- Campo precio: **6 dígitos**
- **1 decimal implícito** (no 2)
- Conversión: `precio_raw = pesos_enteros × 10`

| Precio en UI | priceField enviado | Pantalla balanza |
|--------------|-------------------|------------------|
| $6.000 | `060000` | $6.000,0 |
| $15.000 | `150000` | $15.000,0 |
| $21.000 | `210000` | $21.000,0 |

La pantalla muestra un solo decimal cuando el entero ocupa 5 dígitos (`21000,0`) porque el
display tiene capacidad limitada de caracteres (~7 posiciones visibles).

**Código:** `PluManagerPanel.tsx` → `priceCents = precioEnPesos * 10` (nombre legacy del campo;
semánticamente es “precio raw”, no centavos).

---

### 8. Error `21` — datos del registro inválidos (longitud OK)

**Síntoma:** Tras corregir longitud (135 bytes) y escala (×10), seguía fallando con `21`:
```
payloadBytes: 135, priceField: '150000', decimalField: '000001' → code: '21'
```

**Causas encontradas (tres campos incorrectos):**

#### 8a. Campo “precio anterior” = posición del punto decimal

En el protocolo R30, el tercer campo de precio (antes “precio anterior”, ahora obsoleto como precio)
almacena la **posición del punto decimal**:

| Valor | Efecto |
|-------|--------|
| `000000` | Usa decimales de la moneda configurada |
| `000001` | **1 decimal implícito** ← lo que usa iTegra |
| `000002` | 0 decimales implícitos |

iTegra guarda `000001` en el PLU de $21.000. Nosotros enviábamos `000000`.

**Solución:** En `buildPlu2005Data()`, el campo `priceOld` se setea a `'000001'` cuando
`priceDigits === 6`.

#### 8b. Familia incorrecta

PLU creado por iTegra: departamento `001`, **familia `000`**.

Nosotros enviábamos familia `001`. Si iTegra borró/restauró tablas auxiliares, familia `001`
puede no existir → error `21`.

**Solución:** Default `family: '000'` en panel e IPC handler.

#### 8c. Código de artículo vacío

PLU de iTegra: código artículo `00005` (= número de PLU en 5 dígitos).

Nosotros enviábamos `00000` si el campo UI estaba vacío.

**Solución:** Si el usuario no ingresa código, usar el número de PLU:
`articleCode = pluNumber.padStart(5, '0')`.

---

### 9. Payload final correcto (ejemplo PLU 6, $15.000)

Estructura según manual R30 comando `2005` (135 bytes en LCD):

```
000006          ← número PLU (6 díg.)
001             ← departamento
000             ← familia
Asado x2        ← nombre (26 chars, padded)
Asado x2        ← descripción (26 chars)
00006           ← código artículo (5 díg.)
P               ← tipo pesable
0000000         ← valor fijo
150000          ← precio (6 díg., pesos×10)
000000          ← precio alternativo
000001          ← posición decimal (1 decimal implícito)
000000          ← impuesto 1
000000          ← impuesto 2
00000           ← tara preempaque
00000           ← tara publicada
01              ← código etiqueta
0000            ← código receta
0000            ← código nutrición
0               ← fecha envase
000             ← vencimiento
0000            ← código imagen
```

**Log de éxito esperado:**
```
[kretz] → 2005 (sendPlu) { payloadBytes: 135, priceField: '150000', decimalField: '000001' }
[kretz] ← 2005 { code: '01', meaning: 'OK' }
```

---

## Borrado de PLUs (`3005`)

**Actualización 15/06/2026:** se implementó borrado individual de PLUs desde la app.

El comando R30 para baja de PLU es `3005` y recibe solo el número de PLU en 6 dígitos:

```
PLU 6 -> payload "000006"
```

Ruta implementada:

```
PluManagerPanel -> window.hw.kretzDeletePlu -> IPC KRETZ_DELETE_PLU
  -> HardwareManager.kretzDeletePlu -> KretzRealDriver.deletePlu -> comando 3005
```

La UI solo muestra la acción de borrado después de encontrar un PLU real y pide confirmación
explícita con número y nombre del producto antes de enviar el comando. La confirmación debe ser
un modal React dentro de la app, **nunca** `window.confirm()` ni ventanas nativas del sistema:
en Electron/Windows esas ventanas rompen el foco y obligan a volver con Win+Tab.

Después del borrado actualiza el conteo con `5001` y limpia el resultado de búsqueda/formulario
si correspondía.

**Log de éxito esperado:**
```
[kretz] → { cmd: '3005', data: '000006' }
[kretz] ← { code: '01', meaning: 'OK', data: '' }
```

---

## iTegra — lecciones aprendidas

1. **iTegra puede borrar PLUs existentes** al sincronizar si se tilda “borrar lo actual”.
   No es requisito técnico del protocolo, pero explica por qué desaparecieron PLUs de prueba.

2. iTegra es la **referencia de verdad** para el formato binario/ASCII del payload `2005`.
   Cuando algo falla con `21`, leer un PLU creado por iTegra con `5005` y comparar byte a byte.

3. El checkbox de borrado en iTegra **no es necesario** para crear PLUs individuales desde
   arimark-app. El comando `2005` hace alta si no existe y modificación si ya existe.

---

## Registro externo de comprobantes

Decisión posterior: la app no interactúa con la registradora. Las cajeras la operan manualmente
como se viene haciendo, y la app registra solo la venta y sus medios de pago para gestión interna.

---

## UI — PluManagerPanel

Ubicación: DevTools → pestaña **PLUs** (solo fieldtest/sandbox, admin).

Funciones:
- Verificar enlace R30
- Buscar PLU por número con fallback robusto:
  1. intenta `5005` por número real documentado (`PLU 6` -> `000006`);
  2. intenta la posición empírica 0-based (`PLU 6` -> `000005`);
  3. escanea las posiciones conocidas por `5001` y filtra por el número real del registro.
- Crear / actualizar PLU
- Borrar PLU con modal interno de confirmación (sin ventanas nativas del sistema)
- Mostrar “Precio raw (diagnóstico)” al leer

Selector “Formato de precio”:
- **iTegra compatible: 135 bytes** — usar siempre (default)
- 138 bytes — solo diagnóstico; la balanza actual rechaza con `11`

---

## Tests

Suite completa verde antes del commit de alta/edición de PLUs:
```bash
pnpm run test   # 201 + 19 tests
```

Verificación posterior al borrado de PLUs:
```bash
pnpm run build:main
pnpm run build:renderer
pnpm exec vitest run electron/hardware/kretz/__tests__/r30Protocol.test.ts electron/ipc/__tests__/kretzPlu.handler.test.ts
```

Resultado esperado de tests puntuales tras borrado:
```
41 passed
```

Tests específicos KRETZ:
- `electron/hardware/kretz/__tests__/r30Protocol.test.ts` — incluye test de payload iTegra
  (`210000` + `000001`)
- `electron/ipc/__tests__/kretzPlu.handler.test.ts` — incluye handler `kretz-delete-plu`

---

## Pendientes / no resuelto en esta sesión

| Tema | Estado |
|------|--------|
| Peso en vivo (`1524`) integrado en UI de ventas | Implementado en driver, no en flujo de venta |
| Ventas por escaneo EAN-13 | Sigue siendo estrategia paralela (ver sesión 07/06) |
| Sincronización masiva de PLUs (volcado completo tipo iTegra) | No implementado |
| Borrado de PLU (`3005`) desde la app | Implementado |

---

## Checklist para próxima sesión de prueba

- [ ] Cerrar iTegra antes de abrir arimark-app
- [ ] Verificar COM8 en Administrador de dispositivos
- [ ] `pnpm dev:fieldtest`
- [ ] DevTools → PLUs → “Verificar conexión” → debe decir R30 OK
- [ ] Buscar PLU existente por número real (no por posición)
- [ ] Crear PLU de prueba con precio > $10.000
- [ ] Confirmar en pantalla de balanza que el precio coincide
- [ ] Revisar terminal: `payloadBytes: 135`, `code: '01'`
