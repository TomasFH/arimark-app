# Checklist — lista de Pedidos (PC)

**Cerrada 2026-09-04** (puntos 1–6 + encabezado Entregados y cancelados, sin conteo).

Convención: `[ ]` pendiente · `[x]` OK · `[!]` bug nuevo.

Fecha sugerida: a partir de 2026-09-03.

Precondición: `pnpm dev` o `pnpm dev:prod`, cajera o admin, al menos:

- 1 pedido **Listo** (retiro hoy o próximo)
- 1 pedido **Pendiente** (otra fecha, si se puede)
- 1 pedido **Entregado** (cobrado)
- 1 pedido **Cancelado** (opcional, para admin)

---

## 1. Vista normal (sin buscar)

- [x] Menú → **Pedidos**. No hay pestañas **Activos** ni **Últimos 30 días**.
- [x] Hay dos bloques: **Listos** arriba y **Pendientes** abajo, cada uno con el conteo.
- [x] Los entregados y cancelados **no** aparecen en esa vista (acceso discreto: control en el encabezado).
- [x] Al scrollear, Listos/Pendientes **no** se pisan ni dejan ver cards por detrás (ya no son fijos/sticky).
- [x] Dentro de cada bloque, el de retiro más próximo está primero (hoy arriba de un viernes).
- [x] Un Listo de hoy queda en **Listos**, no mezclado con pendientes de otro día.
- [x] Si un bloque está vacío, se lee “No hay pedidos listos/pendientes” y el título del bloque sigue visible.
- [x] **+ Nuevo pedido** sigue arriba a la derecha.



## 2. Buscador

- [x] El placeholder menciona que incluye entregados.
- [x] Buscar el nombre de un cliente **pendiente** o **listo** lo encuentra.
- [x] Buscar el nombre (o teléfono) de un pedido **entregado** lo muestra, con badge Entregado.
- [x] Buscar un producto (ej. “morcilla”) encuentra pedidos que lo tienen en el resumen.
- [x] Producto + peso en la misma línea: `asado, 2` o `asado 2kg` no trae asado 1,5 ni vacío 2 kg ni 2 u de otro corte. Varios productos: `asado morcilla`.
- [x] Texto que no coincide → “Ningún pedido coincide.”
- [x] Borrar el buscador vuelve a Listos / Pendientes.
- [x] Control **Entregados y cancelados** en el encabezado (a la izquierda de Nuevo pedido). Al pulsar lista esos estados; al pulsar de nuevo vuelve a Listos y Pendientes. Sin conteo entre paréntesis.



## 3. Alta y consulta

- [x] Crear un pedido: aparece en **Pendientes** (si el buscador estaba vacío) y se resalta un momento.
- [x] Marcar **Listo**: el pedido pasa al bloque **Listos**.
- [x] **Deshacer** lo devuelve a **Pendientes** (sin icono al lado del texto).



## 4. Auditoría (expandir la card)

- [x] Toda card muestra **Registrado por {nombre} · fecha/hora**.
- [x] Si está Listo o ya fue listo: **Listo por {nombre} · fecha/hora**.
- [x] Pedido **Entregado** (buscarlo): **Cobrado por {cajera que cobró} · fecha/hora**. No dice solo “Última modificación”.
- [x] Caso reclamo: buscar al cliente de un pedido ya cobrado por otra cajera y ver quién lo registró y quién lo cobró.



## 5. Admin

- [x] Un cancelado no aparece en la vista normal; se ve en **Entregados y cancelados** o al buscarlo. El admin puede **Eliminar** de forma permanente.
- [x] Un entregado sigue de solo lectura (sin cancelar, editar ni deshacer Listo).



## 6. Humo

- [x] La pantalla Pedidos abre sin error.
- [x] Crear / Listo / Cobrar no se rompió con este rediseño.