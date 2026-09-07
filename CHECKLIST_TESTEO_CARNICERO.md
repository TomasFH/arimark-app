# Checklist — carnicero (cuenta + celu)

Convención: `[ ]` pendiente · `[x]` OK · `[!]` bug nuevo.

Fecha sugerida: a partir de 2026-09-04.

**Qué cubre este archivo:** alta de cuenta del carnicero desde **Empleados (Personal)** en PC, shell del celu y sync con Pedidos. El carrito / lista / cobro de pedidos en PC ya se cerró en `[CHECKLIST_TESTEO_PEDIDOS_LISTA.md](CHECKLIST_TESTEO_PEDIDOS_LISTA.md)` (2026-09-04).

Hace falta **producción o** `pnpm dev:prod`: en `pnpm dev` Firebase está apagado y no se puede crear la cuenta ni marcar Listo desde el celu.

**PC:** admin (Empleados) y cajera o admin (Pedidos, turno abierto para cobrar).
**Celu:** Hosting [https://arimark-7f418.web.app](https://arimark-7f418.web.app) (el APK no se actualiza con ese deploy). Recargá forzado si el service worker no trae el bundle nuevo.

---



## A — Pedidos en PC

Cerrado. No re-probar acá: `[CHECKLIST_TESTEO_PEDIDOS_LISTA.md](CHECKLIST_TESTEO_PEDIDOS_LISTA.md)`.

---



## B — Cuenta de carnicero (PC)

Precondición: admin, `pnpm dev:prod` o producción. Un carnicero ya dado de alta en Empleados (ficha de sueldo), **sin** acceso celular.

- [x] Hub → **Empleados** (no hay otra pantalla de carniceros en el menú).
- [x] En Carniceros, abrí la ficha de uno **sin** acceso. Hay **Dar acceso al celular**.
- [x] El email es obligatorio (sin email no hay cuenta).
- [x] Llega el mail para definir contraseña.
- [x] La ficha / la card muestra **Acceso celular**.
- [x] Esa misma cuenta en **login de PC**: mensaje de que es solo para el celular y no entra al POS.
- [x] **Revocar acceso**: deja de poder **iniciar sesión** en el celu (mensaje de usuario desactivado). Si ya tenía la app abierta, lo saca a login. Recargá forzado el hosting después del deploy.

Si ya hay cuenta armada a mano en Firebase, se puede saltar B y seguir con C.

---



## C — Shell celu del carnicero

Precondición: cuenta con acceso celular activo + internet en el primer login de ese celu.

### C.1 Login y local

- [x] Login con el email del carnicero. **No** aparece el POS ni el hub admin.
- [x] Pide **en qué local está** al abrir la app (cierre total) si hay más de un local. El de la última vez queda marcado; un tap confirma.
- [x] Solo ve pedidos de **ese** local. Nunca la mezcla de ambos.
- [x] Se puede cambiar de local después (tap en el nombre del local, más grande, naranja).
- [x] Si deja la app en segundo plano **2 h o más**, o cambia el día, vuelve a preguntar. Un minimize corto (WhatsApp, llamada) no pregunta.
- [x] Al reabrir, el encabezado muestra el **nombre** del local, nunca el código (`local1`, UUID). Mientras carga: «Cargando…», no el id.



### C.2 Pedidos

- [x] Sub-pestañas **Pendientes / Listos / Entregados**. Pendientes = trabajo. Listos y Entregados = auditoría (no se cobran ni se editan).
- [x] Pendientes: solo **Pendiente**. Agrupados por día (atrasados / hoy primero, después los que siguen).
- [x] Dentro del día: turno mañana → tarde. Un **horario específico** se agrupa en el turno de esa franja (no es un grupo aparte). Si falta ≤ 1 h para el retiro, va arriba del día (**Retiro próximo**). *Comportamiento 2026-09-06. Alta de pedido (aviso al elegir hora / sin aviso de última hora): `CHECKLIST_TESTEO_HORARIO_Y_LOCAL.md`.*
- [x] Card: cliente, ítems (líneas de presupuesto si hay; si no, el texto viejo), prioridad si aplica.
- [x] Listos: los marcados listos de ese local. Se puede **Devolver a pendientes** (pide confirmación, modal al centro).
- [x] Entregados: últimos **7 días** de retiro, solo lectura. Un retiro de días anteriores **no** dice «Atrasado». Se ve *Listo por…* y *Entregado por…* (fecha/hora).
- [x] **No** hay crear, editar, cobrar ni cancelar.



### C.3 Listo (exige red)

- [x] Con internet: **Listo** abre un modal («¿Marcar como listo?» / Cancelar / Sí). Sin confirmar, el pedido no se mueve.
- [x] Al confirmar: sale de Pendientes. Aviso chico (esquina) con el nombre, **Deshacer**, **×** y barra (~7 s).
- [x] **Deshacer** en ese aviso: el pedido vuelve a Pendiente (sin otro modal). **×** o esperar: queda Listo y se ve en la pestaña Listos.
- [x] En la PC (Pedidos, mismo local) el pedido aparece **Listo** con *Listo por {nombre} · hora*.
- [x] Sin conexión: lista de solo lectura (si hay datos), botón Listo **deshabilitado**, mensaje claro. No se encola para después.
- [x] Si el aviso ya se cerró: la cajera **Deshace** en PC; el pedido vuelve a Pendiente y reaparece en el celu.



### C.4 Mi semana

- [x] Tab **Mi semana**: solo la semana en curso (lun–dom). Sin flechas ni semanas anteriores.
- [x] Muestra sueldo semanal, vales de esa semana, neto, y si ya está pagado.
- [x] No ve sueldos ni vales de **otros** empleados.
- [x] Con internet: pinta lo último y refresca. Sin internet: se ve la caché de solo lectura (consultar sueldo no exige red).
- [x] No aparece un error técnico de Firebase (URL de índice, etc.). Si algo falla: mensaje corto en español.



### C.5 Lo que no debe pasar

- [x] El carnicero no opera caja, no ve el hub admin, no edita pedidos.
- [x] Cajera/admin en celu siguen igual (POS / hub). El login de carnicero no los rompe.

---



## D — Sync cruzado (PC ↔ celu)

- [x] Pedido creado en PC con carrito: aparece en el celu del carnicero de ese local (unos segundos, con internet).
- [x] Listo desde el celu: la cajera lo ve en PC **sin** recargar a mano (o al volver a Pedidos).
- [x] Cobrar en PC: el pedido desaparece de la lista del carnicero (ya no está pending).

---



## Cubierto por tests *(no requiere revisión manual)*

- [x] IPC alta carnicero con email obligatorio / kind incorrecto / ya tiene acceso (`employees.handler.test.ts`)
- [x] Login desktop rechaza `butcher` (`session.test.ts`)
- [x] `CHARGE_ORDER` ya no arma venta dummy; resto > 0 fuerza POS (`orders.handler.test.ts`)
- [x] Migraciones `readyAt/readyBy/readyByName/budgetItems` y `employees.firebaseUid`
- [x] Auth móvil: `butcher` aceptado; `active: false` rechaza login y cierra sesión; agrupación día/turno (`butcher.test.ts`, `authAccess.test.ts`)
- [x] Empleados (Personal): Dar acceso / Revocar según tenga cuenta (`StaffScreen.test.tsx`)