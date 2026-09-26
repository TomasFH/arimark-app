# Checklist de cierre 1.0 — humo de punta a punta

Convención: `[ ]` pendiente · `[x]` OK · `[!]` se rompió (anotá qué).

Esto **no** es un recuento de colores, tipografías ni copys. Es para confirmar que, después de todas las oleadas, **cada rol todavía puede operar** y que lo que escribe uno lo ve el otro.

Cuando esta checklist esté completa (sin `[!]` de función), **1.0 se da por cerrada**. Durante la pasada podés anotar mejoras de UI al final: no bloquean el cierre. El **icono de la app** queda afuera: todavía no hay imágenes.

---

## Cómo usarla

**Dónde:** PC con `pnpm dev:prod` o el instalador. Celu: Hosting [https://arimark-7f418.web.app](https://arimark-7f418.web.app) (recarga forzada si ves un bundle viejo). El APK no se actualiza con Hosting.

**Cuentas:** una cajera, un admin, un carnicero (acceso celular ya dado). Internet la mayor parte del tiempo.

**Orden sugerido** (menos logins, más lineal):

1. **Cajera en PC** (A.1–A.7) — un turno. Dejalo abierto si vas a pasar a D.1 / D.2.
2. **Admin** (C) — otra sesión o logout. Hub PC + hub celu.
3. **Carnicero en celu** (B).
4. **A la vez** (D) — cajera PC + carnicero celu + admin (PC o celu).
5. **Cajera en celu** (A.8) **después**, en otro momento. Ese turno **no** es la caja viva de la PC (esperado: DT-06). Cerrar en el celu y abrir otro en la PC si hace falta seguir en escritorio.

Si un ítem pide “también en celu” dentro de C, hacelo en el mismo bloque admin del teléfono para no volver atrás.

---



## Ya comprobado en código (2026-09-21) — no hace falta marcarlo

Corrido en este repo antes de armar el archivo:

- `pnpm test` — 100 % verde (shared 156, desktop 969 + 183, mobile 240).
- `pnpm typecheck` — verde en shared, desktop y mobile.

Eso cubre migraciones, IPC, visitas de mercadería, deudas, auth de roles, carrito de pedidos, etc. **No** cubre hardware real, Firebase en tu jornada, ni que una pantalla se haya roto al cablear otra.

Índices, reglas y backfill de deudas **ya están en producción** (`docs/FIRESTORE_DT07_DT08.md`). Al loguear la PC de prod, el job de saldos arranca solo.

---



## Fuera de esta pasada (no es bug si no está)

- Icono de la app / splash.
- Stock como inventario (Fase 8). El **conteo** de domingo sí se prueba (A y C).
- Editar catálogo de lista en el celu.
- **Misma caja en PC y celu** (post 1.0, DT-06). Expectativa 2026-09-22: si la caja está abierta en la PC y se corta la luz, el POS del celu sigue **ese** turno (las ventas ya hechas siguen ahí). Al volver la luz, la PC retoma las ventas cargadas en el celu, sin abrir otra caja. Hoy son dos turnos distintos.
- Asistencia (UI pausada).
- Elegir cliente especial **en el cobro** del POS (selector oculto; los acuerdos se ven en Menú → Clientes especiales).
- Pagar medias res “después”. Una visita media res **no** debe armar gasto ni deuda.
- Rediseño del POS celu (funciona; se ve viejo).
- **Fiar el resto** (post checklist, 2026-09-22): en cobro en efectivo, si el monto no cubre el total, un botón chico «Fiar el resto» abre el fiado con ese pago ya cargado. No es el camino por defecto: un tipeo no debe crear deuda solo.
- **Estadísticas de plata** (post checklist, sin pantallas todavía): ver `PLAN.md` «Caja y ganancia». El cobro de un fiado no se pierde: queda en el ledger. No es una segunda venta.

---



## A — Cuenta de cajera

Hacé todo esto logueada como **cajera** (o admin → Operar como cajera, si es la misma persona; el cobro y el turno tienen que ser de esta sesión).

### A.1 Entrar y abrir turno (PC)

- [ ] Login con email + contraseña. Entra al selector de local si hay más de uno; con un solo local autorizado, sigue.
- [ ] Contraseña incorrecta: mensaje claro, no entra.
- [ ] Olvidé contraseña: se puede pedir el mail (el envío real ya se vio; acá basta que el flujo no explote).
- [ ] Abrir turno: pide efectivo (y billetes si hay relevo del cierre anterior). Abre el POS. El nombre del local se ve, no el id.
- [ ] Si esta cajera **ya tenía turno abierto** en esta PC: retoma **ese** turno, no pide abrir otro ni pierde el carrito de caja.



### A.2 Vender (PC)

- [ ] Carga **manual**: buscás un producto, entra al ticket con kg o unidad y el precio de **este** local.
- [ ] Si hay lector: un escaneo suma el producto correcto. Si no hay lector, no es bloqueo.
- [ ] Cobro en **efectivo** con vuelto (le das de más). La venta queda; el efectivo en caja baja/sube como corresponde.
- [ ] Cobro mixto o con tarjeta/crédito (un caso). Cierra sin dejar el modal colgado.
- [ ] Si hay desc. efectivo del turno: en un cobro 100 % efectivo se aplica; si pagás sin efectivo, no se inventa el descuento.
- [ ] Menú → **Ventas del turno**: la venta está. **Anular** una de prueba: deja de contar en el esperado de caja.



### A.3 Fiado (PC)

- [ ] En Cobrar → fiado: nombre obligatorio, teléfono opcional, seña opcional. La venta nace fiado; el resto queda deuda.
- [ ] Menú → **Fiados**: esa cuenta se ve. Un cobro chico a esa deuda baja el saldo.



### A.4 Gastos y visita de proveedor (PC)

- [x] Gasto **sin** proveedor (luz / “qué se pagó” + monto): resta caja. El autocomplete de concepto **no** se abre solo al entrar; sí al escribir o al hacer clic de nuevo.
- [x] Visita **con** proveedor (Productos o Insumos): renglones o concepto, entregado / deuda. Confirma; caja y deuda de **este** local cuadran. Comprobante se puede cerrar.
- [x] Visita **media res**: confirma kilos **sin** crear gasto ni deuda nueva de esa visita.
- [x] Menú → **Gastos del turno**: aparecen los gastos de este turno (la media res no debería figurar como gasto).



### A.5 Resto de caja (PC)

- [x] **Ingreso** (aporte): suma caja.
- [x] **Cebo**: kg + nota; no mueve caja.
- [x] **Vales**: vale en plata a un empleado; baja caja. Vale en producto: no baja efectivo.
- [x] **Liquidación**: paga la semana de un empleado (neto = sueldo − vales). Un segundo pago la misma semana no debe duplicar.
- [x] **Saldar** proveedor de este local (si hay deuda): paga con esta caja.
- [x] **Catálogo** (cajera): cambiar **precio de este local** o “quitar de este local”. El próximo ítem del ticket usa el precio nuevo; lo ya cargado no se recalcula.
- [x] **Stock**: un conteo de prueba se guarda (no es el stock perpetuo).
- [x] **Pedidos**: crear uno con carrito (producto + kg). Aparece en Pendientes. **Listo** / **Deshacer** funcionan.
- [x] **Cobrar un pedido listo**: inyecta el carrito en el POS, descuenta seña si había, cierra la venta. El pedido pasa a entregado.
- [x] Cambiar **contraseña** logueada: entra; seguís en sesión. (No hace falta rotar la clave de prod si no querés; cancelar el modal cuenta como “abre y no rompe”.)



### A.6 Cerrar turno (PC)

- [x] Cerrar: confirmación + conteo de billetes que **quedan**. Resumen coherente (ventas, gastos, esperado).
- [x] Tras cerrar, no se puede vender hasta abrir de nuevo.



### A.7 Login offline (PC, un solo intento)

- [ ] Con esta cajera que **ya** se logueó con internet en esta PC: cortá red (o modo avión), abrí la app, mismo email/clave → entra con aviso de sesión local. Volvé internet; no te echa si la cuenta sigue activa.



### A.8 POS de emergencia (celu, cuenta cajera)

Hacerlo **aparte** del turno de PC (DT-06).

- [ ] Login cajera → selector de local (nombres, no ids) → abrir turno → POS. Un solo local: puede saltar el selector.
- [ ] Venta manual + cobro con vuelto. Totales y “en caja” se mueven.
- [ ] Fiado en Cobrar (nombre + resto deuda).
- [ ] Gasto (visita o concepto). Ingreso. Cebo. Vales. Liquidación de **esta** semana.
- [ ] Ventas del turno: anular una.
- [ ] Cerrar turno (billetes). En Historial admin/PC, ese cierre se ve con etiqueta **Móvil** (después de sync; puede ser el ítem D.2).
- [ ] Sin internet: se puede seguir vendiendo con catálogo cacheado. Al volver, sube lo pendiente.
- [ ] Atrás: cierra modal/pantalla; con la pila vacía pregunta si salir. No debe matar la app al primer atrás.

---



## B — Cuenta de carnicero

Solo **celu**. En PC, el login de carnicero debe rechazarse (está en D.3; no hace falta repetirlo acá).

- [ ] Login con el email del carnicero. **No** aparece el POS ni el hub admin.
- [ ] Si hay más de un local: pregunta en cuál está (el último queda marcado). Un tap confirma. El encabezado muestra el **nombre** del local.
- [ ] Solo ve pedidos de **ese** local.
- [ ] Se puede cambiar de local (tap en el nombre).
- [ ] Tabs **Pendientes / Listos / Entregados**. Pendientes = trabajo. Listos y Entregados = no se cobran ni se editan.
- [ ] Card: cliente, ítems, horario de retiro. No hay crear / editar / cobrar / cancelar.
- [ ] Con internet: **Listo** pide confirmación → sale de Pendientes. Se puede **Deshacer** en el aviso corto.
- [ ] Sin internet: lista de solo lectura; Listo deshabilitado; no encola para después.
- [ ] **Mi semana**: sueldo, vales de **esta** semana, neto, si ya está pagado. No ve a otros empleados. Sin internet: caché, no error técnico de Firebase.
- [ ] Un minimize corto (WhatsApp) **no** vuelve a preguntar el local. Si dejás la app ≥ 2 h o cambia el día, sí pregunta.

---



## C — Cuenta de admin



### C.1 Hub PC

- [ ] Login admin → hub (no POS directo).
- [ ] Abren y vuelven: Panel de administración, Locales, Empleados, Fiados, Clientes especiales, Pedidos, Proveedores, Historial, Stock (nuevo conteo + historial de conteos).
- [ ] **Operar como cajera** abre caja (smoke: entra al POS / pide turno). No hace falta repetir toda la sección A.
- [ ] Cerrar sesión vuelve al login.



### C.2 Catálogo (Panel de administración, PC)

- [ ] Alta de un producto de prueba (nombre, PLU, precio del local). Aparece en la lista.
- [ ] Editar precio / nombre. **Retiro global** (admin) deja de listarlo y libera PLU.
- [ ] Publica a los locales que correspondan. No hace falta cargar la balanza si no estás en el local con KRETZ; si estás, “Cargar en balanza” de un PLU no debe colgar la app.



### C.3 Locales y empleados (PC)

- [ ] Locales: se listan con nombre. Crear / editar / eliminar (soft) / restaurar. Confirmación de la app, no del browser.
- [ ] Empleados: alta/edición de carnicero (ficha sueldo). Cajeras: locales autorizados. Dar / revocar **acceso celular** de un carnicero no debe romper la lista.
- [ ] Liquidación desde Empleados (consulta de semanas): se ve pagado / pendiente alineado con lo que pagó caja.



### C.4 Operación y análisis (PC)

- [ ] **Fiados**: lista con saldo. Entrar a uno: historial. Cobrar / ajustar (ajuste de admin deja nota). No pide el ledger de toda la empresa al abrir la lista.
- [ ] **Clientes especiales**: crear uno, precio acordado de un producto del catálogo, se guarda. Editar / borrar.
- [ ] **Pedidos**: misma lista que la cajera (Listos / Pendientes). Admin puede ver Entregados y cancelados; **Eliminar** un cancelado de prueba.
- [ ] **Proveedores**: lista, deuda **combinada** de locales. Historial de uno. Saldar / registrar / compensar entre locales (un caso, si hay dos locales). El saldo de las cards **no** está en 0 si el ledger tiene plata (checkpoint ya en prod).
- [ ] **Historial**: default últimos días, no “todo el año”. Abrir un turno: ventas / gastos / fiados. Un turno **Móvil** se etiqueta.
- [ ] **Stock**: historial de conteos muestra el de la cajera (A.5) o uno nuevo de admin.



### C.5 Hub celu (cuenta admin)

- [ ] Login admin → hub. **No** es el POS. Hay Operar como cajera.
- [ ] Abren: Locales, Empleados, Fiados, Clientes especiales, Pedidos, Proveedores, Historial.
- [ ] Crear o editar **una** cosa chica (pedido o ficha) y ver que no explota. Catálogo de lista **no** se edita acá (esperado).
- [ ] Pedido con typeahead del catálogo del local (carrito, no solo un textarea).
- [ ] ↻ o reentrar refresca. Sin internet: mensaje usable, no pantalla blanca.

---



## D — A la vez (dos cuentas / dos dispositivos)

Dejá logueados: **cajera en PC** (turno abierto) + **carnicero en celu** (mismo local) + **admin** (PC remota o celu). Internet.

### D.1 Cajera + carnicero (pedidos)

- [ ] Cajera crea un pedido en PC (carrito). En el celu del carnicero de **ese** local aparece en Pendientes (unos segundos).
- [ ] Carnicero marca **Listo**. En PC, Pedidos: pasa a Listos, con *Listo por {nombre} · hora*, **sin** recargar a mano (o al volver a Pedidos).
- [ ] Cajera **Deshace** Listo en PC: el pedido vuelve a Pendientes y reaparece en el celu.
- [ ] Cajera **cobra** el pedido. Desaparece del trabajo del carnicero (ya no está pending).
- [ ] Pedido de **otro** local: el carnicero **no** lo ve.



### D.2 Cajera + admin (caja, deudas, sync)

- [ ] Cajera registra un **gasto con proveedor** (o visita que deje deuda). Admin → Proveedores: el saldo de ese proveedor **en ese local** se actualiza (↻ en celu admin; en PC admin suele llegar solo).
- [ ] Cajera registra un **fiado**. Admin → Fiados: la cuenta y el saldo coinciden.
- [ ] Cajera cambia el **precio** de un producto de su local. En otra PC (o celu POS del mismo local, si lo tenés abierto): el precio nuevo llega **sin** re-login. Un ítem ya en el ticket no cambia.
- [ ] Tras sync, Historial admin ve la venta/gasto de la cajera de hoy.
- [ ] Si corriste A.8: el cierre **Móvil** aparece en Historial admin.



### D.3 Admin + carnicero / cajera (accesos)

- [ ] Login **carnicero en PC**: lo rechaza (solo celu). Mensaje claro.
- [ ] Admin **revoca** acceso celular del carnicero (o desactiva cajera). Esa cuenta no inicia sesión en el celu; si ya estaba adentro, lo saca.
- [ ] Cajera paga **liquidación** en PC. Carnicero → Mi semana: figura pagado (con internet).
- [ ] Cajera carga un **vale**. Carnicero → Mi semana: el vale aparece en esta semana.



### D.4 Relevo de cajeras (no es simultáneo en el mismo turno)

- [ ] Cajera A cierra con billetes. Cajera B abre en el **mismo local**: la grilla viene precargada con lo que dejó A. B puede corregir; **no** pisa el cierre de A.

---



## Notas de UI (no bloquean 1.0)

Anotá acá lo que veas durante la pasada (POS celu viejo, textos, tamaños). Se atiende después.

- 
- 

---



## Cierre

- [ ] No quedó ningún `[!]` de función (login, venta, cobro, fiado, gasto/visita, pedidos, listo, deudas, relevo, shells por rol).
- [ ] 1.0 cerrada. Icono y pulido visual: otra oleada.