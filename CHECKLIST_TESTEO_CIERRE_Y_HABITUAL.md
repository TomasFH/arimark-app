# Checklist — catálogo en vivo (I-A) + edición por cajera (I-B)

Convención: `[ ]` pendiente · `[x]` OK · `[!]` bug nuevo.

Fecha sugerida de prueba: a partir de 2026-08-30.

La ola anterior (resumen post-cierre + local habitual) **ya está cerrada**. Este archivo se reutiliza para no acumular checklists.

Hace falta **producción o `pnpm dev:prod`**: en `pnpm dev` Firebase está apagado y el listener no corre.

**PC:** dos instancias si podés (caja A + admin/otra PC), o una PC + celu.
**Celu:** Hosting [https://arimark-7f418.web.app](https://arimark-7f418.web.app) (`pnpm mobile:deploy` al cerrar este trabajo). El APK no se actualiza con ese deploy. Recargá forzado si el service worker no trae el bundle nuevo.

---

## A — Catálogo en vivo (I-A)

Objetivo: altas / precios / bajas llegan a otras PCs y al celu **sin** pulsar ↺.

Precondición: internet. Dos dispositivos en el **mismo** local (o PC + celu POS de ese local).

### A.1 PC → otra PC (o reabrir el POS)

- [ ] En PC 1 (admin o cajera) cambiá el **precio** de un producto y guardá.
- [ ] En PC 2, con el POS o Lista de productos **abierto**, el precio nuevo aparece **sin** ↺ (unos segundos).
- [ ] En PC 1 **creá** un producto nuevo (nombre + PLU + precio de ese local).
- [ ] En PC 2 el producto nuevo aparece en lista / Manual / vales, **sin** ↺.
- [ ] En PC 1 (admin) hacé **retiro global** de un producto de prueba (libera PLU). En PC 2 deja de listarse.

### A.2 PC → celu (POS)

- [ ] Celu: cajera (o admin → Operar como cajera) → POS del **mismo** local, con internet.
- [ ] PC cambia precio o alta. En el celu, Manual / búsqueda muestra el dato nuevo **sin** ↺ ni re-login.
- [ ] ↺ en el celu **sigue funcionando** (respaldo): no rompe ni duplica productos.

### A.3 Ticket / carrito (borde)

- [ ] PC: cargá un ítem al ticket (ej. Asado a $X). En la **otra** PC o en Catálogo cambiale el precio de lista a $Y.
- [ ] El ítem **ya en el ticket** sigue a $X. El **próximo** escaneo / Manual usa $Y.
- [ ] Lo mismo en celu: línea ya en el carrito no se recalcula; el siguiente alta sí.

### A.4 Offline / ↺ (borde)

- [ ] Sin internet, el POS sigue con el catálogo cacheado (no pantalla vacía).
- [ ] Al volver internet, un cambio publicado mientras estabas offline llega (listener o ↺).
- [ ] Un ↺ con internet no borra productos que esa PC tiene y el snapshot no traía (merge, no pisado).

### A.5 Lo que no debe pasar

- [ ] La app no se pone lenta ni “parpadea” el catálogo en loop (eco de publicación).
- [ ] No hay panel de **editar** catálogo en el celu (alta/precio/ficha). Recibir lista sí.
- [ ] La balanza **no** se actualiza sola; sigue “Cargar en balanza” (solo admin, PC).

---

## B — Edición por cajera (I-B) — solo PC

### B.1 Entrada

- [ ] Cajera, turno abierto → Menú → **Catálogo**. No es lo mismo que **Lista de productos** (esa sigue siendo consulta).
- [ ] El carrito del POS **sigue ahí** al volver (como Fiados).
- [ ] Título **Catálogo**. No dice “Administración”. No hay selector de otro local.
- [ ] **No** aparecen: Cargar en balanza, Versiones, retiro global.

### B.2 Alta y ficha

- [ ] Cajera: **+ Nuevo producto** (nombre, categoría, unidad, PLU). Se crea.
- [ ] Editar nombre / PLU / categoría / unidad de uno existente. Se guarda.
- [ ] PLU duplicado: error claro, no pisa al otro.
- [ ] Admin: sigue pudiendo lo mismo desde hub → Panel de administración, **cualquier** local.

### B.3 Precio y “borrar” de local

- [ ] Cajera cambia el **precio** de su local. Se refleja en el POS (próximo ítem) y en la otra PC / celu (A.1 / A.2).
- [ ] Cajera **Quitar de este local**: el producto **no** sale en el POS de ese local. En el **otro** local (si tiene precio/visible) **sigue**.
- [ ] Cajera **Mostrar en este local**: vuelve a listarse.
- [ ] Cajera **no** puede retirar el producto del negocio entero (nada tipo “eliminar de todos los locales” / liberar PLU).
- [ ] Admin sí puede retiro global (libera PLU). Ese PLU se puede reasignar.

### B.4 Auditoría

- [ ] Al editar ficha / quitar / mostrar / (admin) retiro global, en el modal se ve **quién / qué / cuándo**.
- [ ] Historial de **precios** del producto en ese local sigue listando cambios (createdBy).

### B.5 Admin vs cajera (borde)

- [ ] Admin en Panel: selector de local, KRETZ, Versiones, retiro global. Siguen ahí.
- [ ] Cajera no ve esos tres.
- [ ] Admin operando caja: Menú → Catálogo abre la misma pantalla con poderes de **admin** (rol admin). No es un bug de cajera.

### B.6 Lo que no debe pasar

- [ ] No se duplicó el producto al crearlo.
- [ ] Quitar de este local **no** borró la ficha global (el otro local lo sigue teniendo).
- [ ] El celu **no** ganó una pantalla de edición de catálogo.

---

## C — Humo rápido (si hay poco tiempo)

En este orden, con internet:

1. PC cajera: Catálogo → cambiar un precio → volver al POS → el próximo Manual ya trae el precio nuevo; el ítem que ya estaba en el ticket no cambió.
2. Celu POS mismo local: Manual muestra ese precio **sin** ↺.
3. Cajera: Quitar de este local un producto de prueba → desaparece del POS de este local, no del otro.
4. Admin PC: retiro global de un producto de prueba → desaparece en ambos; PLU libre.

---

## D — Spark (no es un ítem de caja; miralo después de un día real)

Firebase Console → proyecto `arimark-7f418` → Usage. Un día de caja: cientos / pocos miles de lecturas. Si un día se va a **decenas de miles**, avisar (listeners de colecciones grandes, no el doc de catálogo). Plan debe seguir en **Spark**.

---

## E — Si algo falla

Anotá `[!]` con local + usuario + PC o celu.

- El otro dispositivo no se entera sin ↺ → A.1 / A.2 (¿`dev` en vez de prod? ¿mismo local? ¿sin internet?).
- El ticket cambió el precio solo → A.3.
- Cajera pudo borrar el producto de todos los locales → B.3.
- Catálogo en celu para editar fichas → B.6 (no debería existir).
- Loop / parpadeo eterno de la lista → A.5.

No mezclar con Tanda 3 (carrito de pedidos) ni con login offline (DT-02).
