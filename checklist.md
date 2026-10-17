# Checklist — sesión 16 oct 2026

Versión 0.6.4. Probar con el instalador nuevo o con `pnpm dev`.

La charla del cierre de caja, los clientes especiales y los cortes con oferta no tienen código nuevo.

## Historial de un turno

- [ ] Una venta con descuento muestra el precio de lista tachado y, debajo, el monto cobrado.
- [ ] Una venta sin descuento muestra solo el monto cobrado.
- [ ] Los medios tienen color propio, en claro y en oscuro: efectivo verde, débito azul, billetera celeste, crédito distinto. Nada chillón.
- [ ] Una venta de un solo medio muestra el nombre, sin el monto en la pastilla.
- [ ] Una venta mixta muestra el monto en cada pastilla (efectivo y el resto por separado).
- [ ] Anular una venta está en la caja, en Turno (el reloj de la barra, o Alt+5). El historial no tiene ese botón: si la venta ya fue anulada, ahí se ve tachada y atenuada. Un gasto incorrecto se elimina, no se anula.

## Carga manual en la caja

- [ ] Escribir un nombre con número (`Vacío x2`) no borra el texto ni salta a modo PLU.
- [ ] Un PLU pelado (`5`) sigue cargando el producto.
- [ ] Con la lista abierta: flecha abajo y Tab bajan, flecha arriba y Shift+Tab suben, Enter elige, Escape cierra.
- [ ] Al elegir, el campo queda `12 - Nombre` y el cursor pasa al peso.
- [ ] Enter en el peso agrega la línea. El producto, el kilo y el total de la venta son los correctos.
- [ ] Volver al campo ya confirmado (`12 - Nombre`) no reabre la lista.
- [ ] F6 abre y cierra Manual. Al abrir, el cursor queda en el nombre. También se abre sola al confirmar una venta.

## Atajos de cobro

Con productos en el carrito y sin otro modal abierto:

- [ ] F1 abre efectivo, F2 débito, F3 billetera, F9 crédito. Cada botón muestra su tecla. F4 no cobra.
- [ ] Esa tecla no cobra sola.
- [ ] En efectivo, Enter con el monto vacío cobra el justo.
- [ ] En efectivo, un monto menor al total no confirma.
- [ ] Enter confirma débito y billetera.
- [ ] F9 deja el crédito en las cuotas; no cobra hasta confirmar.
- [ ] Alt+F4 (y la X de la ventana) pregunta si se quiere cerrar la aplicación. Enter o un segundo Alt+F4 confirman. Escape o Cancelar la dejan abierta.
- [ ] F5, desde la venta, abre el cobro ya dividido y no recarga la ventana. No cobra solo. Adentro de otro medio, F5 también pasa a dividido.
- [ ] Escape vuelve un paso. Desde la grilla de medios, cierra el cobro y deja el carrito.
- [ ] Con el carrito vacío, F1–F3 y F9 no abren el cobro.
- [ ] En el primer paso de Cobrar, el aviso verde del descuento en efectivo muestra el monto a cobrar entero, en más de una línea.
- [ ] F1 no abre la ayuda de Windows.

## Atajos de la venta

- [ ] Flechas marcan una línea del carrito. Supr la quita.
- [ ] Con el cursor en un campo, flechas y Supr no tocan el carrito.
- [ ] No hay atajo para vaciar la venta.
- [ ] F7 abre y cierra las bolsas. Con la lista abierta: abajo y arriba marcan, derecha o Enter suman una, izquierda saca una, Escape cierra. En el cobro, Enter suma la bolsa y no confirma la venta; el primer Escape cierra las bolsas.
- [ ] Alt+1 vuelve a la venta, Alt+2 pedido, Alt+3 vales, Alt+4 gastos, Alt+5 turno, Alt+I ingreso.
- [ ] Esas Alt no actúan con el cursor en un campo ni con un modal abierto.
- [ ] Al confirmar una venta, Carga manual queda como estaba. Si estaba abierta, el cursor vuelve al nombre. Si estaba cerrada, sigue cerrada.

## Nuevo pedido

- [ ] En Buscar producto, las flechas recorren las opciones y el fondo marcado cubre toda la fila. Enter agrega la marcada. Escape cierra la lista y el pedido sigue abierto. Tab sigue al campo siguiente.
- [ ] Ctrl+Enter, desde cualquier campo, enfoca Buscar producto. Si ya hay opciones, agrega la marcada.
- [ ] En el peso, Tab pasa a las unidades y, desde ahí, a Buscar producto. Enter con el peso vacío vuelve a buscar. Las flechas cambian de línea y Supr quita esa línea. Tab no se detiene en el botón de quitar.

## Cobrar un pedido

- [ ] El peso se puede seguir escribiendo a mano.
- [ ] Escanear la etiqueta del mismo PLU completa esa línea. Los kilos salen del total del ticket dividido el precio del pedido.
- [ ] Lo que después se cobra es el total del ticket, no un redondeo distinto.
- [ ] Si la lista de hoy no es el precio del pedido, la línea avisa y el precio no cambia solo.
- [ ] «Cambiar precio» abre el campo solo en esa línea. Al cambiarlo, los kilos se recalculan y el total sigue siendo el del ticket.
- [ ] Una segunda etiqueta del mismo PLU completa la siguiente línea libre. Si no hay otra, se agrega marcada como Extra.
- [ ] Una etiqueta de un producto que no estaba en el pedido se agrega como Extra, al precio de lista.
- [ ] Una etiqueta de un PLU desconocido avisa y no agrega nada.
- [ ] Si se escribe otro peso a mano sobre una línea ya escaneada, se cobra ese peso por el precio de la línea.
