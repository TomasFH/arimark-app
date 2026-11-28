# Handoff — Systel Cuora Max (28/11/2026)

Este archivo reemplaza el contexto del chat del agente en la nube. Leer **antes** de implementar.

## Rama y versiones

| Qué | Valor |
|---|---|
| **Rama de trabajo** | `cursor/systel-cuora-max-ca23` |
| **Base** | `origin/rediseno-informacion` (commit `ec6bdc5`, desktop **0.6.19**) |
| **No usar como base** | `main` (0.6.6, quedó atrás hasta mergear el rediseño) |

Al retomar en casa:

```bash
git fetch origin
git checkout cursor/systel-cuora-max-ca23
# o, si no existe local: git checkout -b cursor/systel-cuora-max-ca23 origin/cursor/systel-cuora-max-ca23
```

## Documentación en el repo

| Archivo | Para qué |
|---|---|
| [SYSTEL_CUORA_MAX_PROTOCOLO.md](./SYSTEL_CUORA_MAX_PROTOCOLO.md) | Protocolo, sección **0** manda sobre el resto |
| [SYSTEL_IMPLEMENTACION_PLAN.md](./SYSTEL_IMPLEMENTACION_PLAN.md) | Plan por etapas (aprobado en chat, sin código aún) |
| [hardware/systel/Protocolo de comunicaciones CUORA MAX V6.0 Rev 06.pdf](./hardware/systel/Protocolo%20de%20comunicaciones%20CUORA%20MAX%20V6.0%20Rev%2006.pdf) | PDF oficial de esta balanza (protocolo **0060**) |
| [SESION_CAMPO_2026-06-15_KRETZ_PLU.md](../SESION_CAMPO_2026-06-15_KRETZ_PLU.md) | Paridad de lecciones con KRETZ |

Los otros PDF (V4, V6.2, V7) no están en el repo; son referencia opcional desde el ZIP de Systel.

## Estado del trabajo (al subir a GitHub)

- **Hecho:** documentación, plan, PDF V6.0 en `docs/`.
- **Pendiente:** implementación por etapas del plan (etapa 1 = codec + contrato + mock).
- **PC del local (28/11):** sesión de campo con balanza real; PLU **999** de prueba cargado con F61; **no** correr `pnpm dev` en esa PC si tiene la base SQLite de producción.

## Unidad de campo (CM30MBXUF1)

- COM (esa PC): **COM12**, 115200, FTDI.
- **Dirección:** **20** (configurada en la balanza). La `0` no se probó; en el protocolo empiezan con `20` + dirección guardada, luego `0`, y el barrido `0..99` solo desde DevTools.
- Firma F2: `F2000 C030000 S0060 P08000 A060 D0` → **0060**, **D0** (pesos enteros).
- F39: `E_P=20PPPPIIIIII`, `E_U=21PPPPIIIIII` (hasta cambiar prefijo pesable con F8).
- Sector **02** CARNICERIA existe (F11).
- **No usar F4** (precio con 2 decimales: `$15.000` → `$150`).
- **Usar solo F61** con layout V6.0, **155 bytes** sin ingredientes.

### Errata trama F61 (importante para tests)

El **layout por campos** (tabla de la sección 0) suma **155** caracteres. El renglón único pegado en el mismo doc mide **153** — le faltan **2 ceros** en el bloque de relleno (86 bytes entre flag nutricional `N` y el tipo EAN). **El driver y los tests deben armar el payload por offsets, no copiar el string de una línea.**

Trama validada conceptualmente (PLU 999, precio `015000` = $15.000/kg):

- Nombre: `PRUEBA ARIMARK 001` (18).
- Después del cambio de prefijo: en F61 el campo EAN de 12 chars lleva **`23PPPPIIIIII`** (pesable) o **`21PPPPIIIIII`** (unitario), no el global viejo `20…`.

## Decisiones cerradas (resumen)

Convivencia **Kretz + Systel** en la misma PC y caja; **una balanza activa** a la vez (lista en SQLite, migración `0065`).

| Tema | Decisión |
|---|---|
| Tickets mismo largo 13 dígitos | Systel pesable: F8 tipo `P` → **`23PPPPIIIIII`** (antes `20…`). Unitario **`21…`**. Sumas `22…` sin tocar. |
| F8 | Solo modal **admin**; leer F39 → confirmar → escribir → releer F39; si falla, revertir `P20PPPPIIIIII`. No en detección ni sync. |
| Prefijo 20 en Systel | Mientras `E_P` empiece con 20, la caja **no** cobra ticket Systel (solo Kretz en `20`). Avisar en UI. |
| F61 | Formato EAN de 12 = el **vigente** por balanza; probar etiqueta PLU 999 **antes** de sync masiva. |
| Post-alta | Siempre **F62** y comparar campo a campo (byte “gestión” en respuesta). |
| F33 | Fuera de esta entrega. |
| Nombres | Systel: mayúsculas, sin tildes, `ñ`→N, 18 chars, preview; si dos iguales → admin confirma. Kretz: sin cambio (26). |
| Precios | Kretz ×10, tope $99.999. Systel D0: enteros 6 dígitos, tope $999.999; si no entra, omitir y avisar. |
| Sector | Por balanza (aca `02`); si F11 no lo tiene, no enviar. **No** F10. |
| Sync Systel | Respaldo F31+F62, **5 JSON** por balanza; F61 catálogo; F31 sobrantes → **solo admin**, modal React, F5. |
| Sync Kretz | Sin cambio de comportamiento (`kretzSync.handler.ts`). |
| Celu | Parser Systel **después de 1.0**; no tocar `parseKretzBarcode` en mobile en esta entrega. |
| Detección | Solo lectura: KRETZ `0002`, luego Systel F23; nunca escritura en sondeo. |

## Prohibiciones (no relajar)

- No cambiar comportamiento Kretz salvo moverlo detrás del contrato (tests en verde).
- No comandos de escritura en detección.
- No F4, F9, F26, F32, F33, F35, F64 (ni F8 U/S automático).
- No `window.confirm` ni borrado silencioso de PLUs.
- No hardcodear COM, dirección, marca ni cantidad de balanzas.
- No escribir PLUs Systel si firma ≠ `0060` o decimales ≠ `D0`.
- No `pnpm dev` en la PC del local con base real (usar otra máquina o build de prueba).

## Orden de prueba en balanza real

Ver etapas 2–7 en [SYSTEL_IMPLEMENTACION_PLAN.md](./SYSTEL_IMPLEMENTACION_PLAN.md). Cerrar **Qendra** e **iTegra** antes de abrir el puerto.

## Cómo seguir con el agente

1. Checkout de `cursor/systel-cuora-max-ca23`.
2. Pedir: «Implementar etapa 1 del SYSTEL_IMPLEMENTACION_PLAN» (y así sucesivamente).
3. Cada etapa: `pnpm test` verde antes del commit (`tipo(alcance): descripción` en minúsculas).
4. Pruebas de hardware: vos en el local, con el checklist de la etapa.

## Commits pendientes al retomar

El primer commit de implementación debería ser algo como `feat(systel): codec y contrato de balanza` (etapa 1), no mezclar todas las etapas en un solo commit.