# Sesión de campo — 02/10/2026 — Disco nuevo, tres balanzas y PLU nuevos

Día en la carnicería, en la PC del local con disco nuevo. La balanza KRETZ REPORT NX que antes conectaba dejó de verse. Había que instalar de nuevo el driver, volver a hablar con iTegra y cargar el catálogo en tres balanzas iguales. Al final del día se agregaron productos en la app oficial.

Leer este documento para retomar. El detalle de protocolo R30 sigue en `SESION_CAMPO_2026-06-15_KRETZ_PLU.md`. La tarea de la app oficial que reconoce sola la balanza está anotada en `CHECKLIST_CIERRE_1_0.md` y en `PLAN.md`. No está codeada.

---

## Para seguir en la PC de desarrollo

La rama de trabajo del repo es `fase-pruebas`. `main` quedó en julio 2026 y no tiene este día.

Esta sesión está en la rama `cursor/sesion-campo-2026-10-02-13ec`, armada encima de `fase-pruebas`. Incluye el sondeo de COM de la versión de pruebas y los 25 PLU nuevos de la lista.

```powershell
cd <carpeta del repo>
git fetch origin
git checkout cursor/sesion-campo-2026-10-02-13ec
git pull
pnpm install
```

El PDF de PLU (solo número y nombre, dos páginas):

https://github.com/TomasFH/arimark-app/raw/cursor/sesion-campo-2026-10-02-13ec/LISTA_PRECIOS.pdf

También está en la raíz del repo como `LISTA_PRECIOS.pdf`.

---

## Resumen

| Hecho | Estado |
|-------|--------|
| Driver USB de la balanza en el disco nuevo (vía iTegra) | Hecho. Sin eso el COM no aparece |
| iTegra USB KRETZ, código de suma `99998`, Guardar | Hecho. Doble beep |
| Balanza 1 en la app oficial | Cargó el catálogo. El COM de ese día fue **COM4** |
| Balanzas 2 y 3 en la app oficial | Cargan solo después del procedimiento de abajo |
| La app oficial detecta sola una balanza recién enchufada | Pendiente 1.0. No codeado |
| PLU nuevos 500–518 y 550–555 en la lista del repo y en el PDF | Hecho. Sin precio: las capturas no lo traían |

---

## PC del local después del disco nuevo

Node quedó instalado (v24.21.0). En PowerShell, `npm` puede fallar porque la política de ejecución bloquea `npm.ps1`. Si hace falta npm: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force`, o usar `npm.cmd`.

`corepack enable` pidió permiso de administrador para escribir en `C:\Program Files\nodejs`. pnpm quedó usable a nivel usuario (`pnpm -v` respondió). El gestor del repo es pnpm. El lock es `pnpm-lock.yaml`.

El repo no estaba en esa PC al empezar. El remoto es https://github.com/TomasFH/arimark-app . Lo que se sube para seguir el desarrollo es la rama de arriba, no `main`.

La app que ya estaba instalada (el `.exe` generado en la PC de la casa) es la de producción. No tiene el panel DevTools. `pnpm dev` es otra app: base sandbox, banner «MODO PRUEBAS», y no comparte la carpeta de datos con el instalador (`Carniceria App`). La carga de precios a la balanza del local se hace desde el instalador.

---

## iTegra — lo que hay que dejar configurado

iTegra sirve para instalar el driver y para probar que la balanza contesta. Después se cierra. Un solo programa puede tener el COM abierto.

1. Archivo → Configuración → Configurar equipos.
2. Modelo: **Balanza Report NX o LT**.
3. Comunicación: **USB KRETZ**. Si eso no enlaza, el respaldo es el COM con el número solo (COM11 se escribe `11`) y baud **115200**.
4. Código de suma: **99998**. El campo vacío no deja guardar («Debe ingresar todos los datos necesarios correctamente»). 99998 es el ejemplo del soporte KRETZ.
5. Guardar. La prueba de comunicación es un doble beep.
6. No transmitir los datos completos y no marcar borrar lo que ya está en la balanza.
7. Cerrar iTegra antes de abrir la app.

El driver que aparece en el Administrador de dispositivos es el de iTegra (JDATAGATE / FTDI, instalador bajo `Program Files\iTegra\kSolutions\iTegra`). En el disco nuevo, sin ese driver, no había puerto COM.

---

## Balanza 1

Con iTegra cerrado, `pnpm dev` en DevTools → Hardware detectó la balanza en **COM4** y el enlace quedó en verde («Balanza detectada en COM4 y conectada»).

Después el instalador oficial cargó el catálogo en esa balanza. El COM de las sesiones de junio y julio (COM8, COM11) no se reutiliza: el número lo asigna Windows. Hoy fue COM4.

`pnpm dev:hw` en esta rama no fija COM8. Pone `KRETZ_AUTOPROBE=1`: si el COM guardado no abre o no responde al enlace R30 (`0002`), sondea los demás, conecta el que contesta y lo guarda. `pnpm dev` sin puerto sigue en el mock.

Ese sondeo está en la versión de pruebas. El instalador oficial no lo muestra y no lee el puerto que guardó `pnpm dev`, porque cada una tiene su propia carpeta de datos.

---

## Balanzas 2 y 3 — procedimiento que funcionó

Hay tres REPORT NX. La app oficial conectó la primera. La segunda y la tercera no.

Desenchufar y volver a enchufar, y que DevTools las viera en verde, no alcanzó para que el instalador las tomara al volver. Reiniciar solo la app oficial tampoco alcanzó en la tercera.

Lo que sí funcionó, en la segunda y en la tercera:

1. Cerrar la app oficial.
2. Abrir la versión de pruebas y confirmar el enlace en DevTools → Hardware (verde, COM detectado).
3. Cerrar la versión de pruebas.
4. Abrir de nuevo la app oficial.
5. Recién ahí, **Cargar en balanza** envía el catálogo.

Ese rodeo no puede ser el camino del local: el instalador no tiene DevTools. Queda para la 1.0.

**Pendiente 1.0, sin codear:** la app oficial tiene que encontrar sola la balanza recién enchufada. Si ese sondeo no es fiable, un botón en el modal **Cargar catálogo en la balanza** que reintente el enlace y se conecte al COM que responda.

La carga de la balanza del local se hace desde el instalador, con los precios de esa base. `pnpm dev` tiene otra base y otros precios.

---

## PLU nuevos (octubre 2026)

En la app oficial se agregaron productos. Las capturas del catálogo (solo PLU y nombre) se compararon con `apps/desktop/scripts/catalog-2026-08.json`.

Los PLU 1–411 ya estaban, con el mismo nombre. Nuevos, 25:

**Congelados, por kg**

| PLU | Nombre |
|-----|--------|
| 500 | Patitas de pollo |
| 501 | Medallón de pollo |
| 502 | Medallón Jamón y Queso |
| 503 | Papa noisette |
| 504 | Papa carita |
| 505 | Papa tradicional |
| 506 | Bastón espinaca |
| 507 | Nugget Brocoli |
| 508 | Nugget crocante |
| 509 | Medallón de merluza |
| 510 | Calabaza |
| 511 | Pochoclo |
| 512 | Filet rebozado |
| 513 | Merluza marinada |
| 514 | Bastón mozzarella |
| 515 | Chicken finger |
| 516 | Bastón de merluza |
| 517 | Brocoli |
| 518 | Crispy |

**Almacén, por unidad**

| PLU | Nombre |
|-----|--------|
| 550 | Provoleta |
| 551 | Carbón chico |
| 552 | Carbón grande |
| 553 | Maderitas |
| 554 | Leña |
| 555 | Aceite |

Patitas de pollo, Medallón de pollo y Chicken finger quedaron en categoría pollo. El resto de congelados y todo almacén, en otros. Las capturas no decían unidad ni rubro: es la clasificación de la lista.

El precio en el JSON es `null`. No se inventó ninguno. El seed y `replaceCatalog.mjs` dan de alta el producto y no escriben precio si el valor no es un número, así un reemplazo de catálogo no pisa el precio que ya tiene el local.

El PDF se regenera con `apps/desktop/scripts/generatePriceListPdf.py`. Sigue en dos páginas. Congelados y Almacén van al final de la segunda. El PDF no imprime precios.

Cuando haya precios de lista de estos 25, se completan en el JSON. Hasta entonces se dejan vacíos.

---

## Dónde quedó cada cambio

| Tema | Dónde |
|------|--------|
| Esta sesión | `SESION_CAMPO_2026-10-02.md` (esta rama) |
| Sondeo si el COM guardado no responde | `apps/desktop/electron/hardware/hardwareManager.ts`, `pnpm dev:hw` con `KRETZ_AUTOPROBE=1` |
| Reconocer la balanza en la app oficial | Pendiente. `CHECKLIST_CIERRE_1_0.md`, `PLAN.md` |
| Lista y PDF | `apps/desktop/scripts/catalog-2026-08.json`, `LISTA_PRECIOS.pdf` |

Pull requests de borrador, base `fase-pruebas`:

- Balanza (sondeo de COM): https://github.com/TomasFH/arimark-app/pull/1
- PLU nuevos: https://github.com/TomasFH/arimark-app/pull/2
- Esta rama junta las dos y este documento.
