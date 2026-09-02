# Checklist — catálogo en vivo (I-A) + edición por cajera (I-B)

Convención: `[ ]` pendiente · `[x]` OK · `[!]` bug nuevo.

Fecha sugerida de prueba: a partir de 2026-08-30.

La ola anterior (resumen post-cierre + local habitual) **ya está cerrada**. Este archivo se reutiliza para no acumular checklists.

Hace falta **producción o** `pnpm dev:prod`: en `pnpm dev` Firebase está apagado y el listener no corre.

**PC:** dos instancias si podés (caja A + admin/otra PC), o una PC + celu.
**Celu:** Hosting [https://arimark-7f418.web.app](https://arimark-7f418.web.app) (`pnpm mobile:deploy` al cerrar este trabajo). El APK no se actualiza con ese deploy. Recargá forzado si el service worker no trae el bundle nuevo.

---



## A — Catálogo en vivo (I-A)

Objetivo: altas / precios / bajas llegan a otras PCs y al celu **sin** pulsar ↺.

Precondición: internet. Dos dispositivos en el **mismo** local (o PC + celu POS de ese local).

### A.1 PC → otra PC (o reabrir el POS)

- [x] En PC 1 (admin o cajera) cambiá el **precio** de un producto y guardá.
- [x] En PC 2, con el POS o **Catálogo** abierto, el precio nuevo aparece **sin** ↺ (unos segundos).
- [x] En PC 1 **creá** un producto nuevo (nombre + PLU + precio de ese local).
- [x] En PC 2 el producto nuevo aparece en Catálogo / Manual / vales, **sin** ↺.
- [x] En PC 1 (admin) hacé **retiro global** de un producto de prueba (libera PLU). En PC 2 deja de listarse.



### A.2 PC → celu (POS)

- [x] Celu: cajera (o admin → Operar como cajera) → POS del **mismo** local, con internet.
- [x] PC cambia precio o alta. En el celu, Manual / búsqueda muestra el dato nuevo **sin** ↺ ni re-login.
- [x] ↺ en el celu **sigue funcionando** (respaldo): no rompe ni duplica productos.



### A.3 Ticket / carrito (borde)

- [x] PC: cargá un ítem al ticket (ej. Asado a $X). En la **otra** PC o en Catálogo cambiale el precio de lista a $Y.
- [x] El ítem **ya en el ticket** sigue a $X. El **próximo** escaneo / Manual usa $Y.
- [x] Lo mismo en celu: línea ya en el carrito no se recalcula; el siguiente alta sí.



### A.4 Offline / ↺ (borde)

- [x] Sin internet, el POS sigue con el catálogo cacheado (no pantalla vacía).
- [x] Al volver internet, un cambio publicado mientras estabas offline llega (listener o ↺).
- [x] Un ↺ con internet no borra productos que esa PC tiene y el snapshot no traía (merge, no pisado).



### A.5 Lo que no debe pasar

- [x] La app no se pone lenta ni “parpadea” el catálogo en loop (eco de publicación).
- [x] No hay panel de **editar** catálogo en el celu (alta/precio/ficha). Recibir lista sí.
- [x] La balanza **no** se actualiza sola; hay que pulsar **Cargar en balanza** (PC, cajera o admin).

---



## B — Edición por cajera (I-B) — solo PC



### B.1 Entrada

- [x] Cajera, turno abierto → Menú → **Catálogo**. Es un overlay sobre el POS (misma tabla compacta de antes). Ya no hay un ítem aparte «Lista de productos».
- [x] El carrito del POS **sigue ahí** al cerrar el overlay.
- [x] Título **Catálogo de productos**. No dice “Administración”. No hay selector de otro local.
- [x] **Sí** aparece **Cargar en balanza**. **No** aparecen Versiones ni retiro global.



### B.2 Alta y ficha

- [x] Cajera: **+ Nuevo producto** (nombre, categoría, unidad, PLU). Se crea.
- [x] Editar nombre / PLU / categoría / unidad de uno existente. Se guarda.
- [x] PLU duplicado: error claro, no pisa al otro.
- [x] Admin: sigue pudiendo lo mismo desde hub → Panel de administración, **cualquier** local.



### B.3 Precio y “borrar” de local

- [x] Cajera cambia el **precio** de su local. Se refleja en el POS (próximo ítem) y en la otra PC / celu (A.1 / A.2).
- [x] Cajera **Quitar de este local**: el producto **no** sale en el POS de ese local. En el **otro** local (si tiene precio/visible) **sigue**.
- [x] Cajera **Mostrar en este local**: vuelve a listarse.
- [x] Cajera **no** puede retirar el producto del negocio entero (nada tipo “eliminar de todos los locales” / liberar PLU).
- [x] Admin sí puede retiro global (libera PLU). Ese PLU se puede reasignar.



### B.4 Auditoría

- [x] Al editar ficha / quitar / mostrar / (admin) retiro global, en el modal se ve **quién / qué / cuándo**.
- [x] Admin: **restaurar una versión** deja en Historial del producto quién / qué / cuándo (etiqueta **Versión**).
- [x] Historial de **precios** del producto en ese local sigue listando cambios (createdBy).



### B.5 Admin vs cajera (borde)

- [x] Admin en Panel (hub): selector de local, KRETZ, Versiones, retiro global. Siguen ahí.
- [x] Cajera: Cargar en balanza sí; Versiones y retiro global no.
- [x] Admin operando caja: Menú → Catálogo abre el **mismo overlay** que la cajera (con Cargar en balanza). Versiones / retiro global siguen en el hub.



### B.6 Lo que no debe pasar

- [x] No se duplicó el producto al crearlo.
- [x] Quitar de este local **no** borró la ficha global (el otro local lo sigue teniendo).
- [x] Celu: el POS **recibe** altas/precios/bajas, pero **no** hay pantalla para crear productos, editar ficha ni cambiar precios. Eso se hace solo en la PC.

---

## C — Humo rápido (si hay poco tiempo)

En este orden, con internet:

1. PC cajera: Menú → Catálogo → cambiar un precio → cerrar overlay → el próximo Manual ya trae el precio nuevo; el ítem que ya estaba en el ticket no cambió.
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
- Catálogo en celu para editar fichas / precios → B.6 (no debería existir: el celu solo vende).
- Loop / parpadeo eterno de la lista → A.5.

No mezclar con Tanda 3 (carrito de pedidos) ni con login offline (DT-02).