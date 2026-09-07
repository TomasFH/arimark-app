# Checklist de testeo — retomado 2026-08-19

Convención: `[ ]` pendiente · `[x]` OK · `[!]` bug nuevo.

**Cómo se lee el progreso (acordado):** si mencionaste el punto N de una sección, se asume que **1…N están OK** (incluidos los intermedios que no nombraste). Lo **posterior** al último punto del que hablaste **no se testeó**. “Lo que no mencioné está hecho” vale **hacia atrás**, no hacia adelante.

**Dónde frenaste (reconstruido del chat, no de memoria):**

- Parte 3 (desktop sync) **cerrada**. 3.5 offline **salteada** a propósito.
- **4.1** hub admin móvil: **OK** (2026-08-17). Queda diferido el ↻ “recargar lo justo” (UX-MOB-REFRESH-01).
- **4.2 Pedidos** y **4.2 Fiados:** último comentario = “bien” / “en general parece bien” → se dan por OK. Pedidos con carrito: cerrado 2026-09-04 (`CHECKLIST_TESTEO_PEDIDOS_LISTA.md`).
- **4.2 Proveedores:** testeo 2026-08-20 **cerrado** (ajustes de UX aplicados después: re-probar al retomar).
- **4.2 Clientes especiales:** testeo **2026-08-24 cerrado**.
- **4.2 Carniceros / Cajeras (Personal):** testeo **2026-08-24 cerrado**.
- **4.2 Locales:** testeo **2026-08-24 cerrado** (eliminar en PC persiste al reentrar).
- **4.2 Historial (móvil):** testeo **2026-08-24 cerrado**.
- **4.3** limitaciones esperadas: testeo **2026-08-24 cerrado**. Catálogo en celu = post 1.0. Liquidación semanal **con pago en PC** (2026-08-25). **Parte 5** POS base testeo 2026-08-25 cerrado; pack emergencia codeado 2026-08-28. **Parte 6** testeo **2026-08-25 cerrado**. **Parte 7** paleta (Tanda 9) **cerrada 2026-08-28**; header de productos diferido (diseño).
- La **ola 2026-08-18** A.1–A.6 **re-testeada y aprobada 2026-08-27**. Tandas 1–2 y 4–6 OK. **Tanda 8 y 9 cerradas 2026-08-28.** Tanda 7: proveedores OK; **cierre de caja** — diálogo “¿cerrar?” + **resumen post-cierre** (re-probar con `CHECKLIST_TESTEO_CIERRE_Y_HABITUAL.md`). **Tanda 3 (carrito de pedidos) codeada 2026-09-02 y Pedidos PC cerrado 2026-09-04** (`CHECKLIST_TESTEO_PEDIDOS_LISTA.md`). Carnicero celu: `CHECKLIST_TESTEO_CARNICERO.md`.
- **Ola de checklist 2026-08-28 cerrada.** Lo que queda abierto es diseño, deudas documentadas o se re-testea con las implementaciones que vienen.

**Orden práctico:** I (humo) → II (lo que no llegaste a probar de móvil/sync) → III (ola 18, desktop) → IV (tandas, código nuevo). Si un ítem dice “también Tanda N”, al pasarlo en la tanda podés tacharlo en II/III.

**Sigue fuera (no re-probar / no es esta pasada):** UX-PLU-01, UX-PROV-02, FEAT-CAT-03 backup, 3.5 offline, optimizar ↻ móvil (UX-MOB-REFRESH-01). **Catálogo en vivo + edición cajera (BLOQUE I):** probar con `CHECKLIST_TESTEO_CIERRE_Y_HABITUAL.md` (el archivo se reutilizó). **No codear ahora:** DT-07, **DT-08**. El Historial **móvil de la Parte 4** sí se recorre como checklist funcional; DT-08 es la deuda de *cómo* pide Firestore, no de tachar la pantalla.

---

## I — Arranque de humo

- [ ] `pnpm dev:prod` abre login admin/cajera sin error de TypeScript ni de migración.

---

## II — Parte 4 en adelante (lo que no se recorrió)

Admin en **[https://arimark-7f418.web.app](https://arimark-7f418.web.app)** y PC (`dev:prod` / `electron:remote`). Tras escribir en un lado, ↻ o reentrar a la sección en el otro.

### 4.2 desde Proveedores

- [x] **Proveedores** (testeo 2026-08-20). Eliminar/restaurar conserva historial. Pago por local. “A favor $…” en el desglose. Historial PC y celu. Ajustar deuda (salida de emergencia, queda “Ajuste de admin (Nombre)…”). Saldar/Registrar en modales aparte. Compensar entre locales desde admin. Cajera: gasto con saldo a favor; sidebar Saldar (efectivo de esta caja). Concepto no sugiere `Vale:` / `Pago:`.
  **UX aplicada después de ese testeo (re-probar al retomar):** selector de local vacío si hay 2+ locales; gasto más ancho + paleta zinc/emerald y saldo a favor en verde; comprobante aclara si se usó saldo a favor; Saldar deshabilitado en la pestaña de un local sin deuda; historial PC paginado y más ancho; naranja de Registrar alineado a `orange-600`; modal Saldar de cajera más alto (autocomplete sin scroll ridículo); compensación opcional en Saldar de cajera; aviso al crear un nombre que ya existe (activo → usar otro; eliminado → restaurar). Sin UUID: un proveedor por nombre normalizado.

- [x] **Clientes especiales** (testeo 2026-08-24). Lista celu ↔ PC (creados en celu aparecen en remote). UI celu alineada a PC (cards que se expanden, crear/editar con precios inline, borrar). Agregar precio = catálogo publicado **completo**, orden **PLU asc**, sin recorte a 40. El “no hay panel de catálogo en móvil” es el Panel de Administración de la PC (4.3), no este autocomplete. Sync: celu→PC en vivo (listener PC); PC→celu al reentrar a la sección (el celu no tiene `onSnapshot`). Precios especiales en el **POS** = **Tanda 2**.
- [x] **Carniceros / Cajeras:** ahora viven en **Personal** (también **Tanda 5**). En móvil: pestañas Cajeras (activar/desactivar; sin alta ni “locales autorizados”) y Carniceros (Activos / Eliminados, sueldo semanal `1.000`, sin selector de local, vales listados). Crear carnicero en celu → se ve en PC y al revés. Confirmar eliminar con modal de la app.
- [x] **Locales:** copy **Eliminar** / Restaurar. Confirmación = modal de la app. Botón **←** siempre visible (iOS). Crear en celu o PC y eliminar: debe desaparecer en ambos tras ↻. “Ver eliminados” opt-in (también **Tanda 6**).
- [x] **Historial (móvil):** detalle de turno con pestañas Ventas / Gastos / **Fiados** / **Señas** / **Vales**. En Gastos el **título** es el proveedor o “Vale: …” (como en PC). Filtro Todos los locales lista turnos de todos. Señas/fiados del turno = también **III A.5**.

### 4.3 Limitaciones esperadas (no marcar bug salvo que falle lo prometido)

- [x] No hay panel de **catálogo/productos** en móvil (la pantalla de Panel de Administración de la PC: alta/edición de ficha, precios de lista, carga a la balanza). El autocomplete de Clientes especiales **sí** debe mostrar el catálogo publicado completo. **Post 1.0:** edición de precios/ficha en celu (sin balanza).
- [x] No hay conteo de stock ni asistencia en móvil admin.
- [x] **Liquidación semanal** en celu (2026-08-24 consulta; **2026-08-25 pago en PC**): Empleados → **Liquidación** (header). Semanas ← →. Si está pagado: badge, sueldo/vales/neto congelados, nota. El pago se hace en **PC** (turno abierto). Zoom pellizco en toda la PWA. **Re-probar** tras deploy.

### Parte 5 — Cajera móvil (POS respaldo)

Testeo 2026-08-25 (POS base) **cerrado**, salvo Atrás. Selector de locales = también **III B** (cubierto: el resto de Parte 5 OK).

- [x] Login cajera → selector con **nombres** de locales (no el id). Todos los locales **activos**. Un solo local activo → puede saltar a abrir turno. **Si ya hay turno abierto de esa cuenta en este celu → directo al POS** (no vuelve a preguntar el local).
- [x] Abrir turno → POS. Efectivo inicial con autoformateo `1.000` (NumericInput).
- [x] Venta manual: sugerencias **arriba** del campo (visibles con teclado). Peso y/o precio como en PC; al elegir producto el foco va al peso.
- [x] Confirmar venta → totales coherentes. Cobro: campos **vacíos**; botón ← $resto por medio (como PC). No precargar efectivo = total. **Efectivo de más** (ej. $40.000 sobre $37.500) muestra vuelto y registra el total, como en PC. Re-probar 2026-08-28.
- [x] Banner offline; al reconectar resync (catálogo/ventas pendientes). Catálogo móvil = descarga al login/reconectar, **no** en vivo.
- [x] Cerrar turno: pide confirmación (total vendido + efectivo esperado). El POS muestra **en caja** en vivo.
- [ ] Atrás del sistema: cierra modal/pantalla primero; con la pila vacía pregunta “¿salir de la app?”. **Re-probar 2026-08-28:** (a) abrir y Atrás → modal, no cierra; (b) **Salir** cierra la PWA/APK (window.close + exitApp nativo); Cancelar deja la app; Atrás otra vez vuelve a preguntar.

**No es bug de esta pasada:** el turno abierto en celu **no** aparece como caja activa en PC (`PLAN.md` DT-06).

**Pack emergencia `FEAT-MOB-EMERGENCY-01` (incluido 2026-08-28 — re-probar):**

- [ ] **Gasto** (proveedor de la lista o concepto + monto). Resta “en caja”. Deuda de este local (sin cross-local / sin Saldar dedicado).
- [ ] **Ingreso** de efectivo (monto + nota). Suma “en caja”. PC: sidebar **Ingreso**. Concepto interno sigue `Aporte`.
- [ ] **Vales** y **Liquidación** (semana en curso). Efectivo baja caja; productos no. Quedan en el turno del celu (DT-06).
- [ ] **Ventas de este turno:** lista + anular (tachada). El efectivo esperado deja de contar esa venta.
- [ ] **Fiado en Cobrar:** nombre obligatorio, teléfono opcional, pago inicial opcional. La venta nace fiado; el resto queda como deuda.
- [ ] Tras sync, en PC (historial / fiados / proveedores / liquidación) se ven gastos con proveedor, ingresos, vales, sueldos, anulaciones y fiados del celu. El **cierre** del celu aparece en Historial PC/admin con etiqueta **Móvil**. **Re-probar 2026-08-28.**

### Parte 6 — Sync Desktop ↔ Móvil

Testeo 2026-08-25 (primera pasada). 6.3–6.6 y 6.9–6.11 OK. **Re-probar solo lo roto.**

**Alta de cajeras en móvil (6.5):** **decisión**, no deuda. Auth es Firebase; el alta de cuentas es consola Firebase. El celu solo activa/desactiva.

**Re-probar tras el fix:** (cerrado 2026-08-25)

- [x] **6.1 / 6.2 fechas:** el retiro es el **mismo día civil** en PC y celu. El celu muestra el **turno** (mañana / tarde / horario) en el listado.
- [x] **Pedidos PC (admin hub):** entrar desde el hub no deja pantalla blanca. Pedidos del celu se listan.
- [x] **6.7 / Empleados:** hub tile **Empleados**. Misma página, sectores Cajeras y Carniceros (cards compactas; clic abre modal con datos, vales y acciones). Un solo “+” elige tipo. Cajeras tienen sueldo y vales. Vale de cajera en PC → celu.
- [x] **6.8 fiado:** en celu, al pagar, se pueden combinar medios y hay botón **← $resto** por medio (como en el POS).


| #    | Escritura                          | Lectura                                   | Esperado                                                                                 |
| ---- | ---------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| 6.1  | Desktop admin crea pedido          | Móvil Pedidos (↺)                         | Visible. Fecha de retiro = mismo día civil. Turno visible en celu.                       |
| 6.2  | Móvil admin crea pedido            | Desktop Pedidos                           | Visible. Fecha igual. Turno en listado celu.                                             |
| 6.3  | Móvil cambia estado pedido         | Desktop Pedidos                           | Estado igual (ya no hay “Listo”; entregado/anulado/Cobrar = Tanda 3)                     |
| 6.4  | Desktop crea carnicero             | Móvil Empleados → Carniceros              | Visible                                                                                  |
| 6.5  | Móvil crea carnicero               | Desktop Empleados (↺)                     | Visible. Cajeras **no** se dan de alta en móvil (**decisión**: consola Firebase).        |
| 6.6  | Desktop cajera: venta + cierre     | Móvil Historial                           | Turno + ventas (señas: III A.5)                                                          |
| 6.7  | Desktop cajera: vale               | Móvil Empleados → card → vales            | Listado. Cajeras también tienen sueldo/vales. Empleados = sectores + modal, no pestañas. |
| 6.8  | Desktop: fiado nuevo               | Móvil Fiados                              | Cliente/saldo. Pago en celu mixto + botón de resto.                                      |
| 6.9  | Móvil: pago proveedor              | Desktop Proveedores                       | Deuda actualizada                                                                        |
| 6.10 | Desktop: renombra local            | Móvil hub (↺)                             | Nombre nuevo                                                                             |
| 6.11 | Desktop: alta/precio/baja producto | Móvil POS cajera (login o ↺ / reconectar) | Merge: alta visible, precio nuevo, baja **no** aparece                                   |


- [x] 6.1–6.11 (cerrado 2026-08-25)

### Parte 7 — Regresiones rápidas

Nunca se recorrió. Varios puntos ya están en tandas: al pasar la tanda, tachalos acá.

- [x] Productos eliminados invisibles en todo el sistema (baja **global**). **Bug 2026-08-25:** en PC desaparece; en celu Clientes especiales → Agregar productos seguía apareciendo (a veces **duplicado** con el mismo PLU). Re-probar tras el deploy: no debe listarse ni duplicarse.
- [x] PLU se libera al eliminar.
- [x] Eliminar producto = modal custom (nunca diálogo nativo de Windows).
- [x] Eliminar local = mensaje corto; “eliminados” solo con opt-in (**Tanda 6**).
- [x] Liquidación semanal sin sección “Vales (remoto)” suelta en hub; vales remotos **dentro** de Liquidación con buscador.
- [x] Zoom persiste entre sesiones (atajos vs slider = **Tanda 8**).
- [x] **Ventana de caja a pantalla completa:** agrandá la ventana del punto de venta (el botón de maximizar de Windows, o arrastrar a toda la pantalla). Recorré una venta: carrito, total, botones de cobro y menú tienen que verse y usarse bien, sin que se corten o queden tapados. No es un término técnico raro: es “¿se puede trabajar con la ventana grande?”.
- [x] Modales paleta zinc/emerald (**Tanda 9**, cerrado 2026-08-28). Capas 950 / 800 / 700 en Productos, hub, cobro, empleados, gasto, vale, liquidación, locales, caja, fiados, clientes especiales, pedidos, proveedores, historial, conteo. UI se va a retocar más adelante (queda “regular”; no es bug de esta pasada).
- [x] **Catálogo merge:** crear un producto en una sesión **no** borra el resto en la otra; ↺ une las listas.
- [x] **Catálogo merge:** borrar un producto en admin → desaparece en cajera tras ↺.
- [x] **El recuadro grande de la caja no es un buscador.** Sirve para **escanear el ticket** de la balanza. Para buscar un producto por nombre o PLU: **Menú → Lista**. El placeholder ya no dice “busca”.
- [x] Cajeras operan en **todos** los locales activos (también III A.6).
- [ ] **Header de la lista de productos (admin):** al scrollear, las filas **no** se tienen que ver atravesando el encabezado (PLU / Nombre / …). Diferido — se re-testea con el retoque de UI / catálogo.

---

## III — Ola 2026-08-18 (re-testeada 2026-08-27)

A.1–A.6 **cerradas en PC**. **B. Móvil (selector de local cajera)** se deja para después.

### A.1 Gastos (proveedor)

- [x] Visita $1.000.000, entregado **0** (o vacío), nota “No pagué nada” → se guarda. El saldo del proveedor **sube** esa plata. El efectivo de caja **no** cambia.
- [x] Gasto **sin** proveedor: monto 0 **sigue rechazado** (eso está bien).
- [x] Visita normal con entregado > 0 sigue funcionando.

### A.2 Vales

- [x] Vale en **efectivo** $10.000 → el efectivo esperado baja $10.000. Aparece en Gastos.
- [x] Vale **con productos** (ej. 2 kg asado) → **no** baja caja y **no** aparece como gasto. Sigue sumando en Liquidación. Autocomplete / anular / pestaña Vales = **Tanda 4**.

### A.3 POS y ventas del turno

- [x] Carga **manual**: no aparece mensaje tipo “X agregado”.
- [x] Al abrir Manual, la pestaña de la izquierda es **PLU + precio**.
- [x] Quitar un ítem: solo la cruz, sin la palabra “Eliminar”.
- [x] El botón grande dice **Cobrar**. Enter **no** cobra.
- [x] Confirmá una venta en efectivo. Anulala desde “Ventas del turno”. El monto “en caja” baja **inmediatamente**.

### A.4 Abrir turno / hub

- [x] Mañana vs Tarde: el elegido se ve verde (borde/fondo), el otro gris.
- [x] Si hay más de un local: al pasar el mouse se ve borde verde.
- [x] Hub admin → **Asistencia** se ve igual de activa que Historial (no “apagada”) y abre el modal.

### A.5 Historial (señas)

Repetí (o mirá un turno viejo equivalente):

1. Pedido A: seña $40.000 efectivo → cancelar (queda gasto “Devolución de seña”).
2. Pedido B: seña $30.000 ($20.000 efectivo + $10.000 débito) → **no** cancelar.
3. Cierre: efectivo esperado debería ser **$20.000** de la seña B (el débito no cuenta).
4. Historial de ese turno:
  - [x] Tab **Señas** lista A (anulado) y B.
     [x] Efectivo esperado **igual al del cierre** (no −$40.000).
     [x] Tab **Fiados** muestra los fiados/cobros de ese turno si los hubo.

También con `pnpm electron:remote` (otra PC simulada):

- [x] El detalle del mismo turno muestra señas y un efectivo esperado coherente (ya no Señas 0).

### A.6 Conteo y cajeras

- [x] Nuevo conteo: scrolleá la lista. El buscador **no** deja ver productos atrás (fondo opaco).
- [x] Historial de conteos → abrir un detalle → el buscador filtra esa lista.
- [x] Cajeras: en el POS puede elegir cualquier local activo. Conteo por local + filas vacías + ± kg = **Tanda 1**.

### B. Móvil — selector de local (cajera)

Pendiente (no es esta pasada). Hace falta `pnpm mobile:deploy`. Probar en Hosting (cajera):

- [ ] Login cajera → selector con **nombres** de locales. Si hay un solo local activo, puede saltear el selector.
- [ ] Con 2+ locales, se ven todos los activos.
- [ ] Offline: si ya habías abierto la app online, el selector usa la lista cacheada.

---

## IV — Tandas (backlog grande, 2026-08-18/19)

Re-probar cada tanda una vez (misma pantalla junta).

### Tanda 1 — Conteo

- [x] Admin desde el hub: **hay que elegir local** antes de guardar. El modal muestra el nombre del local.
- [x] Cajera: el local es el del turno (se ve, no se elige).
- [x] Copy: “si lo dejás vacío, no entra en el conteo”. Filas vacías **no** se guardan. Packs/ofertas **siguen visibles**.
- [x] Botones **+/−** en kg (0,1 kg) sobre el peso. (Esto era como funcionaba antes. Ya no funciona así sino de la forma deseada, y lo hace correctamente)

### Tanda 2 — Sync fiados y precios especiales

- [x] ↺ en POS recarga la lista de **fiados**. Un pago hecho en admin/otra PC aparece.
- [x] ↺ también refresca esa lista de clientes especiales.

- Selector de **cliente especial** en el POS (auto-aplica precios): **oculto** 2026-08-27 a propósito. Consulta = Menú → Clientes especiales. Código vivo: `SHOW_SPECIAL_CUSTOMER_POS_SELECTOR` en `CashierScreen.tsx` / `PLAN.md` FEAT-SPECIAL-POS-SELECTOR-01. **No testear** el desplegable hasta reactivarlo.

### Tanda 3 — Pedidos (Cobrar)

**Hecho 2026-09-02. Pedidos PC cerrado 2026-09-04.** No re-probar acá: [`CHECKLIST_TESTEO_PEDIDOS_LISTA.md`](CHECKLIST_TESTEO_PEDIDOS_LISTA.md). Carnicero celu: [`CHECKLIST_TESTEO_CARNICERO.md`](CHECKLIST_TESTEO_CARNICERO.md).

- [x] Crear pedido con carrito de presupuesto; Cobrar inyecta el POS; seña como crédito; cancelar el ticket no entrega el pedido; Listo se conserva (cajera y carnicero).

### Tanda 4 — Vales

- [x] Autocomplete de producto (nombre o PLU), no lista desplegable ni `type="number"`.
- [x] **Anular** vale: no se borra. Efectivo → contra-asiento de caja (el original sigue). Productos → deja de descontar en liquidación.
- [x] Historial de turno: pestaña **Vales** (local y remoto).

### Tanda 5 — Empleados

- [x] Hub: **un solo tile Empleados**. Adentro, dos sectores: Cajeras y Carniceros (mismo diseño de cards; detalle en modal). Igual en móvil.
- [x] Liquidación: quien ya cobró **esta semana (lun–dom)** sigue en la lista con badge **Pagado** (también en otras PCs/sesiones). **No** hay botón de pagar de nuevo. El CTA de pagar es verde emerald. El lunes siguiente es otra semana: vuelve a aparecer para pagar (no “a los 7 días”).
- [x] ← semanas anteriores = **solo archivo**. No aparece **Pagar**. Un texto aclara que el pago es de la semana en curso.

### Tanda 6 — Catálogo y locales

- [x] Catálogo: encabezado de tabla **fijo** al scrollear. Clic en columnas **ordena**.
- [x] Editar producto: precios de **todos** los locales precargados y se guardan (no solo el de la pestaña).
- [x] Locales: “Ver eliminados” como carniceros archivados (opt-in, no sección colapsable abajo).

### Tanda 7 — Proveedores y cierre

- [x] Proveedores: paleta zinc/emerald, **teléfono visible**, saldar/ajustar/registrar en modales aparte, compensar entre locales. Re-probar UX 2026-08-20: local vacío si hay 2+; gasto más ancho + a favor en verde; comprobante aclara saldo a favor; Saldar deshabilitado en pestaña sin deuda; historial PC paginado; Saldar cajera más alto + compensación opcional; aviso de nombre existente (sin UUID).
- [x] Cierre de turno: paleta / sin pulse / diálogo **“¿cerrar?”** anclado al viewport. **Después de confirmar** aparece el modal **Caja cerrada** con resumen (totales, efectivo, diferencia) y **Finalizar sesión**. Re-probar en `CHECKLIST_TESTEO_CIERRE_Y_HABITUAL.md`. `(Cajera · PC y celu)`

### Tanda 8 — Nav, menú, zoom, hub

- [x] Entrar/salir de una sección dispara el mismo refresh que ↺.
- [x] POS: **un** botón Menú (ya no hay Ajustes duplicado).
- [x] Ctrl+/− actualiza el valor del slider de zoom en Ajustes.
- [x] Hub: al expandir un grupo, scrollea a la vista. La scrollbar no salta el layout.

### Tanda 9 — Paleta (re-testeo visual único)

Capas 950 / 800 / 700 aplicadas también a locales, caja, fiados, clientes especiales, pedidos, proveedores, historial y conteo. Recorrer de punta a punta mirando:

- [x] Fondo menos negro (ya no “negro puro”).
- [x] Header de sección: flecha + fondo (mismo patrón).
- [x] CTAs de modales zinc/emerald, sin azul viejo.
- [x] Caja: sidebar/carrito/total distintos del fondo; **Turno** ya no usa gray-*; **Saldar** mismo gris que Vales/Gastos.

### Móvil (Hosting) — tandas

Hay cambio de capas zinc (locales, fiados, clientes, pedidos, proveedores, historial) además del hub. Hace falta `pnpm mobile:deploy`.

- [x] Hub admin: un tile **Personal** con pestañas Cajeras / Carniceros.
- [x] Pedidos: no aparece Listo; pending → entregado / anulado.

---

## Cómo anotar si algo no cierra

- **Conteo:** si guarda filas vacías o el admin puede guardar sin local, es Tanda 1.
- **Fiado:** si ↺ no trae el pago, Tanda 2. El desplegable de cliente especial en el POS está oculto (`FEAT-SPECIAL-POS-SELECTOR-01`); no es bug.
- **Pedido cobrado dos veces o seña duplicada en caja:** Tanda 3 (cuando exista el flujo nuevo; el Cobrar actual no es el deseado).
- **Anular vale borra el gasto original o sigue descontando en liquidación:** Tanda 4.
- **Caja vs historial (señas mixtas):** III A.5. Si no coinciden, anotá turno + montos.
- **Vale productos vs caja:** si baja caja, es III A.2.
- **Proveedores (archivar vs borrar deuda, pago por local, “A favor”):** II 4.2.
- **Sync celu↔PC:** Parte 6.
- **Cierre de caja (resumen post-cierre):** Tanda 7 — re-probar en `CHECKLIST_TESTEO_CIERRE_Y_HABITUAL.md`.

---

## Estado 2026-08-28 — ola de checklist cerrada

Tandas 1–2, 4–6, **8 y 9** OK. Tanda 7 proveedores OK. Paleta aceptada con la salvedad de que la UI se va a retocar (queda regular; no es bug).

**Abierto y no es esta pasada** (diseño, o se re-testea con lo que viene):

| Qué | Dónde | Notas |
| --- | --- | --- |
| Resumen post-cierre de caja | Tanda 7 | Codeado 2026-08-28 — re-probar en `CHECKLIST_TESTEO_CIERRE_Y_HABITUAL.md` |
| Header de productos al scrollear | Parte 7 | Diferido con el retoque de UI / catálogo |
| Pedidos: cobro con carrito | Tanda 3 | Cerrado 2026-09-04 — `CHECKLIST_TESTEO_PEDIDOS_LISTA.md` |
| Carnicero celu + Dar acceso | FEAT-BUTCHER-01 | Testear `CHECKLIST_TESTEO_CARNICERO.md` B–D |
| Selector de local cajera en celu | III B | Cubierto en Parte 5; no re-probar ahora |
| Pack emergencia celu (gasto/vales/liquidación/Salir) | Parte 5 | Codeado 2026-08-28; se re-testea al usar el POS móvil |
| Local habitual (asistencia/vales) | BLOQUE H | Codeado 2026-08-28 — `CHECKLIST_TESTEO_CIERRE_Y_HABITUAL.md` |
| Login offline PC, catálogo en vivo | DT-02, BLOQUE I | No codear hasta que se pida |


