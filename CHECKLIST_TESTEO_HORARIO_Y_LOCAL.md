# Checklist — horario de retiro + último local (PC)

Convención: `[ ]` pendiente · `[x]` OK · `[!]` bug nuevo.

Fecha sugerida: a partir de 2026-09-06.

**Qué cubre:** aviso al elegir un horario de retiro inválido, sin aviso de “última hora”, y el selector de local de la PC (último usado + confirmación).

**No re-probar acá:** agrupación mañana/tarde / **Retiro próximo** en el celu del carnicero (ya OK en `CHECKLIST_TESTEO_CARNICERO.md` C.2). **Mi semana** C.4. Pin “Fijar en esta PC” (se sacó).

Hace falta **producción o** `pnpm dev:prod` para el celu admin. El APK no se actualiza con el deploy. Recargá forzado: [https://arimark-7f418.web.app](https://arimark-7f418.web.app).

Precondición Pedidos: el local tiene franjas cargadas en Locales. Si un día no tiene tarde, un retiro a las 17:00 ese día tiene que avisar cerrado.

Precondición local: **2 locales activos**. Con uno solo no aparece el picker.

---



## A — Horario específico (crear pedido)

PC: cajera o admin → **Pedidos** → **+ Nuevo pedido**. Celu admin: **Pedidos** → nuevo (recarga forzada).

### A.1 Fuera de franja — el aviso es al elegir la hora

- [x] Marcá **Horario específico**. Aparece el hint (retiro a esa hora sí o sí; no es Prioritario).
- [x] Elegí una hora **entre** las dos franjas (local cerrado). El mensaje rojo sale **en el acto**, sin pulsar Crear pedido. El botón Crear/Guardar queda deshabilitado.
- [x] Cambiá a una hora **dentro** de la franja: el rojo desaparece y se puede crear.
- [x] Una hora **antes de abrir** (p. ej. 07:00) también avisa al instante.
- [x] Lo mismo en el **celu admin** (mismo local, recarga forzada).



### A.2 Última hora del cierre — sin aviso

Esa hora es la del **retiro**, no la de preparar. El pedido tiene que estar listo para entonces.

- [x] Hora a **≤ 1 h del cierre** de esa franja (si cierra 13:30, probá 13:00; si cierra 20:30, 19:30 o 20:30). **No** aparece modal ni texto de “no es recomendable”.
- [x] Se puede **Crear pedido**. Queda pendiente, agrupado en el turno de esa franja (no en un grupo “Horario específico”).



### A.3 Sigue bloqueado al guardar

- [x] Si de algún modo queda una hora cerrada y se intenta guardar: no se crea el pedido. El IPC sigue rechazando.

---



## A.4 Horarios del local — no se pisan; días distintos

Admin → **Gestión de locales** (PC) o **Locales** (celu admin, recarga forzada).

- [x] Mañana 08:00–20:30 **y** tarde 16:00–20:30: no deja guardar. Mensaje de que se pisan (un solo turno corrido o separarlos).
- [x] Mañana 08:00–20:30 **sin** tarde: sí guarda (turno de corrido).
- [x] Mañana 08:00–14:00 y tarde 16:00–20:30: sí guarda (no se tocan / se tocan solo en el extremo).
- [x] Días: se pueden marcar chips. Un día en un horario se mueve al otro al tocarlo. Día sin marcar = cerrado.
- [x] Ejemplo San Martín: Lun–Sáb 08:00–14:00 y 16:00–20:30; Domingo solo 08:00–14:00 (segundo horario, sin tarde).
- [x] Pedido con retiro **domingo 17:00** en ese local: aviso de cerrado al elegir la hora (PC y celu admin). Lunes 17:00 sí entra.
- [x] Abrir turno el domingo: sugiere mañana, no tarde.
- [ ] Domingo **sin tarde** (Camarones / San Martín): al crear pedido, **Turno tarde no aparece** (PC y celu admin). Turno mañana y horario específico sí. Un domingo futuro. Lunes: **Turno tarde** vuelve a aparecer. Horario específico 17:00 el domingo sigue avisando cerrado.

---



## A.5 Lista carnicero — días más visibles

Celu carnicero → Pedidos (recarga forzada). Tiene que haber un pendiente de **hoy** y otro de **mañana** (si no hay de hoy, el de mañana queda arriba).

- [x] El título de cada día se ve más marcado (bloque con borde, no solo un subtítulo chico gris).
- [x] El pedido que **no es de hoy** muestra **Retiro: mañana** (o la fecha) en la tarjeta, y un acento distinto (borde).
- [x] El de hoy **no** lleva esa etiqueta extra.
- [x] En un scroll rápido se distingue cuándo termina un día y empieza el otro.

A.4 y A.5 aprobados 2026-09-07. Queda el ajuste de **Turno tarde** oculto el domingo (ítem nuevo de A.4).

---



## B — Último local en esta PC (DT-04)

Logout / login de **cajera**. El admin al hub **no** ve este picker; sí al ir a caja si hay 2+ locales.

- [x] **Gestión de locales:** no hay **Fijar en esta PC** / **Dejar de fijar** / badge **Esta PC**.
- [x] Primera vez de esa cajera en **esta** PC: lista “¿En qué local trabajás hoy?”. Ninguno dice **Último local**. Un toque entra, **sin** modal extra.
- [x] Cerrá sesión y volvé a entrar (sin turno abierto). El local de recién tiene badge **Último local** (borde destacado). Un toque entra, **sin** modal.
- [x] Tocá el **otro** local: modal **¿Confirmás este local?** nombra el último y el que estás eligiendo. **Cancelar** vuelve a la lista. **Sí, continuar** entra al que no era el de siempre.
- [x] Logout y login otra vez: ahora el resaltado es el que confirmaste (el “de siempre” se actualiza).
- [x] Un solo local activo: no hay picker; entra solo.
- [x] Admin → **Operar como cajera** (o ir a caja): misma lógica con el último local **de esa cuenta en esta PC**.
- [x] El celu no usa este flujo (el teléfono viaja). Carnicero: ya cubierto en C.1.

---



## Cubierto por tests *(no requiere revisión manual)*

- [x] `near_close` existe pero el aviso está apagado (`pickupHours.test.ts`)
- [x] Error de horario cerrado sin esperar al submit (`pickupHoursLiveError`)
- [x] Picker: último local sin modal; el otro pide confirmación (`StorePickerScreen.test.tsx`)
- [x] `lastStore` por `userId` en esta PC (`lastStore.test.ts`)
- [x] Turnos que se pisan se rechazan; horarios por día (`storeHours.test.ts`, `stores.handler.test.ts`)