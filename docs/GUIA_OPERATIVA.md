# Guía de uso — App de la carnicería

Esta guía es para **cajeras, administradores y carniceros**. No hace falta saber de computadoras: explica qué hace cada persona, en qué aparato, y cómo se resuelven los casos del día a día.

Hay **dos lugares** para trabajar:

- **La computadora del local** — es la caja principal.
- **El celular** — respaldo de caja, pedidos del carnicero, y para que el admin mire o cargue cosas desde afuera.

La **balanza no está conectada a la caja**. El carnicero pesa y entrega un ticket. La cajera cobra **escaneando ese ticket**. La caja registradora se usa como siempre, a mano: la app no la abre ni le manda plata.

---

## Cómo se arma una venta (el circuito completo)

1. El **carnicero** pesa en la balanza y le da al cliente un ticket con códigos de barras.
2. El cliente lleva el ticket a la **cajera**.
3. La cajera **escanea cada código** (con el lector USB, como si fuera un teclado). Cada beep suma un producto a la venta.
4. Cuando terminó el ticket, toca **Cobrar**, elige cómo paga el cliente (efectivo, débito, billetera, crédito, o varios a la vez) y confirma.
5. Si es **fiado**, en vez de un medio de pago elige Fiado y busca o carga al cliente.

Eso es el corazón del sistema. El resto (gastos, pedidos, sueldos, proveedores) gira alrededor de ese turno de caja.

---

## Quién usa qué

| Persona | Computadora | Celular |
|---|---|---|
| **Cajera** | Caja del día: ventas, gastos, fiados, pedidos, vales, cierre | Caja de emergencia si la PC no anda |
| **Admin** | Hub: catálogo, locales, personal, historial, proveedores, y también puede “Operar como cajera” | Mismo hub (hace falta internet) + operar caja si hace falta |
| **Carnicero** | No entra. Si intenta loguearse, la PC le dice que esa cuenta es solo para el celular | Pedidos (marcar **Listo**) y **Mi semana** (sueldo y vales) |

Todos entran con **email y contraseña**. La misma persona puede estar logueada en la PC y en el celular al mismo tiempo.

---

# Cajera — computadora

## Entrar

1. Abrí la app.
2. Email y contraseña → **Ingresar**.
3. Si hay más de un local, elegí el de hoy. La app suele recordar el último.
4. Si ya tenías un turno abierto tuyo (por ejemplo se cortó la luz y volviste), la app **retoma ese turno** y no te pide abrirlo de nuevo.
5. Si no hay turno: cargá el **efectivo inicial** y el **conteo de billetes** (puede venir precargado de lo que dejó el turno anterior). Confirmá.

**¿Olvidaste la contraseña?** En la pantalla de login hay un enlace para que te llegue un mail y la restablezcas.

**Sin internet:** si ya te logueaste alguna vez en esa PC, podés entrar igual. Vas a ver un aviso fijo: *“Sin conexión — sesión guardada localmente”*. Si es la primera vez en esa computadora, hace falta internet. El acceso guardado dura unos 30 días.

**Si te quedás un rato sin tocar nada** con el turno abierto, la app pregunta *“¿Seguís trabajando?”*. Podés seguir, cerrar el turno, o si no contestás se cierra solo y te saca.

## Cobrar (pantalla de caja)

Vas a ver:

- A la **izquierda:** Menú, Venta, Vales, Gastos, Turno.
- Al **centro:** “Escaneá el ticket de la balanza” y el botón **Manual**.
- A la **derecha:** el total y **Cobrar**.
- Arriba: el nombre del local, el turno y cuánto hay **en caja** (estimado).

### Ticket normal

1. Apuntá el lector a cada código del ticket. No hace falta hacer clic en ningún casillero.
2. Cada producto aparece en la lista (nombre, kilos o unidades, plata).
3. Si te equivocaste, sacá el renglón con la cruz o usá **Vaciar** para empezar de nuevo.
4. **Cobrar** → medio de pago.
   - Efectivo: podés cargar “¿con cuánto paga?” y la app calcula el vuelto.
   - Varios medios: **Dividir**.
   - Si el local tiene descuento por pagar en efectivo, la app lo aplica y te lo avisa.
5. Confirmá. El carrito se vacía y queda lista la siguiente venta.

### El lector no anda o el código no se lee

Tocá **Manual**. Buscá el producto o cargá el número de PLU y el precio, y sumalo igual.

### Fiado

En el cobro, elegí **Fiado**. Buscá al cliente (o crealo), teléfono si hace falta, vencimiento opcional, y si deja algo de seña. La venta queda fiada.

Después, en **Menú → Fiados**, ves quién debe, el historial, **Registrar pago** o cancelar una deuda.

### Pedido que el cliente viene a retirar

1. **Menú → Pedidos**.
2. Si ya está **Listo**, tocá **Cobrar**. La app te lleva a la caja con el pedido cargado y la seña ya descontada.
3. Si la seña cubría todo, se marca entregado sin pasar por el cobro.
4. **Cancelar cobro** en la caja si te arrepentís y todavía no confirmaste.

No marques un pedido como cobrado “a ojo”: el cobro tiene que pasar por la caja (o quedar cubierto por la seña).

## El menú de la caja (botón Menú)

| Dónde | Para qué |
|---|---|
| **Ingreso** | Sumar efectivo a la caja (un aporte, no una venta) |
| **Cebo** | Anotar kilos de cebo. **No mueve plata** |
| **Saldar** | Pagarle a un proveedor con el efectivo de esta caja |
| **Catálogo** | Ver y tocar productos de este local (precio, disponibilidad, cargar en balanza). El carrito de la venta **no se pierde** |
| **Pedidos** | Alta, listos, cobrar, cancelar |
| **Fiados** | Deudas de clientes |
| **Clientes especiales** | Consultar precios acordados. Hoy **no** cambian solos el ticket: se cobran a mano según lo acordado |
| **Stock** | Conteo de kilos/unidades (en general una vez por semana) |
| **Liquidación** | Pagar el sueldo semanal de un empleado (baja de caja) |
| **Desc. efectivo** | Regla de descuento por pagar en efectivo (mínimo y porcentaje, por día/turno) |
| **Gastos del turno** | Lista de lo que ya cargaste |
| **Actualizar** | Pedir datos frescos si algo no aparece |
| **Claro / Oscuro** | Tema de la pantalla |
| **Cerrar caja** | Arqueo y fin de turno |
| **Contraseña / Cerrar sesión** | Cuenta |

## Gastos y proveedores (cajera)

**Gastos** (barra de la izquierda): visita de un proveedor. Cargás el total de la visita y cuánto le entregaste ahora. Si le das menos (o cero), sube la deuda. Si le das de más, queda a favor.

**Saldar:** pagar deuda vieja de **este local** con el efectivo de esta caja.

No uses Gasto para un sueldo: eso va por **Liquidación**. No uses Ingreso para una venta: eso va por **Cobrar**.

## Vales

Barra **Vales**, con el turno abierto.

- **Con productos:** no saca plata de la caja; suma a lo que se descuenta en la liquidación.
- **Adelanto en efectivo:** sí baja la caja.

Elegí al empleado de la lista (carniceros y cajeras del local; si viene alguien de otro local, figura como visitante).

## Cerrar el turno

1. **Menú → Cerrar caja**.
2. Revisá el resumen (ventas, efectivo esperado, digitales).
3. Anotá a quién le entregás y, si hace falta, notas.
4. Contá los billetes que **quedan en la registradora**.
5. Confirmá. Vas a ver un resumen final → **Finalizar** (te cierra la sesión).

Si cancelás, volvés a la caja con el turno **sigue abierto**.

---

# Cajera — celular (emergencia)

Usalo si la computadora no está, se cortó la luz, o no hay lector. **No reemplaza a la PC** en un día normal: las ventas del celu llegan después a la computadora como origen “Móvil”. No se mezclan en vivo con el turno que está abierto en la PC.

1. Entrá con el mismo email y contraseña. La primera vez en ese celular hace falta internet. Después abre solo.
2. Elegí local (si hay más de uno) y abrí turno (efectivo inicial y billetes, igual que en la PC).
3. **Escanear** abre la cámara. **Manual** busca en el catálogo.
4. Cobrar, fiado, gasto, ingreso, cebo, vales, liquidación y cerrar turno están en esa misma pantalla.

**Fiado en el celu:** cargás el nombre (y teléfono si querés). No busca la lista de clientes de la nube; sirve para no parar.

**Sin señal:** podés seguir cobrando si el catálogo ya se había bajado. Abajo vas a ver *“Sin conexión — trabajando offline…”*. Cuando vuelva internet, se sube solo.

**Pedidos:** en el celular de cajera **no se cobran**. El cobro de un pedido se hace en la computadora.

---

# Carnicero — celular

En la computadora **no hay que entrar**. Todo es en el teléfono.

1. Email y contraseña (te los da el admin; te llega un mail para crear la clave).
2. Si hay más de un local, confirmá en cuál estás. Si dejás el celu un buen rato o cambió el día, te lo vuelve a preguntar. Podés cambiar tocando el nombre del local.
3. Dos pestañas: **Pedidos** y **Mi semana**.

## Pedidos

Tres listas: **Pendientes** (lo que hay que preparar), **Listos**, **Entregados** (últimos 7 días, solo para mirar).

Cuando el pedido está armado:

1. Tocá **Listo** y confirmá.
2. Sale de Pendientes. Durante unos segundos podés **Deshacer** si te equivocaste.
3. Si ya lo habías marcado y hay que volver atrás, en Listos está **Devolver a pendientes**.

Hace falta **internet** para marcar Listo. Sin conexión podés mirar lo que ya estaba en pantalla, pero el botón queda bloqueado.

No creás pedidos, no los cobrás y no los cancelás. Eso lo hacen cajera o admin. Cuando en la PC cobran el pedido, desaparece de tus pendientes.

## Mi semana

Sueldo de la semana (lunes a domingo), vales que te cargaron y cuánto queda neto. Si ya te liquidaron, lo indica. Es solo consulta.

---

# Admin — computadora

Después del login vas al **Hub** (baldosas), no directo a la caja.

## Operar como cajera

Baldosa **Operar como cajera**. Es la misma caja que usa la cajera: abrir turno, vender, cerrar. En el menú de caja aparece **Hub** para volver.

Si hay un turno de **otra persona** abierto en ese local, la app no deja abrir otro. El admin puede **forzar el cierre** de ese turno ajeno. Usalo solo si esa persona ya no está y la caja quedó colgada.

## Catálogo y balanza (Panel de administración)

Acá se tocan productos de **todos los locales**: precios, disponibilidad, versiones anteriores, y **retiro global** (libera el número de PLU).

**Cargar en balanza** manda los PLUs y precios a la KRETZ por el cable USB. Eso **no pasa solo**: si cambiaste un precio en la app, la balanza sigue con el viejo hasta que alguien haga la carga.

Los cambios de catálogo **sí llegan solos** a las otras PCs y al celular (la lista de productos). Un ticket que ya estaba en el carrito **no se recalcula**.

La cajera, desde **Menú → Catálogo**, puede editar el local en el que está y también cargar en balanza; no ve el panel de todos los locales ni el retiro global.

## Locales

Nombre, dirección, **horarios** de mañana y tarde por día (no se pueden pisar). Esos horarios sirven para sugerir el tipo de turno al abrir caja y para validar la hora de retiro de un pedido. Se puede archivar un local y restaurarlo.

## Empleados

Sectores **Cajeras** y **Carniceros**. Alta, sueldo semanal, vales, activar o desactivar.

- **Cajera:** se le da email y locales en los que puede trabajar.
- **Carnicero:** la ficha sirve para sueldo y vales aunque no use el celu. **Dar acceso al celular** le manda el mail para la contraseña. **Revocar** le saca la app.

La **liquidación** (pagar el sueldo) se confirma con un turno de caja abierto, porque sale plata de esa caja.

## Fiados, clientes especiales, pedidos, proveedores

Mismo criterio que en caja, con extras:

- Filtro por local.
- En **Proveedores:** deuda de cada local y la combinada, **Ajustar**, **Compensar entre locales**, archivar/restaurar.
- En **Pedidos:** el admin elige el local destino al crear. Puede **eliminar** del todo un pedido que ya estaba cancelado.
- **Clientes especiales:** el admin carga y edita precios acordados. La cajera solo consulta. Esos precios **no se aplican solos** al escanear.

## Historial completo

Solo admin, en la PC. Turnos del local, con etiqueta **Móvil** si se cerró en el celu. Adentro: ventas, gastos, fiados, señas, vales. Las ventas anuladas se ven tachadas.

La cajera **no** tiene esta pantalla en la computadora (en el celular sí hay historial para admin y también para cajera, con internet).

## Stock

**Nuevo conteo** e **Historial de conteos**. Hoy lo cargan cajera o admin. El ingreso de mercadería “de verdad” (compras que suman stock) **todavía no está** en la app.

---

# Admin — celular

Misma cuenta, hub parecido: locales, empleados, fiados, especiales, pedidos, proveedores, historial, y **Operar como cajera**.

**Hace falta internet.** Si no hay señal, un aviso te dice que los datos de admin no se pueden usar.

Cosas que **no** están en el celu:

- Editar el catálogo / hablar con la balanza
- Conteo de stock
- Cobrar un pedido (el cobro es en la PC)
- Pagar una liquidación desde el listado de empleados: la consulta sí; el pago sale de una caja abierta (PC o “Operar como cajera”)

---

# Pedidos — quién hace cada cosa

| Acción | Cajera PC | Admin | Carnicero celu |
|---|---|---|---|
| Crear / editar pedido (productos, seña, día y turno de retiro) | Sí | Sí | No |
| Marcar **Listo** | Sí | Sí | Sí (su trabajo principal) |
| Cobrar / entregar | Sí (caja) | Sí (caja) | No |
| Cancelar | Sí | Sí | No |

Un pedido puede tener seña (efectivo u otro medio). Al cobrar el resto, esa seña ya está descontada.

---

# Problemas frecuentes

**“Credenciales incorrectas o sin conexión”**  
O la clave está mal, o no hay internet y esta PC nunca guardó tu sesión. Probá de nuevo, pedí reset de contraseña, o conectate una vez.

**La PC no prende / se cortó la luz**  
Cajera: caja en el **celular**. Cuando la PC vuelva, esas ventas aparecen en el historial como **Móvil**. No hace falta “pasarlas a mano”.

**El lector no pita**  
Usá **Manual**. Avisá para revisar el lector; no dejes de cobrar.

**El precio del ticket no coincide con el de la lista**  
La venta usa lo que vino en el código (lo que pesó la balanza). En el renglón puede aparecer una marca de diferencia. Si el precio de lista está mal, hay que corregirlo en **Catálogo** y después **cargar en la balanza**.

**Cambié un precio y la balanza sigue igual**  
Normal. La lista de la app se actualiza sola; la balanza no. Hay que **Cargar en balanza**.

**Marqué Listo sin querer (carnicero)**  
Enseguida aparece Deshacer. Si ya pasó, en **Listos** devolvé a pendientes. Hace falta señal.

**Hay un turno abierto de otra cajera**  
No se puede abrir otro en ese local. El admin puede forzar el cierre si esa persona ya no está.

**Me piden asistencia / presentismo en la app**  
Esa pantalla está **apagada** por ahora. No busques el botón: no está en uso.

**El cliente especial no le cambia el precio al escanear**  
Es a propósito hoy. Se mira la lista de **Clientes especiales** y se cobra el acuerdo a mano (o por Manual).

---

# Lo que la app no hace (para no esperar de más)

- No abre ni controla la **caja registradora** ni el **posnet**.
- No pesa sola: el peso sale del **ticket de la balanza**.
- El celular **no le manda códigos a la PC**. O cobrás en la PC con el lector, o cobrás en el celu como caja aparte.
- No hay control de stock de compras todavía: solo el **conteo** periódico.
- Una cajera en la PC y la misma cajera en el celu **no comparten el mismo turno en vivo**. Son dos cajas que después se ven en el historial.

---

# Día tipo (resumen para imprimir)

**Carnicero:** celu → local correcto → Pendientes → preparar → **Listo**. A la tarde, si querés, **Mi semana**.

**Cajera:** PC → entrar → abrir turno y contar billetes → escanear tickets → cobrar → (gastos, vales, pedidos cuando toque) → **Cerrar caja** y dejar el conteo de lo que queda.

**Admin:** Hub para precios, gente y deudas; “Operar como cajera” si hay que cubrir un turno; celu para mirar o cargar cosas lejos del local (con internet).
