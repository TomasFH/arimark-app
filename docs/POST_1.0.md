# Después de la 1.0

Esta es la única lista de lo que queda para más adelante. Si hay que decidir qué hacer después del corte, se lee este archivo y ningún otro.

`PLAN.md` guarda el diseño largo de algunas de estas deudas (sobre todo DT-06 y el stock). No es una segunda lista: si una tarea no está acá, no está pendiente.

## Resumen

- **Aspecto tipo SaaS.** El Resumen de hoy se deja. Después se le puede dar profundidad, borde fino, número grande, etiqueta chica e icono por tarjeta, en claro y en oscuro, con la paleta que la app ya tiene. No copiar stock, crecimiento, clientes ni gráfico por hora: esos datos no existen. Pantallas: `SummaryScreen` de la PC y del celu, y `SummaryCharts`.
- **Cajas, ocultas.** El bloque no se muestra. El código y `shiftCloseBox` siguen. Casi ninguna caja va a decir «cerró bien» por el redondeo de pesos. Antes de volver a mostrarlo hay que decidir una tolerancia, o el estado miente. No borrar la cuenta al retomar.
- **Cobros de fiado y deuda de ahora en el celu.** En la PC se ven. En el celu dicen «pendiente» a propósito: no hay forma barata de pedirlos por local y fechas, y no se baja el libro entero. No reemplazarlos por cero.
- **Ficha mensual, PDF, año y rango libre.** El Resumen llega a esta semana, este mes y el mes anterior. Un mes más viejo, un PDF para mandarlo, o un calendario libre, quedan para cuando alguien los pida. No sellar el mes antes: un «sin anotar» se congelaría.

## Caja y celu

- **La misma caja en la PC y en el celu (DT-06).** Si se corta la luz con el turno abierto en la PC, el celu sigue ese turno. Al volver la luz, la PC retoma esas ventas y no abre otra caja. Hoy son dos turnos. El cómo está en `PLAN.md`, sección DT-06.
- **POS del celu, más viejo que el de la PC.** Funciona. El rediseño es visual, con Impeccable, sobre las pantallas del celu. No clonar la PC.
- **Fiar el resto.** En un cobro en efectivo que no cubre el total, un botón chico abre el fiado con ese pago ya cargado. No tiene que salir solo por tipear de menos.
- **Cliente especial en el cobro.** El selector está oculto. Los acuerdos se ven en el menú. Mostrarlo en el POS queda para después.
- **Asistencia.** La UI está pausada.

## Mercadería, stock y catálogo

- **Stock (Fase 8).** No es la 1.0. El libro de ingresos ya guarda las visitas. El diseño está en `PLAN.md` y en `docs/STOCK_DOMINIO_FUNCIONAL.md`. No codear el flujo hasta la charla con el carnicero.
- **Pagar una media res después.** Hoy la visita de media res no genera gasto ni deuda. Un pago posterior es otro flujo.
- **Editar el catálogo en el celu.**
- **Rollback masivo de precios (FEAT-CAT-03).** El historial de un precio ya existe. Volver atrás una lista entera, no.
- **Aviso de balanza conectada.** La detección en caliente ya está. Un indicador visible, o un reintento en el modal de cargar el catálogo del instalador, queda para después. No rehacer la detección.

## Plata que no es una pantalla nueva

- **Ganancia de verdad.** No hay costo de cada corte vendido contra el precio del ticket. No mostrar un «vendió menos gastos» como si fuera ganancia. La lectura de caja y de venta está en `PLAN.md`, «Caja y ganancia».
- **Aguinaldo.**
