# Exploración de ideas — alternativas a la conexión serial directa con balanzas

> **Estado:** ideas en exploración, NO decisiones definitivas.
> El `PLAN.md` y el `AGENTS.md` no se modificaron.
> Este archivo documenta una charla del 7 de junio de 2026 para no perder el hilo si se retoman estas ideas.

---

## Contexto que motivó esta exploración

La infraestructura física de la carnicería hoy **no permite conectar todas las balanzas a la PC** mediante cable, porque están lejos del gabinete. Como mucho se podría improvisar la conexión de una sola balanza, y de forma temporal.

Esto pone en duda si tiene sentido invertir tiempo en hacer que el flujo primario de ventas pase por la conexión serial permanente, dado que la carnicería no podría aprovecharlo en el corto/mediano plazo.

---

## Idea A — Barcode como flujo primario de pesaje (en lugar del serial)

### Cómo funciona

La balanza imprime un ticket físico con un código de barras. Ese código ya contiene:

- Código de producto (PLU)
- Precio total del ítem (precio/kg × kg)

Con el código de producto se puede consultar el precio unitario en el catálogo de la app, y de ahí calcular el peso: `peso = total / precio_unitario`.

Las cajeras usarían la **app móvil** (ver Idea B) para escanear ese código con la cámara del celular en lugar de que la balanza transmita los datos por cable.

### Ventajas
- No requiere ningún hardware adicional (las cajeras ya tienen celular).
- Funciona con cualquier balanza que imprima código de barras, no solo KRETZ.
- Si la PC se apaga, el celular puede seguir registrando ventas (con sincronización posterior vía Firebase).

### Pendientes / incógnitas
- **Formato exacto del código de barras del ticket KRETZ** no está confirmado. Hay que fotografiar un ticket real y escanearlo con una app genérica de barcode para ver el texto que devuelve. Eso desbloquea todo lo demás.
  - El formato más probable es GS1-128 o Code128 con PLU + precio total.
  - El peso se derivaría: `peso = total / precio_unitario_del_catalogo`.
- La precisión del peso calculado depende de que el precio unitario en la app esté siempre actualizado y coincida con el que tenía la balanza al pesar.

### Impacto en la arquitectura existente
- La cola de pedidos (`CashierScreen`) ya acepta pedidos de cualquier fuente. Solo cambia cómo llegan los datos al proceso main.
- El driver serial seguiría existiendo para el flujo futuro (cuando la infraestructura física mejore).
- Coexistencia posible: serial cuando hay cable, barcode cuando no.

---

## Idea B — App móvil como interfaz de escaneo

### Cómo funciona

Una app web (React, misma base de código, hosteada en Firebase Hosting) que:

1. Usa la cámara del celular para leer el código de barras del ticket impreso.
2. Muestra los datos decodificados para que la cajera confirme que son correctos.
3. Al confirmar, sube el ítem a Firestore.
4. La app Electron en la PC escucha Firestore en tiempo real y recibe el ítem, incorporándolo a la cola de pedidos.

### Por qué Firebase como intermediario (y no WiFi local)
- Celular y PC no necesitan estar en la misma red.
- El celular puede estar en 4G y la PC en el WiFi del local.
- Si la PC está apagada, los ítems quedan en Firestore y se procesan al volver a encender.
- Firebase **ya está en el stack** para licencias y auth — no es tecnología nueva.
- Para empezar no hace falta publicar en la Play Store: con abrir la URL en el navegador del celular alcanza.

### Estructura propuesta en Firestore
```
pending_scale_items/{license_key}/items/{item_id}
  productCode: string
  total: number        ← precio total del ticket
  timestamp: string
  processedAt?: string ← se completa cuando la PC lo consume
```

### Pendientes / incógnitas
- Diseño UX de la app móvil (no decidido, no urgente).
- ¿Una cajera por sesión o varias usando el mismo celular? Definir flujo de login.
- Sincronización de estado: ¿qué pasa si dos cajeras escanean el mismo ticket?

---

## Idea C — Actualización de precios en balanzas ("5 minutos con cable")

### El problema
Si la app gestiona los precios, ¿cómo llegan esos precios actualizados a la balanza?

### La solución pragmática acordada
- Cuando los dueños quieran actualizar precios, conectan **una balanza por vez** al USB de la PC (~5 minutos por balanza).
- La app detecta el puerto, ofrece "Exportar lista de precios a la balanza".
- El proceso main envía la lista por el protocolo de escritura de la KRETZ.
- Desconectar, repetir con la siguiente balanza.

### Por qué esto es suficiente por ahora
- Los precios no cambian todos los días.
- 10-15 minutos de trabajo con cable es perfectamente aceptable para una actualización mensual o semanal.
- Evita la complejidad de tener todas las balanzas conectadas permanentemente.

### Pendiente crítico
- **El protocolo de escritura de la KRETZ** no está implementado ni investigado.
- iTegra ya resuelve esto, lo que confirma que es posible.
- Para avanzar se necesita: manual técnico de la balanza, o capturar con un sniffer serial qué bytes envía iTegra al exportar precios.
- **No implementar hasta tener esos datos.**

---

## Qué investigar en la próxima visita a la carnicería

Estas acciones desbloquean las tres ideas de arriba:

1. **Fotografiar y escanear el código de barras de un ticket** — con cualquier app genérica de barcode en el celular, anotar el texto completo que devuelve. Eso confirma el formato y los campos disponibles.

2. **Verificar si la KRETZ tiene puerto USB accesible** — Administrador de dispositivos de Windows, confirmar que aparece como puerto COM al conectar.

3. **Intentar conectar la balanza al puerto serial** — aunque sea brevemente, ver si el driver existente recibe frames y si el parser R30 los procesa correctamente. Ver los logs de la app.

4. **Probar la SAM4S** — conexión HTTP, credenciales, respuesta a un pago de prueba.

---

## Estado de cada idea

| Idea | Estado | Próximo paso para avanzar |
|---|---|---|
| Barcode como flujo primario | En exploración | Fotografiar ticket real y decodificar barcode |
| App móvil con cámara | En exploración | Confirmar formato del barcode primero |
| Actualización de precios con cable | Viable en principio | Conseguir protocolo de escritura KRETZ |
| Conexión serial permanente | En el plan original | Infraestructura física pendiente en la carnicería |

---

*Documentado el 7 de junio de 2026 a partir de la charla con el desarrollador.*
*No modifica PLAN.md ni AGENTS.md.*
