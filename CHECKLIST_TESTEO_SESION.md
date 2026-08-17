# Checklist de testeo — sesión 2026-08-10 / 2026-08-14 / 2026-08-15 / 2026-08-16

Notas de QA. **No implementar hasta que el desarrollador lo pida.**
Convención: `[x]` OK · `[ ]` pendiente de probar · `[!]` bug / mejora anotada.

---

## PARTE 0 — Arranque e instalación

**Estado: COMPLETA** `[x]`

- [x] App arranca sin errores de migración
- [x] Login admin → hub
- [x] Login cajera → selector de local → turno → POS
- [x] Cerrar sesión y volver a entrar
- [x] Scrollbars / estética general de arranque OK

---

## PARTE 1 — Admin solo (Desktop)

### 1.1 Hub admin y ajustes

- [x] Header hub: nombre + rol
- [x] Panel **Ajustes** abre
- [!] Zoom **− / +** del panel: OK y **persiste** al cerrar la app
- [!] Atajos **Ctrl+= / Ctrl+- / Ctrl+0**: el zoom visual **sí cambia**, pero el valor del modal Ajustes **no se actualiza** (desincronizado UI vs factor real)
- [x] Botón ↺ del header no rompe
- [x] **Operar como cajera** lleva al POS
- [x] Grupo **Empleados** expande/colapsa
- [x] Grupo **Stock** expande/colapsa (Nuevo conteo + Historial)
- [!] Al expandir un grupo cerca del borde inferior: las sub-opciones quedan fuera de vista. Pedido: **autoscroll** para mostrar todas las opciones (Stock y cualquier GroupTile)
- [!] Al expandir (y al cambiar de sección): aparece la scrollbar → el contenido **salta a la izquierda** unos px. Al cambiar de sección se percibe como parpadeo blanco + scrollbar fantasma milisegundos. Causa: reserva de espacio de scrollbar. Pedido: evitar el salto (p. ej. scrollbar siempre reservada / overlay)
- [x] Cerrar sesión desde el hub

### 1.2 Navegación y consistencia visual

**a. Headers de sección — pendiente de rediseño** `[!]`
- No gusta el bloque izquierdo (atrás + título): todo apretado a la izquierda con espacio vacío al centro.
- Botón atrás actual (`<`) poco reconocible para adultos mayores.
- Pedido: flecha clara + **fondo más claro** para que se note que es botón. Intuitivo, no “símbolo de nativo digital”.

**b. Paleta / contraste — pendiente** `[!]`
- Fiados: combinación azul (filtro “Todos”) + cards rojo vencidas + botón emerald = ruido visual. No volver al azul de fondo; **suavizar acentos** para que destaquen sin chocar.
- Proveedores (imagen 4): se veía “mejor” en conjunto pero **sigue paleta vieja** (naranja deuda, verde “sin deuda”, CTA azul). Actualizar a zinc/emerald (ver 1.10).
- Fondo `zinc-950` **demasiado oscuro**. Preferir gris oscuro un poco más claro (modo oscuro sin contraste extremo contra el contenido).

**c. Panel de administración (productos)** `[x]` recorrido; mejoras:
- [!] Table header **sticky** al scrollear
- [!] Columnas **ordenables** (PLU, Nombre, Categoría, Unidad, Precio, Disponible)

**d. Gestión de locales** — ver 1.4 (notas ya tomadas)

**e. Modales inconsistentes entre secciones** `[!]`
- Locales “Nuevo local”: CTA confirmar **azul** vs “+ Nuevo” del header **emerald**
- Cajeras “Nueva cajera”: CTA **rojo** (al usuario le gusta ese rojo en ese modal, pero rompe consistencia)
- Empleados “Nuevo empleado”: CTA **azul** + focus ring azul vs “+ Nuevo” emerald
- Clientes especiales: **ahora usa modal** (mismo patrón que Pedidos, 2026-08-16). El pedido general de unificar CTA/focus en el resto de secciones sigue pendiente.
- Pedido general: misma estructura de modal (layout, CTA emerald salvo peligro explícito, focus zinc) en todas las secciones.

**f. Historial completo** — scrollbar blanca + fondo demasiado oscuro (ver 1.11). `[!]`

**g. Asistencia** `[!]`
- Se ve muted/deshabilitada pero **sigue siendo clickeable** y abre el modal. Pedido: o se deshabilita de verdad, o no se muestra como desactivada.

**h. Stock → Nuevo conteo** `[!]`
- Visual del modal OK, pero al scrollear el listado **se ve por detrás del searchbar** (header/search no opaco / no sticky sólido).

Secciones recorridas en 1.2:
- [x] Panel de administración (productos) — con mejoras c + 1.3
- [x] Gestión de locales — notas en 1.4
- [x] Cajeras — notas en 1.5
- [x] Carniceros / Empleados — notas en 1.6
- [x] Fiados — paleta (b)
- [x] Clientes especiales — modal inline (e) + sync (1.8)
- [x] Pedidos — notas en 1.9
- [x] Proveedores — notas en 1.10
- [x] Historial completo — notas en 1.11
- [x] Asistencia — (g)
- [x] Stock nuevo conteo — (h) + 1.13
- [x] Stock historial — notas en 1.13

### 1.3 Catálogo — Panel de administración

**Estado: OK en lo testeado** `[x]`

- [x] Solo productos activos (eliminados no visibles)
- [x] Buscar nombre / PLU
- [x] Nuevo producto (PLU, categoría, unidad, precio)
- [x] Toggle mismo precio en todos / por local al **crear**
- [x] Editar producto
- [x] Eliminar = modal custom (no Windows)
- [x] Tras eliminar desaparece
- [x] Recrear con mismo PLU (PLU liberado)

**Mejora pendiente** `[!]`
- Edición de **precios** hoy aplica solo al local elegido. Pedido: igual que al crear, poder aplicar el cambio a **un local, varios, o todos**, o precios distintos por local, sin repetir el flujo N veces.

### 1.4 Gestión de locales

**Recorrido hecho; comportamiento a cambiar** `[!]`

- [x] Crear local
- [x] Editar
- [x] Eliminar con mensaje simple
- [!] Lista **Eliminados** inconsistente para el usuario: si el local no tenía datos asociados se borra del todo y **no aparece** en eliminados; si tenía datos, sí aparece. Pedido: no explicar archivado técnico. Opción en header tipo **Configuración → “Ver locales eliminados”** (checkbox, **off por defecto**). Sin esa opción, no mostrar la sección.

### 1.5 Cajeras

- [x] Listar
- [x] Crear
- [x] Activar / desactivar
- [!] **Quitar** “Editar locales autorizados” (botón Locales). Las cajeras pueden trabajar en **todos** los locales (casi siempre uno, rara vez cambian). No filtrar por authorizedStores en este sentido.
- [!] Fusionar **Cajeras + Carniceros** en **una sola sección Empleados**, misma UI/UX, **listas separadas** (no mezclar personas). Carniceros: **no cambiar la lógica** actual (siguen sin cuenta de login). Preparar UI por si mañana tienen usuario.
- [!] Al crear un local en una ventana, la otra no lo ve hasta ↺ manual. Pedido: **al entrar/salir de cada sección, refrescar datos** automáticamente.

### 1.6 Carniceros / Empleados

- Cubierto en 1.5 (fusión + refresh al navegar).
- Liquidación / CRUD empleados: no hay hallazgos extra en este bloque (queda subsumido en la fusión).

### 1.7 Fiados

- Recorrido visual: paleta ruidosa (ver 1.2.b). Funcional no detalló bugs nuevos en este mensaje.

### 1.8 Clientes especiales

- [x] CRUD / precios se ven en **admin**
- [!] Precios actualizados en admin **no aparecen en la UI de cajera** (ventana con sesión cajera abierta después del cambio), **ni siquiera con ↺** en la pantalla principal de cajera. Sync/refresh roto o incompleto para precios especiales.

### 1.9 Pedidos

- [!] **Esconder** el botón “marcar como listo” (es de carniceros; hoy no tienen app). **No borrar la lógica.**
- [!] Reemplazar “marcar como entregado” por **Cobrar** (o similar): redirige al POS de cajera; al armar el ticket del pedido, **descontar la seña** del total (ej. $60.000 − seña $50.000 → cobrar $10.000). Al confirmar el pago, el pedido pasa a **entregado** automático.

### 1.10 Proveedores

- [!] Interfaz **vieja**: actualizar a paleta zinc/emerald de la app.
- [!] Alta de proveedor: teléfono **sin** formateo numérico (acepta espacios y letras). Al **editar**, el teléfono previo **no aparece** (campo vacío).
- [!] Pago a proveedor poco intuitivo si hay que ir a **Historial**. Pedido: acción más directa (desde la fila / card del proveedor).
- [!] “Archivar” → para el usuario debe ser **Eliminar**, sin aclaraciones técnicas de archivado.

### 1.11 Historial completo

- [!] Scrollbar blanca + fondo demasiado oscuro (1.2.f).
- [!] **Bug de señas vs cierre** — análisis abajo. El usuario **no está equivocado**.

#### Análisis señas / cierre / historial (no es un error de procedimiento)

Flujo que hiciste:
1. Pedido A: seña $40.000 → cancelás → se registra gasto **Devolución de seña $40.000**.
2. Pedido B: seña $30.000 ($20.000 efectivo + $10.000 débito) → **no** cancelado.
3. Cierre de caja: **Efectivo esperado $20.000** (y vos declaraste $0 al cerrar rápido).
4. Historial del mismo turno: Ventas 0, Gastos −$40.000, **Señas (0)**, Efectivo esperado **−$40.000**.

**El cierre de caja está bien.** Cuenta:
- Señas en efectivo: $40.000 (A) + $20.000 (B) = $60.000
- Menos devolución $40.000
- Quedan $20.000 de la seña en efectivo del pedido B  
(El débito $10.000 no entra al efectivo esperado.)

**El historial está mal** (o incompleto). En detalle:
- El tab **Señas** no lista el pedido B (debería).
- El efectivo esperado del historial **no suma señas en efectivo**; solo hace `apertura + ventas efectivo − gastos` → 0 + 0 − 40.000 = −40.000.
- Causa probable (código, para cuando se implemente):
  1. **Historial remoto / Firestore** (`historyFirestore.ts`): `deposits: []`, `cashDeposits: 0`, `cashInHand` sin señas. Pedidos/señas **no se pushean** a Firestore como parte del detalle de turno. Si el admin mira historial en otra sesión/`electron:remote`, ve gastos (sí sync) y **cero señas**.
  2. Aun en SQLite local, el detalle de historial calcula `cashDeposits` con `depositMethod === 'cash'` y **no parsea** `depositPayments` (el JSON mixto efectivo+débito). El **cierre de turno sí** parsea `depositPayments`. Misma data, dos fórmulas.
- Extra UX: el cierre cuenta **2 pedidos / $70.000** incluyendo la seña del pedido **ya cancelado** (el cancel no pone `depositAmount` en 0; la devolución va por gasto). La plata cierra, pero el rótulo “2 pedidos” puede confundir.

Conclusión: procedimiento OK; hay que corregir historial (señas + efectivo esperado) y, si aplica, el copy del cierre sobre pedidos cancelados.

### 1.12 Asistencia

- Cubierto en 1.2.g (muted pero clickeable).

### 1.13 Stock

**Nuevo conteo**
- [x] Modal visual OK (salvo searchbar transparente, 1.2.h)
- [!] En la lista aparecen **ofertas** (ej. “asado por 2 kg”) que no deberían contarse como stock. Pedido: filtrarlas **sin complejizar** (decidir criterio simple: categoría, flag, o no listar productos que no son “corte/unidad de inventario”). Pendiente definir la regla más simple.
- [!] UX de kilos: el carnicero anota un valor, después **suma** tiras que encuentra y **resta** ventas de último momento, sin calculadora. Pedido: campo kg + botones **+ / −** que abren un campo chico para el delta (ej. 10 kg → +2 → 12 → −3 → 9).

**Historial de conteos**
- [!] En el **detalle** de un conteo guardado: **buscador** para filtrar productos de esa lista.

### 1.14 Operar como cajera (admin en POS)

- [ ] Aún no reportado en esta tanda (dejar intacto).

**Notas / bugs Parte 1 (resumen ejecutivo)**

```
BUG-ZOOM-01     Atajos Ctrl+/- cambian zoom visual; modal Ajustes no refleja el valor
UX-HUB-01       Autoscroll al expandir GroupTile (Stock/Empleados)
UX-HUB-02       Salto de layout / parpadeo blanco por aparición de scrollbar
UX-HDR-01       Header de sección apretado a la izquierda; atrás poco evidente (fondo + flecha)
UX-PAL-01       Fondo menos negro; acentos que destaquen sin chocar (fiados, filtros)
UX-MOD-01       Unificar modales (CTA emerald; clientes especiales en modal no inline)
FEAT-CAT-01     Header tabla productos sticky + columnas ordenables
FEAT-CAT-02     Editar precios: aplicar a uno / varios / todos los locales
UX-STO-01       “Ver locales eliminados” opt-in en header; default off
FEAT-EMP-01     Fusionar Cajeras+Carniceros, mismas UI, listas separadas; quitar Locales autorizados
FEAT-NAV-01     Refresh automático al entrar/salir de cada sección
BUG-SC-01       Precios cliente especial no llegan a UI cajera ni con ↺
FEAT-ORD-01     Esconder “listo”; “entregado” → Cobrar en POS descontando seña → marca entregado
UX-PROV-01      Paleta nueva; teléfono formateado + valor al editar; pago más directo; “Eliminar”
BUG-HIST-01     Historial no muestra señas ni fiados ni los suma al efectivo esperado (el cierre sí cuenta señas). Segunda pasada: incluirlos en el detalle; si se anulan, **seguir visibles como anulados** (auditoría), no borrarlos ni “hacer como si no existieron”.
UX-ATT-01       Asistencia muted pero clickeable
UX-CNT-01       Searchbar conteo deja ver ítems detrás al scroll
FEAT-CNT-01     Excluir ofertas del conteo (regla simple TBD)
FEAT-CNT-02     +/- deltas de kg durante el conteo
FEAT-CNT-03     Buscador en detalle de conteo guardado
```

---

## PARTE 2 — Cajera solo (Desktop)

> Recorrida completa **2.1–2.11** (2026-08-15). Ítems no mencionados = OK (incluido 2.8 Conteo).

### Hallazgo 2026-08-14 (corregido en código)

- **BUG-SHIFT-01** Turno abierto fantasma: al operar como admin/cajera quedaba un turno `closedAt=null` en SQLite. Otra ventana/PC no lo veía (no se reconciliaba con Firestore). Cerrar un turno *nuevo* en la otra ventana no cerraba el original. La cajera seguía viendo “Ya hay un turno abierto (Admin Prueba)”.
  - Fix: `reconcileStoreShifts` antes de abrir/consultar turno; admin puede **Cerrar el turno de X**; “Volver a comprobar”; admin → POS retoma su turno abierto.

### 2.1 Flujo de turno

- [x] Selector de local — **nota:** 1.5 pide que cajeras puedan todos los locales; este ítem se actualizará al implementar FEAT-EMP-01
- [!] **Estado seleccionado casi invisible.** En el picker de local (y el mismo patrón en Mañana/Tarde al abrir turno): el elegido y el resto tienen el **mismo fondo**; solo cambia que el texto es un blanco un poco más fuerte. Pedido: estado activo claro (borde/fondo emerald o relleno distinto, no solo `font-weight` / brillo del texto). Captura de referencia: botones Mañana/Tarde idénticos en gris.
- [x] Abrir turno
- [x] POS carga catálogo
- [x] Barra superior

### 2.2 POS — diseño y venta

- [x] Checkout sticky / TOTAL / cobro funcional
- [!] **Input hero:** el checklist decía “estilo Raycast para escanear/buscar”. **No es un buscador de productos** (no se puede escribir “vacío”). El usuario **no quiere** que lo sea: la búsqueda de producto vive en **Menú → Lista de productos**. El hero queda para escanear / flujo de venta, no para buscar por nombre.
- [!] Al **cargar un producto al ticket** (manual): **no mostrar** toast/mensaje de confirmación tipo “X agregado al carrito”.
- [!] Quitar ítem del ticket: **solo una cruz**, sin texto “Eliminar”.
- [!] Botón cobro: hoy dice algo como “Cobrar y Finalizar” + hint **Enter**. Enter **no hace nada** y **no debe hacerlo**. Quitar el texto “Enter”. El botón debe decir solo **Cobrar**.

### 2.3 Carga manual

- [x] Botón Manual visible
- [x] Dropdown abre hacia abajo; Vacío visible; scroll OK
- [x] Foco a Peso (kg) al elegir producto
- [x] Kg / unidad / ítem al ticket
- [!] Al abrir carga manual, pestaña default = **PLU + precio** (no Código manual). **Intercambiar** el orden de las pestañas: PLU + precio a la izquierda, Código manual a la derecha.
- [!] Teclado en dropdown de sugerencias: flecha abajo / **Tab** deben navegar las opciones; **Enter** confirma la seleccionada (sin mouse). Hoy Tab parece enfocar la primera opción y **el menú se cierra** al toque. Agilizar carga.
- [!] Etiqueta de **precio especial**: al hover el cursor pasa a puntero + “?”. No hay tooltip ni clic útil, y **no se quiere**. Quitar el cambio de cursor (`cursor-help` / `cursor-pointer`).

### 2.4 Fiado desde cajera

- [x] Cobrar → fiado → cliente → confirma (venta OK; saldo del cliente sube en admin)
- [!] **Sync pago admin → cajera roto.** Caso Tomas Holgado:
  - Admin (remoto): pago parcial **$10.000** (15/8 4:16) sobre deuda **+$23.000**; saldo **$13.000**; historial con cancelación previa de $7.000 y deudas viejas.
  - Cajera (tras actualizar la sección): sigue **$28.000**; historial incompleto (solo +$23.000 y +$5.000; no ve el pago ni la cancelación). Fechas acordadas distintas (21/7 vs 24/7).
  - Log remoto: el pago **sí se pusheó** a Firestore (`[ipc:add-debt-payment]` + `Customer debt events pusheados { count: 1 }`). La cajera no lo baja / no lo aplica al ledger local. Relacionado con sync de `customerDebtSync` (no solo ↺ de UI).

### 2.5 Sidebar y menú

- [x] Accesos y colores (salvo lo de abajo)
- [!] **Menú / Ajustes:** debe ser **uno u el otro**, no ambos. Ajustes podría quedar para cosas futuras (ej. tema claro/oscuro, no implementado). Hoy no duplicar el mismo panel.

### 2.6 Vales

- [x] Modal abre; modo efectivo funciona (adelanto en efectivo **sí** baja caja — correcto)
- [!] **Modo Con productos — UX:** el selector de producto debe ser **campo con autocompletado** como la carga manual de Ventas. Tras elegir, **focus a Peso**. El campo siguiente es **precio total** (no precio/kg): peso completa precio y viceversa, igual que Ventas. Checkbox de **precio diferido** como en Ventas. Botón **“+ Agregar ítem” → “Confirmar”** (Enter también confirma y suma al listado del vale; no hablar de “carrito” en la UI).
- [!] **Vale en productos ≠ gasto de caja.** Adelanto en **efectivo**: sí es gasto, descuenta el efectivo esperado (ej. $1.000.000 − $10.000 = $990.000). Vale de **productos** (ej. 2 kg de asado = $50.000): **no** es plata que salió de la caja; es un adelanto en mercadería que se compensa después (típicamente descuento de sueldo). **No** debe registrarse como gasto ni bajar el efectivo esperado en tiempo real.

### 2.7 Gastos y pago a empleado

- [x] Registrar gasto (salvo validación de abajo) / lista de gastos del turno
- [!] **Total entregado al proveedor = 0 (o vacío) debe ser válido.** Caso: visita de $1.000.000, entregado $0, nota “No pagué nada”. Hoy el form rechaza con “Ingresá el total entregado al proveedor.” Es un caso real (el proveedor deja mercadería y no se le paga en el momento).
- [!] **Pago a empleado:** tras pagar a alguien en esta sesión, **sacarlo de la lista** (al menos hasta cerrar el turno / esta sesión) para no volver a ofrecerlo. El modal de confirmación de pago tiene **CTA/cerrar con azul de paleta vieja** — pasar a zinc/emerald como el resto.
- [!] Al **cambiar de empleado** en la lista, el modal **parpadea**: se achica y agranda en un instante (casi siempre). Causa probable: el contenido cambia de alto y el modal se re-centra/re-layout. Estabilizar altura o no animar el tamaño.

### Logs `pnpm electron:remote` (2026-08-15, no bloquean el testeo)

No son “esperados” como ruido inocuo; anotar para cuando se toque sync:

- **BUG-CAT-PULL-01** `UNIQUE constraint failed: products.plu_number` al hacer pull del catálogo en la DB remota (`desktop-remote-admin`). Firestore más completo (103 vs 34) → pull aborta. Mismo error en varios `storeId` (`local1` y UUIDs). Causa probable: upsert por `id` pero el PLU ya existe en **otro** `productId` local.
- Precios de cliente especial omitidos: `Precio sin producto local` (productIds que no están en el SQLite remoto) — encaja con BUG-SC-01 / catálogo incompleto por el pull fallido.
- Un local sin precios (`3110e845-…`): “Catálogo local más completo — publish” y después “Sin productos con PLU y precio — publicación omitida”.
- El pago de fiado del admin **sí** se subió; el problema de la cajera es el **pull**, no el push.

### 2.8 Conteo (cajera)

- [x] Desde menú — OK (no reportado = funcionó).

### 2.9 Ventas del turno

- [x] Lista coherente con lo vendido
- [!] Interfaz **vieja** (paleta/componentes). Actualizar al diseño actual (zinc/emerald, mismos modales).
- [!] El label **“Turno”** no es intuitivo. Decisión: probar **“Ventas del turno”** (más texto; ver cómo queda en el sidebar). Evitar “Caja” (se confunde con cierre).

### 2.10 Cierre de turno

- [x] Flujo de cierre / resumen funciona (señas en cierre OK; historial no — ver 1.11)
- [!] Pantalla de cierre con **interfaz vieja**. Actualizar al resto de la app.
- [!] Al entrar: **parpadeo / pantallazo blanco** y después la UI correcta (mismo patrón UX-HUB-02 / transiciones).
- [!] **Cancelar** (seguir con caja abierta) tarda un toque en volver a Ventas. Achicar el delay.
- [!] Modal **“¿Cerrar el turno ahora?”** queda centrado respecto al **formulario largo** (hay que scrollear para verlo bien), no respecto a la **ventana visible**. Debe ser overlay fijo al centro de la pantalla (`position: fixed` / portal al viewport), no al centro del contenido scrolleable.
- Captura: efectivo esperado **negativo** (ej. `$-1.630.400`). No reportado como ítem aparte; probable efecto de BUG-VALE-01 / gastos. Verificar al corregir vales.

### 2.11 Animaciones

- [!] Login → selector/POS: **no se percibe transición suave**; hay **parpadeo blanco** entre pantallas. Mismo síntoma que cierre de turno y salto de scrollbar.
- [ ] **Modales: fade overlay + entrada suave** — el usuario no está seguro de haberlo notado. Dejar **pendiente de verificar** (no dar por OK ni por roto). Qué debería verse (criterio):
  1. Al abrir un modal, el resto de la app se oscurece **de a poco** (~150–250 ms), no en un corte seco.
  2. El recuadro del modal aparece en el **centro de la ventana** (lo que se ve, no el scroll) y entra con una animación corta (opacidad + un leve movimiento hacia arriba o escala 0.97→1).
  3. Al cerrar, lo inverso: el recuadro se va y el overlay se aclara, también suave.
  4. Si el modal “ explota” de golpe, o el fondo pasa a negro instantáneo, o hay un flash blanco: **no cumple**.

**Parte 2 cerrada** (2.8 OK).

**Notas / bugs Parte 2 (resumen ejecutivo, 2026-08-15)**

```
UX-POS-01       Hero no es buscador de productos (OK así; búsqueda = Menú → Lista)
UX-PICK-01      Local / Mañana-Tarde: el seleccionado debe verse claro (no solo texto más blanco)
UX-POS-02       Sin toast al agregar ítem al ticket
UX-POS-03       Quitar ítem = solo cruz, sin “Eliminar”
UX-POS-04       Botón solo “Cobrar”; quitar hint Enter (Enter no debe cobrar)
UX-MAN-01       Default tab PLU + precio; intercambiar orden con Código manual
UX-MAN-02       Tab/flecha/Enter en dropdown de sugerencias (hoy Tab cierra el menú)
UX-MAN-03       Precio especial: no cambiar cursor al hover
BUG-DEBT-01     Pago/cancelación de fiado en admin no llega a cajera ni al actualizar
UX-PLU-01       Ventas → Manual → PLU + Precio: al escribir un nombre con dígito (ej. “Asado x2kg”) el campo “PLU o nombre” se reemplaza por ese dígito. No tocar ahora.
BUG-PROV-SYNC-01 **Retesteado OK 2026-08-17:** cajera ya no ve la deuda si el admin la saldó. Si reaparece, es regresión.
UX-PROV-02      Admin → Proveedores → Historial de movimientos: filtro **desde / hasta**. `hasta` ≤ hoy (nunca fecha futura). Display **dd/mm/aaaa**. No implementar ahora.
UX-MENU-01      Menú o Ajustes, no ambos
UX-VALE-01      Vale con productos: autocomplete + peso/total + diferido + Confirmar/Enter
BUG-VALE-01     Vale en productos no debe ser gasto ni bajar efectivo de caja. Confirmado otra vez en 3.3.5.
FEAT-VALE-CANCEL-01 Anular un vale (cajera lo registró y el empleado se arrepiente). Hoy no hay forma. Segunda pasada; al anular: no debe seguir descontando caja (si era efectivo) ni liquidación; el registro queda visible como anulado (auditoría).
FEAT-HIST-VALE-01 Historial completo → detalle de turno: pestaña **Vales** (no mezclar con Gastos). Ver nota 3.3.5.
BUG-CASH-01     Al anular una venta, el “en caja” del POS se actualiza con delay (segundos). Debe ser instantáneo. Caso: venta $1000, pagó $500 + fiado $500; al anular, los $500 de efectivo tardan en descontarse.
BUG-EXP-01      Permitir total entregado al proveedor = 0 / vacío
UX-PAY-01       Empleado ya pagado en la sesión sale de la lista; CTA confirmación a paleta nueva
UX-PAY-02       Parpadeo del modal al cambiar de empleado (resize)
UX-SHIFT-01     Modal “Turno”: paleta vieja; renombrar a “Ventas del turno”
UX-CLOSE-01     Cierre: paleta vieja; flash blanco al entrar; delay al Cancelar
UX-CLOSE-02     Modal confirmar cierre anclado al viewport, no al scroll del form
UX-TRANS-01     Transiciones con flash blanco (login→POS, cierre, etc.)
UX-MODAL-01     Fade overlay + entrada suave: pendiente de notar (criterio en 2.11)
BUG-CAT-PULL-01 Pull catálogo remoto falla UNIQUE plu_number (electron:remote)
```

---

## PARTE 3 — Sync simultáneo (Admin + Cajera, 2 sesiones Desktop)

**Setup:** Terminal 1 = `pnpm dev:prod` (cajera). Terminal 2 = `pnpm electron:remote` (admin). Ambas con internet.

Cómo están aislados (no es la misma PC “con dos ventanas sobre el mismo SQLite”):
- **`dev:prod`:** SQLite en el `userData` normal de Electron (`…/app.sqlite`). Es “la PC de la carnicería”.
- **`electron:remote`:** otro `--user-data-dir` (`%APPDATA%/@carniceria/desktop-remote-admin`). SQLite, sesión y secretos **aparte**. Es “la PC de casa / otra máquina”.
- Lo que se ve en common **no** es porque compartan disco: cada uno sube/baja por **Firestore**.
- Remote pide que `dev:prod` esté levantado solo porque reutiliza Vite en `localhost:5173` (el HTML/JS). Eso es atajo de desarrollo, **no** cruce de datos. En un `.exe` instalado en otra PC no hace falta Vite.

**Catálogo (regla vigente, ago 2026 — reemplaza last-write-wins):** sync por **merge**, no por snapshot que pisa.
- Altas en cualquier dispositivo se unen.
- Precio / nombre / PLU: gana el dato **más nuevo por ítem**.
- **Visibilidad por local:** toggle "Disponible" OFF = no se vende en ese local; el producto sigue en la lista admin y en los otros locales. El PLU **no** se libera.
- **Quitar del catálogo** (Editar → zona de peligro): baja global, desaparece de todos los locales y **libera el PLU**. Usarlo para productos de prueba o fichas que no deberían existir. No usarlo si el producto se vende en otro local.
- Después del merge se republica el conjunto.
- Crear / editar / cambiar precio también mergean **antes** de subir.
- **No** se espera que una PC con lista corta borre el resto al ↺. Si pasa, es bug.
- Para ver un alta hecha solo en remote (ej. Prueba 999 / PLU 999): ↺ **primero** en `electron:remote` (donde sigue existiendo) y **después** ↺ en `dev:prod`.

**Backup/rollback de catálogo (FEAT-CAT-03):** no está; no testear. Anotado para más adelante.

Hallazgos ya vistos (no reabrir como “nuevo” si se repiten):
- [!] Crear local en una ventana → la otra no lo ve hasta ↺ (→ FEAT-NAV-01)
- [!] Precios cliente especial admin → cajera no, ni con ↺ (→ BUG-SC-01)
- [!] Pago/cancelación de fiado en admin no llega a cajera (→ BUG-DEBT-01)
- [x] Pago de proveedor en admin → cajera deja de ver la deuda (BUG-PROV-SYNC-01 retesteado OK 2026-08-17)
- [!] Pull UNIQUE `plu_number` en remote (→ BUG-CAT-PULL-01). El merge ahora libera PLU en conflicto: **re-testear**; si no revienta, marcar OK.
- [!] 2026-08-15: crear desde remote **pisó** Firestore (34/35 vs ~103). Con merge **no debería volver a pasar**. Si al crear TEST-SYNC-PROD desaparece el catálogo largo, es regresión.

### 3.1 Maestros compartidos (admin escribe → cajera lee)

| # | Admin hace | Cajera verifica | Esperado |
|---|---|---|---|
| 3.1.1 | Crear empleado TEST-SYNC-EMP | Menú/Vales → lista | Visible tras ↺ o en segundos (listener) |
| 3.1.2 | Editar sueldo de ese empleado | Vales → resumen semanal | Sueldo nuevo en totales |
| 3.1.3 | Archivar empleado | Vales → lista activa | Desaparece |
| 3.1.4 | Renombrar un local | Selector / barra POS | Nombre nuevo |
| 3.1.5 | Crear producto TEST-SYNC-PROD, PLU único (ideal: desde **dev:prod**; si se crea en remote, ↺ remote y después ↺ cajera) | Manual / lista productos | Producto **y** el resto del catálogo (no se achica la lista) |
| 3.1.6 | Cambiar precio de un producto **que exista en ambos** | Vender ese producto | Precio nuevo en ticket (el más reciente gana) |
| 3.1.7 | Desactivar el producto de prueba **en este local** usando el toggle "Disponible" (pasa a OFF) | Buscar PLU/nombre en la **vista cajera** de ese local (↺) | Producto **no aparece** para esa cajera; en el otro local sigue visible |
| 3.1.7b | Reactivar el producto (toggle "Disponible" vuelve a ON) | Vista cajera del mismo local (↺) | Producto vuelve a aparecer |
| 3.1.7c | Quitar del catálogo un producto de prueba (Editar → "Quitar del catálogo" → confirmar) | Buscar PLU/nombre en **ambas** sesiones y ambos locales | Desaparece de todos los locales y el PLU queda libre para reutilizar |
| 3.1.8 | ~~Quitar local autorizado a la cajera~~ | — | **No testear.** Decisión: las cajeras operan en **todos** los locales (FEAT-EMP-01). El filtro `authorizedStores` se va a quitar; si hoy el selector aún filtra, es deuda conocida, no el comportamiento objetivo. |

- [x] 3.1.1
- [x] 3.1.2
- [x] 3.1.3
- [x] 3.1.4
- [x] 3.1.5
- [x] 3.1.6
- [x] 3.1.7 (toggle off per local)
- [x] 3.1.7b (toggle on — reactivar)
- [x] 3.1.7c (quitar del catálogo / liberar PLU)
- [x] 3.1.8 — **N/A** (feature a eliminar, no a validar)

### 3.2 Operación compartida (admin ↔ cajera)

| # | Quién escribe | Dónde verificar | Esperado |
|---|---|---|---|
| 3.2.1 | Admin crea pedido TEST-SYNC-ORD **asignándolo a un local específico** (selector en el form; default = tab activa) | Cajera → Pedidos en **ese local** | Visible en la tab del local asignado; no aparece en tabs de otros locales |
| 3.2.2 | Cajera o admin cambia estado | La otra sesión | Estado actualizado. **Nota:** “marcar listo” se va a **esconder** (FEAT-ORD-01), no borrar lógica. Preferir estados que sigan visibles. |
| 3.2.3 | Admin crea cliente fiado + deuda | Cajera → Fiados | Cliente y saldo |
| 3.2.4 | Cajera cobra fiado (si aplica) | Admin → Fiados | Saldo baja. **OK 2026-08-16.** El cobro ahora **pide medio de pago**; si es efectivo, suma a caja en vivo / efectivo esperado. |
| 3.2.5 | Admin crea cliente especial + precio (modal; **sin asignar local** — es global) | Cajera → Clientes especiales | El cliente y sus precios de referencia aparecen en **todos** los locales. **No** se aplican al carrito: la cajera los consulta si el ticket no coincide con el precio de lista. |
| 3.2.6 | Admin registra deuda proveedor | Admin remote → deuda combinada | Cross-local coherente. **OK 2026-08-17.** |
| 3.2.7 | Admin registra pago proveedor | Misma pantalla **y** cajera → Gastos | Saldo baja en admin **y** la cajera deja de ver la deuda. **OK 2026-08-17** (BUG-PROV-SYNC-01 cerrado). Mejora UI diferida: UX-PROV-02. |
| 3.2.8 | Admin **sin turno abierto** crea pedido con seña (recibió transferencia fuera de horario) | Pedido guardado; seña registrada | No debe bloquearse — admin puede registrar señas sin caja abierta |

- [x] 3.2.1
- [x] 3.2.2
- [x] 3.2.3
- [x] 3.2.4 — OK; medio de pago en cobro de fiado implementado. UX-PLU-01 anotado (no tocar ahora).
- [x] 3.2.5 — criterio corregido (solo consulta, no aplica al carrito). UI: modal + cliente global.
- [x] 3.2.6
- [x] 3.2.7 — retesteado OK; UX-PROV-02 (filtro fechas historial proveedor) diferido
- [x] 3.2.8

### 3.3 Cajera opera → Admin ve (Firestore push)

| # | Cajera hace | Admin verifica (ideal: electron:remote) | Esperado |
|---|---|---|---|
| 3.3.1 | Abrir turno nuevo | Historial → turno **abierto** (badge “Abierto”, arriba de la lista) | Aparece (puede tardar; ↺). Incluye turnos con `closedAt` null. Si bloquea por turno fantasma, ya hay fix BUG-SHIFT-01. |
| 3.3.2 | Confirmar 1 venta en efectivo | Historial → detalle turno | Venta + monto **OK**. Señas **y** fiados **no** aparecen ni suman (BUG-HIST-01). Segunda pasada: mostrarlos; anulados **visibles como anulados** (auditoría). POS: anular venta debe actualizar “en caja” al instante (BUG-CASH-01). |
| 3.3.3 | Registrar gasto | Detalle turno → gastos | Gasto listado |
| 3.3.4 | Vale **en efectivo** a TEST-SYNC-EMP | Empleados → Liquidación | Vale suma en la semana **y baja caja** (correcto) |
| 3.3.5 | Vale en local A; repetir en local B | Liquidación (todos los locales) | Suma de ambos **OK**. Vale **en productos** sigue bajando caja / aparece en Gastos (BUG-VALE-01). UI diferida: FEAT-HIST-VALE-01. |
| 3.3.6 | Cerrar turno | Historial → turno cerrado | Totales coherentes |

Nota: el modal Vales de la cajera lee SQLite **de esa PC**; la Liquidación admin mezcla local + remoto. Si el vale está en liquidación pero no cruzado en el modal cajera de la otra PC, anotar como **limitación** vs bug.

- [x] 3.3.1
- [x] 3.3.2 — venta OK; BUG-HIST-01 (señas + fiados; anulados **visibles** para auditoría) y BUG-CASH-01 (delay al anular)
- [x] 3.3.3
- [x] 3.3.4
- [x] 3.3.5 — liquidación cross-local OK; BUG-VALE-01 confirmado; FEAT-HIST-VALE-01 y FEAT-VALE-CANCEL-01 diferidos
- [x] 3.3.6

### 3.4 Admin remoto “desde cero” (smoke de sync real)

Con `electron:remote` (SQLite aparte = simula otra PC), solo login admin:

- [x] Historial muestra turnos/ventas de la PC cajera (sin haber operado en remote). **Señas en historial:** puede fallar (BUG-HIST-01).
- [x] Pedidos creados en PC principal aparecen.
- [x] Fiados / Proveedores / Clientes especiales tienen datos de la operación principal. Fiados: si el pago se hizo en admin y remote/cajera no lo ven → BUG-DEBT-01.
- [x] Empleados listados (sync maestro).
- [x] Liquidación muestra vales de la PC cajera.
- [x] **Catálogo:** la lista debe ser la **completa** (merge), no la corta de 34. Productos dados de alta en cualquier lado deben estar. Si UNIQUE PLU o lista recortada → regresión.

### 3.5 Resiliencia offline (opcional)

**Diferida** — no testear ahora. Se hará en el futuro.

| # | Acción | Esperado |
|---|---|---|
| 3.5.1 | Cortar internet en cajera → vale → volver internet → ↺ admin liquidación | Vale eventualmente visible |
| 3.5.2 | Cortar internet → venta → volver internet → ↺ historial admin | Venta aparece |
| 3.5.3 | Admin offline abre sección que requiere Firestore | Mensaje claro, no crash |

- [ ] 3.5.1–3.5.3 — **salteada 2026-08-17**; no bloquea Parte 4

**Notas / bugs Parte 3 (backlog — segunda pasada, no re-testear ahora):**

- **3.1, 3.2, 3.3 y 3.4 cerradas.** 3.5 opcional **salteada**. Parte 3 no bloquea Parte 4.
- UX-PLU-01: campo “PLU o nombre” en venta manual reemplaza el texto al tipear un dígito. No implementar ahora.
- 3.2.4: cobro de fiado ahora exige medio de pago; efectivo entra a caja en vivo.
- 3.2.5: clientes especiales son globales (sin local) y solo informativos; alta/edición en modal.
- 3.2.7 OK; UX-PROV-02 diferido (filtro desde/hasta en historial de proveedor; `hasta` ≤ hoy; dd/mm/aaaa).
- 3.3.1 OK (turnos abiertos en historial).
- BUG-HIST-01 confirmado: historial **no** cuenta señas ni fiados. Segunda pasada: mostrarlos en el detalle; si se anulan, **quedan visibles como anulados** (auditoría), no desaparecen.
- BUG-CASH-01: anular venta (ej. $1000 con $500 efectivo + $500 fiado) descuenta bien la caja pero **con delay**. Segunda pasada: refresco instantáneo del “en caja” del POS.
- BUG-VALE-01 confirmado en 3.3.5: vale en **productos** no debe bajar caja ni listarse como gasto operativo. Vale en **efectivo** sí. Segunda pasada + FEAT-HIST-VALE-01 (pestaña Vales).
- FEAT-VALE-CANCEL-01: poder anular un vale si el empleado se arrepiente. Hoy no existe. Anulado = visible para auditoría; deja de afectar caja/liquidación.
- 3.3.5 liquidación: vales de distintos locales se suman bien.
- `electron:remote` = otra PC (otro `userData`/SQLite). Comparte Vite con `dev:prod` solo para servir la UI; los datos cruzan por Firestore.

---

## PARTE 4 — Admin móvil solo (Fase A)

URL hosting, login admin, con internet.

### 4.1 Hub y navegación

- [ ] Tras login admin → hub de tiles (**no** el POS de cajera).
- [ ] Secciones: Operación, Empleados, Análisis, Configuración.
- [ ] Paleta zinc/emerald coherente con desktop (mismos pedidos UX-PAL-01 / UX-MOD-01 si se ve paleta vieja).
- [ ] Botón ↻ del header recarga locales.
- [ ] Banner “Sin conexión” en avión.
- [ ] Salir cierra sesión.

### 4.2 Por sección (CRUD + UI)

- [ ] Pedidos: listar, crear, cambiar estado, eliminar/cancelar. “Listo” puede seguir visible en móvil (FEAT-ORD-01 es desktop cajera); anotar si molesta.
- [ ] Fiados: clientes, saldos, cobros, alta. Sync con desktop: mismo riesgo BUG-DEBT-01.
- [ ] Proveedores: lista, deuda, pagos, archivar. Copy: para el usuario es **Eliminar**, no “archivar” (UX-PROV-01).
- [ ] Clientes especiales: CRUD + precios.
- [ ] Carniceros: CRUD, archivar/restaurar, vales (lectura).
- [ ] Cajeras: listar, activar/desactivar. **Locales autorizados:** decisión desktop = quitar (FEAT-EMP-01). En móvil el selector aún puede usar esa lista (TASKS_V1); no exigir “editar autorizados” como feature a conservar.
- [ ] Locales: crear, editar, eliminar/restaurar. “Ver eliminados” opt-in (UX-STO-01) si existe en móvil.
- [ ] Historial: turnos por local, detalle ventas + gastos + totales. Señas: mismo BUG-HIST-01 si el detalle viene de Firestore.

### 4.3 Limitaciones esperadas (no marcar bug salvo que falle lo prometido)

- No hay panel de **catálogo/productos** en móvil (solo desktop). El merge de catálogo no se opera desde acá.
- No hay conteo de stock ni asistencia en móvil admin.
- No hay liquidación semanal dedicada como en desktop (solo vales por empleado en Carniceros).

**Notas / bugs Parte 4:**

-

---

## PARTE 5 — Cajera móvil (opcional, POS respaldo)

- [ ] Login cajera → selector de local. **Objetivo:** todos los locales activos (FEAT-EMP-01). Si hoy filtra `authorizedStores`, es deuda, no el diseño final. Con 1 solo local en la lista que vea → puede saltar a abrir turno.
- [ ] Abrir turno → POS.
- [ ] Venta manual: dropdown abajo, foco en peso. (Mismos UX-MAN-01/02 si se portan: default PLU+precio, teclado en dropdown.)
- [ ] Confirmar venta → totales coherentes.
- [ ] Banner offline; al reconectar resync (catálogo/ventas pendientes). Catálogo móvil = descarga al login/reconectar, **no** en vivo.
- [ ] Cerrar turno.

**Notas / bugs Parte 5:**

-

---

## PARTE 6 — Sync Desktop ↔ Móvil (2+ dispositivos)

Admin desktop + admin móvil, o cajera desktop + admin móvil.

| # | Escritura | Lectura | Esperado |
|---|---|---|---|
| 6.1 | Desktop admin crea pedido | Móvil Pedidos (↺) | Visible |
| 6.2 | Móvil admin crea pedido | Desktop Pedidos | Visible |
| 6.3 | Móvil edita estado pedido | Desktop Pedidos | Estado igual |
| 6.4 | Desktop crea empleado | Móvil Carniceros | Visible |
| 6.5 | Móvil crea empleado | Desktop Empleados (↺) | Visible |
| 6.6 | Desktop cajera: venta + cierre | Móvil Historial | Turno + ventas (señas: BUG-HIST-01) |
| 6.7 | Desktop cajera: vale | Móvil Carniceros → vales | Listado. Distinguir vale efectivo vs productos (BUG-VALE-01) |
| 6.8 | Desktop admin: fiado nuevo | Móvil Fiados | Cliente/saldo |
| 6.9 | Móvil admin: pago proveedor | Desktop Proveedores | Deuda actualizada |
| 6.10 | Desktop admin: renombra local | Móvil hub (↺) | Nombre nuevo |
| 6.11 | Desktop: alta/precio/baja de producto | Móvil POS cajera (login o ↺ / reconectar) | Catálogo mergeado: alta visible, precio nuevo, baja **no** aparece. No hay editor de catálogo en móvil. |

- [ ] 6.1–6.11

**Notas / bugs Parte 6:**

-

---

## PARTE 7 — Regresiones rápidas (sesión de cambios)

Checklist express de lo que se tocó y de las decisiones vigentes:

- [ ] Productos eliminados invisibles en todo el sistema (baja **global**).
- [ ] PLU se libera al eliminar.
- [ ] Eliminar producto = modal custom (nunca `window.confirm` de Windows).
- [ ] Eliminar local = mensaje corto; “eliminados” solo si hay opt-in (UX-STO-01).
- [ ] Liquidación semanal sin sección “Vales (remoto)” suelta en hub.
- [ ] Vales remotos integrados en Liquidación con buscador.
- [ ] Zoom persiste entre sesiones (atajos Ctrl+/- vs modal: BUG-ZOOM-01).
- [ ] Maximizar ventana POS: layout usable en 1920×1080 o tu resolución.
- [ ] Modales (Vales, Gastos, Fiados, cierre, etc.) paleta zinc/emerald (no blue/amber/orange).
- [ ] **Catálogo merge:** crear un producto en una sesión **no** borra el resto en la otra; ↺ une las listas.
- [ ] **Catálogo merge:** borrar un producto en admin → desaparece en cajera tras ↺ (todas las PCs).
- [ ] Hero POS no es buscador (búsqueda = Menú → Lista).
- [ ] Cajeras: no validar “locales autorizados” como regla de negocio.

**Notas / bugs Parte 7:**

-

---

## Orden sugerido cuando se pase a código (no ahora)

1. UX transversal: scrollbar/salto, headers, paleta/fondo, modales unificados, refresh al navegar.
2. Bugs: zoom UI, historial señas, precios especiales → cajera, fiados admin→cajera, pull PLU (re-test post-merge), searchbar conteo, asistencia clickeable, gasto entregado=0, vale-productos vs caja.
3. Producto: fusión empleados, **quitar locales autorizados**, pedidos Cobrar−seña, proveedores, stock +/- y ofertas, precios multi-local al editar, POS (cruz/Cobrar/tabs/dropdown), vales UX, menú vs ajustes, pago empleado, modal Turno/cierre.
4. Catálogo: merge ya en código. **En vivo (listener) = BLOQUE I-A**, no ahora. FEAT-CAT-03 backup **no ahora**. Spark $0; medir Usage en jornada real.
