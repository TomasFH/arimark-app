# Revisión — mejoras de mostrador

Probar en la app con los cambios de este pase. El conteo de billetes como paso opcional no está en esta versión.

## Sin lector

- **Abrir turno.** El turno, el efectivo y Abrir turno quedan a la izquierda, en una tarjeta. Los billetes quedan a la derecha. Las dos tarjetas miden lo mismo de alto. El cierre de turno sigue en una sola columna de billetes.
- **Nuevo pedido, productos.** Escribí `as`. Las flechas suben y bajan entre las opciones, sin mover el cursor del texto. Enter agrega la marcada. Si la lista es larga, al bajar se ve la opción aunque haya que scrollear. Tab no recorre esa lista.
- **Bolsas y cobro.** Con la lista de bolsas abierta, Enter confirma el cobro y no suma una bolsa. La flecha derecha sigue sumando.
- **Efectivo.** Al abrir el cobro en efectivo, el cursor ya está en el monto recibido. Si el cliente paga de más, el recuadro de vuelto tiene borde gris, no blanco. Mirá claro y oscuro.
- **Borrador al cobrar un pedido.** Cambiá un peso o quitá una línea. Si cerrás el modal, o si pasás al POS y ahí cancelás el cobro, al volver a ese pedido siguen los cambios. Otro pedido no los hereda. Si la venta queda confirmada, ese borrador no vuelve.
- **Ventas del turno (cajera, no el historial admin).** Una venta en efectivo con 10% muestra el precio de lista tachado y, debajo, lo cobrado. La columna digital no es del mismo blanco que el total.

## Con ticket de balanza

- **Cobrar un pedido.** Escaneá una etiqueta de un producto que ya está en la lista: esa fila se marca fuerte y se apaga en un segundo y medio. Si escaneás otra enseguida, el resaltado pasa a esa y la primera se apaga. Una etiqueta de un producto que no estaba en el pedido se agrega al final, marcada como que no estaba en el pedido original.
- **PLU que la caja no reconoce.** Escaneá un producto que no está en el catálogo. En «Asignar producto», las flechas recorren las opciones, Enter elige, y la lista se mueve sola si la opción queda fuera de vista.
