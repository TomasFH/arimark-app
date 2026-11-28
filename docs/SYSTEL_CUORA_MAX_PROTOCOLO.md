# Systel Cuora Max — protocolo y plan de integración

Referencia para integrar la balanza **Systel Cuora Max** (modelo de la carnicería: **CM30MBXUF1**)
a arimark-app, en particular para **enviar PLUs** como ya se hace con las KRETZ REPORT NX.

Leer junto con `SESION_CAMPO_2026-06-15_KRETZ_PLU.md`: muchas lecciones se repiten.

Fuente oficial: ZIP **"Protocolo Cuora 2 y Cuora MAX"** descargado de
`soporte.systel-global.com/instructivos/` (sección Qendra – Cuora). Contiene:

| Archivo | Para qué sirve |
|---|---|
| `Protocolo de comunicaciones MAX CUORA V7.pdf` (jun 2022) | Firmware más nuevo. Referencia principal |
| `Protocolo de comunicaciones CUORA MAX V6.2 Rev 00.pdf` | Firmware intermedio |
| `Protocolo de comunicaciones CUORA MAX V6.0 Rev 06.pdf` | Firmware viejo (usa función 4 para PLUs) |
| `Protocolo de comunicaciones CUORA 2 V4.0 Rev 00.pdf` | Modelo anterior (Cuora 2), no aplica |
| `Prueba Protocolo Cuora W7 - VB/` | Ejemplo oficial en Visual Basic (`Form1.vb`) |

> PDF V6.0 en el repo: [docs/hardware/systel/](./hardware/systel/). Otros PDF del ZIP son referencia opcional.

> **Estado:** probado en campo el 28/11/2026 (ver sección 0). Donde la sección 0 contradice al
> resto del documento, **manda la sección 0**.

---

## 0. Resultados de campo — 28/11/2026 (Cuora Max CM30MBXUF1, Camarones/San Martín)

Probado con el programa oficial `Prueba Protocolo Cuora Systel.exe` del ZIP, sin la app.

| Prueba | Resultado |
|---|---|
| Puerto | `USB Serial Port (COM12)` en la PC del local, 115200 |
| Dirección | **20** funciona (la balanza responde como 20). La 0 no se probó |
| F2 firma | `F2000 C030000 S0060 P08000 A060 D0` → 30 kg, **protocolo 0060**, 8000 PLUs, 60 accesos directos, **0 decimales** |
| F39 config | `CPr=0`, `Sinc=0`, `PeP=3`, `E_P=20PPPPIIIIII`, `E_U=21PPPPIIIIII`, `E_S=22AAIIIIIIII`, encabezado de fábrica ("NOMBRE COMERCIO") |
| F11 sectores | De fábrica: 01 Fiambres y lácteos, **02 CARNICERIA**, 03 Verdulería, 04 Panadería, 05 Pescados/Mariscos, 06 Regalería y bazar, 07 Genéricos |
| F31 lista (vacía) | Respuesta `F` (sin PLUs) |
| F31 lista (con PLU 999) | Llega **en dos pedazos**: primero `N0999V1`, después el final `F…`. El programa de prueba solo muestra el último pedazo. **El driver tiene que juntar bytes hasta que cierre el XOR** |
| F63 | Respuesta con caracteres no imprimibles; no hizo falta (F2 ya da los decimales) |
| **F4** alta de PLU | `ACK`, nombre OK, pero **el precio lo interpreta con 2 decimales**: `015000` → **$150**. **No usar F4** |
| **F61** alta de PLU (layout V6.0) | `ACK`. `015000` → **$15.000/kg**, 0,500 kg → total $7.500. ✅ **Usar F61** |

### Payload F61 validado (155 caracteres, sin ingredientes)

Layout del PDF **V6.0** (PLU de 4 dígitos, código de 5), no el de V6.2/V7:

```
0999                ← número de PLU (4)
PRUEBA ARIMARK 001  ← nombre (18, rellenar con espacios)
015000              ← precio lista 1 (6, pesos enteros)
015000              ← precio lista 2 (6)
00999               ← código de PLU (5) → va al código de barras
02                  ← sector (02 = CARNICERIA)
0000                ← días de vencimiento
P                   ← tipo de venta (P pesable / U unitario)
0000                ← tara (gramos, 4)
0000                ← porcentaje de agua (4)
N                   ← tiene tabla nutricional
000…0 (30)          ← descripción de porción
000…0 (32)          ← 8 valores de tabla nutricional (4 c/u)
0000 0000 0000      ← origen / conservación / receta
000000000000        ← número de lote (12)
0                   ← tipo de EAN (0 = general de la balanza)
20PPPPIIIIII        ← formato EAN (12)
N                   ← tiene ingredientes
```

Trama de prueba completa (función 61, dirección 20):

```
0999PRUEBA ARIMARK 00101500001500000999020000P00000000N000000000000000000000000000000000000000000000000000000000000000000000000000000000000020PPPPIIIIIIN
```

> **Errata (28/11/2026):** ese renglón tiene **153** caracteres; el layout de campos de arriba suma **155**
> (faltan 2 ceros en el bloque de relleno entre `N` nutricional y el tipo EAN). **Implementación y tests:**
> armar el payload por offsets, no pegar este string. Ver también
> [SYSTEL_IMPLEMENTACION_HANDOFF.md](./SYSTEL_IMPLEMENTACION_HANDOFF.md).

### Conclusiones para el driver

- Elegir el formato por la **versión de protocolo de F2**: `0060` → F61 con layout V6.0 (155 bytes).
  Otras versiones → no escribir hasta validarlas en campo.
- Precio = **pesos enteros**, 6 dígitos (tope $999.999) cuando F2 dice `D0`.
- F61 con un número de PLU existente **lo pisa** (alta o modificación).
- El PLU 999 "PRUEBA ARIMARK 001" quedó cargado en la balanza a propósito (ver sección 7, punto 7).

---

## 1. Conexión

| Parámetro | Valor | Fuente |
|---|---|---|
| Puerto | USB → COM virtual (chip FTDI, VID `0403` / PID `6001`) | Driver de Systel + otro integrador |
| Velocidad | **115200** | `Form1.vb` línea 40 |
| Formato | 8N1, sin control de flujo | `Form1.vb` |
| Modelo | Maestro-esclavo: la PC pregunta, la balanza responde. **Nunca habla sola** | PDF V7 |
| Red (Ethernet/WiFi) | Módulo Lantronix que expone el mismo serial por TCP puerto `10001` (COM virtual con CPR Manager) | Guía de redes Cuora Max |

**Ojo:** las KRETZ también usan chip FTDI y también van a 115200. **Por VID/PID no se distingue
una Kretz de una Systel.** La detección automática tiene que identificar la marca preguntando con
el protocolo (ver sección 6).

Igual que con iTegra: **si Qendra está abierto, la app no puede usar el puerto.**

---

## 2. Formato de trama

Igual en los dos sentidos:

```
[Dirección 1 byte] [Función 1 byte] [Datos N bytes ASCII] [XOR 1 byte]
```

- **Dirección y función son bytes con el valor numérico**, no texto. Función 23 = byte `0x17`, no `"23"`.
- **XOR** = XOR de todos los bytes anteriores (dirección + función + datos).
- **No hay byte de fin de trama.** La trama termina cuando hay ~5 ms de silencio.
  Lección de otro integrador: en respuestas largas (lista de PLUs) la balanza hace pausas de
  ~250 ms en el medio. **No cortar por silencio si el XOR todavía no da bien**: seguir esperando
  hasta un timeout más largo.
- **Dirección:** el PDF dice que `0` es broadcast. En la práctica (otro integrador, USB) la unidad
  **solo contesta a la dirección 0** y responde identificándose como `20` (`0x14`), que es el ID
  configurado en la balanza (Menú → Administrador → 11 Configurar equipo → 3 Conectividad →
  1 Identificación). Empezar con `0`; si no contesta, barrer 0..99 con la función 23.
- Los textos van en Latin-1 y la balanza solo acepta un subconjunto de caracteres ("máscara del
  equipo"). Normalizar tildes y eñes antes de enviar (a verificar qué acepta).

Ejemplos de trama a dirección 0 (hex):

```
Ping (F23):            00 17 17
Peso (F1):             00 01 01
Firma digital (F2):    00 02 02
Lista de PLUs (F31):   00 1F 1F
Formato de moneda (F63): 00 3F 3F
Leer PLU 1 (F62):      00 3E 30 30 30 30 30 31 3F
```

### Respuestas de control

| Respuesta | Significado |
|---|---|
| `ACK` (3 letras) | Orden recibida y ejecutada |
| `I` y después `ACK` | Orden larga en proceso (cierre de ventas, borrar sector) |
| `E1` | XOR incorrecto |
| `E2` | Buffer de recepción lleno |
| `E3` | Se desatendieron datos |
| `E4` | Función desconocida / no válida **← así responde un firmware que no tiene esa función** |
| `E5` | Sobran o faltan datos (equivale al error `11` de Kretz) |
| `E6` | Dato fuera de límites (ej. precio muy grande) |
| `E7` | El dato pedido no existe (ej. PLU inexistente) |
| `E8` | Contenido inválido (equivale al error `21` de Kretz) |
| `E9` | Desborde de un acumulador de ventas |

---

## 3. Funciones útiles para la app

| Función | Qué hace | Riesgo |
|---|---|---|
| `1` | Peso + estable/inestable + tara (gramos, sin coma) | Solo lectura |
| `2` | Firma: tipo de producto, capacidad, versión de protocolo, cantidad de PLUs, **decimales de precio** | Solo lectura |
| `23` | Ping: estado `T` (actualizada), `D` (desactualizada), `S` (bloqueada esperando sincro) | Solo lectura |
| `28` | Fecha y hora | Solo lectura |
| `31` | Lista de todos los PLUs con su "versión" | Solo lectura |
| `39` | Configuración completa (incluye formato de códigos de barras) | Solo lectura |
| `62` | Leer un PLU completo | Solo lectura |
| `63` | Formato de precio (`0` = 6:0 sin decimales, `2` = 4:2) y moneda | Solo lectura |
| `61` | **Alta/modificación de PLU (firmware V6.2 y V7)** | Escribe |
| `4` | **Alta/modificación de PLU (firmware V6.0 y anteriores)** | Escribe |
| `33` | Cambiar solo los precios de un PLU (conserva los totales de ventas) | Escribe |
| `5` | Borrar un PLU (también borra su acceso directo) | Escribe |
| `10` | Crear/renombrar sector | Escribe |
| `64` | Cambiar formato de precio y moneda | **Cambia la configuración** |
| `16` | Poner fecha y hora | Escribe |
| `72` | Reporte de ventas ticket a ticket | Solo lectura (a futuro) |

**No usar desde la app sin una decisión explícita:**

- `9` (borrar sector): **borra también todos los PLUs de ese sector.**
- `32` (cierre de ventas): pone en cero los acumulados y el número de ticket.
- `26`: apaga la balanza.
- `35` con `S`: deja la balanza **bloqueada al encender** hasta que la PC mande la función `25`.
  Si la app no está abierta, nadie puede pesar.

### Dato útil: precios tocados a mano

La función `31` devuelve por cada PLU una "versión": `0` = creado en la balanza, `1` = gestionado
desde la PC, **`2` = modificado desde la balanza**. Con eso la app puede detectar si un carnicero
cambió un precio a mano. La función `40` también permite limitar los precios manuales, pero ojo:
podría romper el uso del "Precio especial" (PLU 998), así que no tocarla sin probar.

---

## 4. ⚠️ Trampa principal: precios de más de $9.999

Todos los campos de precio tienen **6 dígitos, sin coma**. Lo que significan depende del formato
configurado en la balanza (función `63`):

| Formato | Cómo se lee `021000` | Precio máximo |
|---|---|---|
| `2` = 4:2 (2 decimales, **probable config de fábrica**: la placa dice `$0,01`) | $210,00 | **$9.999,99** |
| `0` = 6:0 (sin decimales) | $21.000 | **$999.999** |

Los precios de la carnicería pasan los $10.000/kg, así que **la balanza tiene que estar en formato
6:0** y la app tiene que mandar **pesos enteros**. Es el mismo tipo de problema que el "× 10" de
la Kretz. Coincide con lo que reportan otros: Qendra viene limitado a $9.999,99 de fábrica, y otro
integrador manda los precios en "pesos enteros".

Pasar a 6:0 se hace con la función `64` (o desde Qendra/menú de la balanza). Es un cambio de
configuración que afecta la pantalla, los tickets y el código de barras, así que tiene que ser una
acción explícita, con confirmación y con el estado actual leído antes (`63`).

**Regla para el driver:** leer siempre el formato con `63` antes de escribir precios, y si con ese
formato el precio no entra, **no enviar** y avisar en la UI (no dejar que la balanza devuelva `E6`
ni que trunque).

---

## 5. Cargar un PLU: depende del firmware

La función para escribir PLUs **cambió entre versiones**:

| Firmware | Función | Largo de datos (sin ingredientes) | Con ingredientes |
|---|---|---|---|
| V6.0 y anteriores | `4` | 55 | 155 |
| V6.2 | `61` | 158 | 258 |
| V7 | `61` (con 5 listas de precio y más tabla nutricional) | 222 | 322 |

En V6.2 y V7 la función `4` figura como no usada (responde error). La firma (función `2`) trae la
versión de protocolo, pero **en los tres PDF el ejemplo dice "0040"** (copiado y pegado), así que no
es confiable para elegir el formato.

**Cómo elegir el formato (misma lección que con iTegra):** leer con `62` un PLU que ya exista
(creado por Qendra o desde la balanza), mirar el largo de la respuesta y compararlo con las tablas
de abajo. Ese PLU es la referencia de verdad. Si `62` responde `E4`, el firmware es V6.0 y se usa
la función `4`.

### 5a. Función 4 (V6.0) — verificado con el ejemplo oficial

| Campo | Largo | Valor |
|---|---|---|
| Número de PLU | 4 | `0001` … `8000` (posición en la balanza) |
| Versión | 1 | Quién lo gestiona (el ejemplo oficial manda `2`) |
| Nombre | 18 | Rellenar con espacios a la derecha |
| Precio lista 1 | 6 | Sin coma (ver sección 4) |
| Precio lista 2 | 6 | Sin coma |
| Código de PLU | 5 | `00001` … `99997` (el que va al código de barras) |
| Sector | 2 | `01` … `99` (tiene que existir) |
| Días de vencimiento | 4 | `0000` = sin vencimiento |
| Tipo de venta | 1 | `P` pesable / `U` unitario |
| Tara | 6 | Gramos, `000000` si no tiene |
| Mantener totales | 1 | `N` = nuevo (pone en cero lo vendido) / `M` = modificación (conserva totales) |
| Tiene ingredientes | 1 | `S` / `N` |
| Ingredientes | 100 | Solo si el campo anterior es `S` |

Vector de prueba sacado del ejemplo oficial (`Form1.vb`, botón "función 4"), sirve como test:

```
"0001" + "2" + "Activia Bebible Fr" + "000500" + "000500" + "00001" + "05" + "0000" + "U"
+ "000000" + "S" + "S" + <100 caracteres de ingredientes>   → 155 bytes de datos
```

(El ejemplo manda `S` en "mantener totales", aunque el PDF dice `N` o `M`. Usar `N`/`M`.)

### 5b. Función 61 (V6.2)

| Campo | Largo |
|---|---|
| Número de PLU | 6 |
| Nombre | 18 |
| Precio lista 1 | 6 |
| Precio lista 2 | 6 |
| Código de PLU | 6 |
| Sector | 2 |
| Días de vencimiento | 4 |
| Tipo de venta (`P`/`U`/`E` escurrido/`C` congelado) | 1 |
| Tara (gramos) | 4 |
| Porcentaje de agua × 100 | 4 |
| Tiene tabla nutricional (`S`/`N`) | 1 |
| Descripción de la porción | 30 |
| Tabla nutricional (8 valores de 4) | 32 |
| Origen / Conservación / Receta (índices) | 4 + 4 + 4 |
| Número de lote | 12 |
| Tipo de EAN (`0` general, `1` del PLU, `2` sin EAN, `3` suma) | 1 |
| Formato EAN (ej. `20PPPPIIIIII`) | 12 |
| Tiene ingredientes (`S`/`N`) | 1 |
| Ingredientes (solo si `S`) | 100 |

### 5c. Función 61 (V7)

Igual que V6.2 pero:
- Después del nombre van **5 listas**, cada una con precio (6) + "rango de precio" en gramos (6),
  donde `000000` = sin rango → 60 bytes en vez de 12.
- La tabla nutricional suma "porciones por envase" (4), "tamaño de porción" (4) y pasa de 8 a 10
  valores.

**A verificar en campo:**
- Si los campos de tabla nutricional se mandan igual (con ceros/espacios) cuando "tiene tabla" es `N`.
  El PDF solo aclara que los ingredientes se omiten si es `N`.
- La tabla de la función 61 dice "IP + Función + Datos" sin XOR. Casi seguro es un error del PDF
  (el ejemplo oficial siempre manda XOR), pero confirmarlo.

### Valores por defecto razonables para la carnicería

- Número de PLU = código de PLU (lo recomienda Systel para no confundirse).
- Sector: crear uno (`01`, ej. "CARNICERIA") con la función `10` antes del primer PLU.
- Vencimiento `0000`, tara `0000`, sin tabla nutricional, sin ingredientes.
- Tipo de EAN `0` (usar el formato general de la balanza).

---

## 6. Código de barras de las etiquetas/tickets

El POS de la app lee el código de barras de los tickets de balanza, así que esto importa.

- Formato de fábrica: **`20PPPPIIIIII`** + dígito verificador = `20` + código de PLU (4) + importe (6).
- Con código de PLU de 5 dígitos y el formato de fábrica, **la balanza no imprime el código de
  barras**. Usar códigos de hasta 4 dígitos o cambiar el formato.
- El importe tiene 6 dígitos con el mismo formato de precio: en 4:2 un ticket de más de
  $9.999,99 no entra. Otra razón para pasar a 6:0.
- El formato se lee con la función `39` (`E_P=`, `E_U=`, `E_S=`) y se cambia con la función `8`.
  Letras posibles: `P` código de PLU, `I` importe, `C` cantidad, `S` sección, `B` balanza,
  números fijos.

**Para el POS:** el parser del código de barras tiene que ser configurable por marca/balanza
(no asumir el formato de la Kretz).

---

## 7. Diseño para que la app sea vendible (multi-marca)

Objetivo: que un cliente nuevo pueda tener Kretz, Systel o una mezcla (Arimark tiene 6 balanzas)
sin tocar código.

1. **Interfaz común de balanza.** Un contrato tipo `ScaleDriver` con operaciones: conectar, ping,
   leer peso, leer PLU, listar PLUs, alta/modificación, cambiar precio, borrar. Cada marca declara
   qué soporta (capacidades). El `HardwareManager` y la UI hablan con el contrato, no con la marca.
   El código de Kretz pasa a ser un driver más (sin cambiar su comportamiento).
2. **Catálogo neutro.** La app guarda precios en pesos y nombres completos. Cada driver convierte:
   Kretz `× 10` en 6 dígitos; Systel según el formato leído con `63`. Cada driver declara también
   el largo máximo del nombre (Kretz 26, Systel 18) y la UI muestra cómo va a quedar cortado.
3. **Config por balanza, no hardcodeada.** Lista de balanzas por PC: marca, puerto (o "auto"),
   dirección, local. Nada de `COM8` ni marcas fijas en el código.
4. **Detección automática por protocolo.** Como las dos marcas usan FTDI a 115200, el sondeo
   pregunta con comandos de **solo lectura** de cada protocolo (Systel: ping `23`; Kretz: `0002`) y
   se queda con la marca que contesta con trama válida. Nunca mandar comandos de escritura durante
   el sondeo.
5. **Driver mock de Systel** para sandbox/dev, igual que existe para Kretz.
6. **Parser de códigos de barras configurable** por marca/balanza (sección 6).
7. **Sincronización masiva** (equivalente a `KRETZ_SYNC_CATALOG`) sobre el contrato común, con
   respaldo previo de lo que tiene la balanza (`31` + `62` de cada PLU). Enviar todo el catálogo
   pisa los PLUs con el mismo número, pero **no borra los que sobran** (ej. el PLU 999 de prueba si
   el catálogo no lo tiene). La sincronización tiene que comparar la lista de `31` contra el
   catálogo y **mostrar los sobrantes para que el admin decida borrarlos** (función `5`), con
   modal de confirmación. Nunca borrarlos en silencio.

---

## 8. Primera prueba en campo (orden sugerido)

Antes de escribir nada:

1. Cerrar Qendra. Enchufar. Ver en Administrador de dispositivos el "USB Serial Port (COMx)".
   Si no aparece, instalar el driver con la guía oficial "CUORA Instalación manual drivers".
2. **Respaldar los PLUs que tiene la balanza** (con Qendra → Herramientas, o con `31` + `62` desde
   la app). En Qendra, pantalla "Equipos": **no tocar el botón verde, borra todo.**
3. Solo lectura, en este orden, guardando cada respuesta en el log:
   - `23` ping → confirma enlace y dirección.
   - `2` firma → capacidad, cantidad de PLUs, decimales.
   - `63` formato de precio → ¿4:2 o 6:0?
   - `39` configuración → formato de códigos de barras.
   - `31` lista de PLUs.
   - `62` de un PLU existente → **largo de la respuesta = versión de formato** (sección 5).

Después, escritura con un PLU de prueba en un número que no se use:

4. Si hace falta, pasar a formato 6:0 (función `64`) con confirmación explícita.
5. Crear el sector si no existe (`10`).
6. Alta con `61` (o `4` si es V6.0). Esperar `ACK`.
7. Releer con `62` y comparar campo por campo. Confirmar en la pantalla de la balanza que el precio
   coincide. Imprimir una etiqueta y escanearla con el POS.
8. Cambiar el precio con `33`, verificar, y borrar con `5`.

Log esperado (formato sugerido, como en Kretz):

```
[systel] → 61 (sendPlu) { payloadBytes: 222, priceField: '021000', priceFormat: '6:0' }
[systel] ← 61 { response: 'ACK' }
```
