# Dominio funcional de Stock

Este documento es la fuente de verdad para la Fase 8. Registra las decisiones acordadas con los dueños del negocio y el criterio de diseño del sistema. No contiene tablas, migraciones, clases ni algoritmos concretos. Eso corresponde al momento de implementación.

---

## Filosofía del sistema

El sistema no aprende solo ni modifica reglas de negocio automáticamente. Tiene memoria, no autonomía.

Principios no negociables:

- **La aplicación registra, no supone.** Si un hecho ocurrió, queda registrado con fecha, origen y quién lo cargó. Si no se registró, el sistema lo ignora o lo estima explícitamente.
- **La aplicación proyecta, no afirma.** Cuando la información real no está disponible, el sistema calcula una disponibilidad estimada usando perfiles aprobados, y la comunica como estimación, nunca como certeza.
- **La aplicación conserva evidencia, no la descarta.** Ninguna corrección, conteo ni ajuste borra los eventos históricos. La historia es inmutable; el estado actual puede actualizarse, pero siempre dejando trazabilidad.
- **La aplicación sugiere, no decide.** Cuando el análisis histórico detecta que los datos observados divergen sistemáticamente de los perfiles vigentes, el sistema puede sugerir una recalibración. La decisión de aplicarla siempre queda en un administrador.

El objetivo del módulo no es reemplazar el criterio del carnicero. Es conservar años de información organizada y consultable para detectar tendencias que la memoria humana no puede mantener.

---

## Tres capas conceptuales

Toda información del sistema pertenece a exactamente una de estas tres capas. No mezclarlas es la decisión de diseño más importante del módulo.

### 1. Hechos observados

Son eventos que ocurrieron en el negocio y cuya existencia se constata o declara. Son la materia prima del sistema.

El sistema los almacena tal cual fueron registrados, con fecha y contexto. No los modifica retroactivamente.

Ejemplos: ingreso de una media res, una venta confirmada, el resultado de un conteo físico, el descarte de mercadería vencida.

### 2. Estimaciones operativas

Son cálculos derivados de hechos observados mediante reglas configuradas y aprobadas por un administrador.

La distinción clave: **el hecho es real; la estimación es la distribución probable de ese hecho**. Por ejemplo, una media res ingresó realmente. Lo que el sistema estima, usando el perfil de rendimiento vigente, es cuántos kilos de asado, vacío, costillar y otros cortes probablemente quedaron disponibles tras el desposte, cuando ese desposte no fue pesado corte por corte.

Las estimaciones se calculan en el momento en que se necesitan y usan siempre el perfil vigente en ese instante. El historial de qué perfil se usó en cada momento debe conservarse para poder auditar o recalcular.

### 3. Correcciones observadas

Son conteos físicos o ajustes deliberados que actualizan la disponibilidad actual.

Una corrección no borra las estimaciones anteriores ni convierte retroactivamente el pasado en certeza. Registra que en una fecha determinada se observó una disponibilidad real, y deja explícita la diferencia frente a lo que el sistema estimaba en ese momento. Esa diferencia es información valiosa: permite detectar si el perfil de rendimiento subestima o sobreestima sistemáticamente un corte.

---

## Disponibilidad: una existencia total, clasificada por condición

El negocio no necesita dos inventarios independientes para fresco y congelado. Necesita una misma existencia del producto, clasificada por la condición en que se encuentra.

El **total de disponibilidad** de un producto es la suma de sus condiciones. Cada condición tiene significado operativo propio.

### Condiciones definidas

**Disponible para venta inmediata**

Incluye mostrador y cámara refrigerada cuando ambos están aptos para despacho. Es la disponibilidad que responde a la demanda del día.

Ejemplos de cambios que la afectan: venta, conteo que actualiza la cantidad, descarte de producto deteriorado, traspaso al estado congelado.

**Congelado**

Forma parte del total del producto, pero el negocio lo interpreta distinto. Si hay mucho stock congelado, puede decidirse comprar menos, intentar vender ese stock primero o simplemente reconocer que existe un respaldo. No es disponibilidad inmediata, pero sí es disponibilidad real.

Ejemplos de cambios que la afectan: congelar producto fresco, descongelar para pasar a disponible inmediato, descarte por falla de cadena de frío.

**Otros estados operativos (solo si generan una decisión real)**

Estados como reservado, bloqueado o pendiente de descarte solo se incorporan al modelo si crean una decisión operativa diferente para el negocio. Agregar estados por completitud sin que modifiquen ningún flujo solo agrega complejidad sin valor.

### Lo que no requiere registro como cambio de condición

Mover mercadería entre cámara y mostrador dentro de la misma condición operativa (ambos disponibles para venta inmediata) no exige un evento de cambio. Solo es relevante si cruza una frontera de condición.

---

## Mapa de eventos

### Eventos que deben registrarse siempre

| Evento | Quién registra | Por qué es obligatorio |
|--------|---------------|------------------------|
| Ingreso de mercadería | Admin / responsable de recepción | Es el punto de partida de cualquier estimación. Sin este evento el sistema no puede calcular disponibilidad. |
| Venta confirmada | Caja (automático desde el POS) | Ya queda registrada por la venta; debe descontar del producto o corte correspondiente. |
| Conteo físico por condición | Admin / encargado | Es la observación real. Debe indicar cuánto hay disponible y cuánto congelado, no solo el total. |
| Descarte o merma excepcional | Admin / encargado | Evita que una pérdida conocida parezca un error del perfil o una venta faltante. |
| Devolución al proveedor | Admin / responsable de recepción | La mercadería que vuelve a salir no debe permanecer como disponibilidad estimada. |
| Cambio de condición relevante | Encargado | Congelar o descongelar producto cambia la disponibilidad operativa aunque no altere el total. |

### Eventos que pueden estimarse

| Evento | Quién define la regla | Condición |
|--------|----------------------|-----------|
| Desposte y distribución entre cortes | Perfil de rendimiento aprobado por admin | Solo cuando el desposte no fue pesado corte por corte. El ingreso de la media res sigue siendo un hecho; solo la distribución es estimada. |
| Rendimiento de subproductos | Perfil de rendimiento aprobado | Cuando no compensa registrar cada kg de hueso, grasa o recortes; se acepta una proporción fija. |
| Conversión entre presentaciones | Regla operativa aprobada | Solo si el negocio acepta una equivalencia estable. De lo contrario debe registrarse como transformación real. |

### Eventos que el conteo semanal puede absorber

| Evento | Condición |
|--------|-----------|
| Merma menor de manipulación | Recortes pequeños, evaporación, diferencias de balanza marginales. Solo absorbible si no se vuelve repetitivo o significativo. |
| Reubicación dentro de la misma condición | Cámara a mostrador o viceversa, cuando ambos son disponible inmediato. |
| Errores menores de identificación | Producto en PLU vecino o diferencia mínima de peso. Si son repetitivos, deben registrarse. |

### Eventos cuya regla debe definirse antes de implementar

Estos eventos existen en el negocio pero su tratamiento correcto aún no está acordado. **No implementar flujos para ninguno de ellos sin una decisión explícita.**

| Evento | Decisión pendiente |
|--------|-------------------|
| Devolución de cliente | ¿El producto vuelve a disponibilidad, va a descarte o sale del sistema? Depende de la inocuidad y el estado del producto. |
| Transferencia entre locales | ¿Cómo se registra la salida en el local origen y el ingreso en el destino? ¿Requiere confirmación bilateral? |
| Ajuste por corrección retroactiva | ¿Qué campos son obligatorios? ¿Quién puede aprobar una corrección? ¿Qué motivos son válidos? |
| Consumo interno o entrega sin venta | ¿Cuándo es lo suficientemente significativo para registrarse? ¿Tiene su propio tipo de evento o se clasifica como descarte? |

---

## Perfiles de rendimiento

Un perfil de rendimiento describe la distribución estimada de un animal entero (o media res) entre sus cortes y subproductos. Es la regla que convierte un hecho observado (ingreso) en disponibilidad estimada por corte.

### Propiedades de diseño

- Son configurables y explícitamente versionados. El historial de versiones se conserva para poder auditar qué perfil se usó en cada estimación.
- Son estables: no cambian solos. Solo un administrador puede crear una nueva versión y activarla.
- Operan con rangos, no con porcentajes únicos. El negocio habla naturalmente en rangos ("un costillar pesa entre 8 y 10 kg en una res de 100 kg") porque incluso con un único proveedor hay variación. El sistema usa el punto medio del rango como valor de estimación y puede mostrar el intervalo como incertidumbre.
- Guardan todos los datos utilizados para construirlos, no solo el porcentaje final. Esto permite recalcular o auditar el perfil en el futuro sin perder la evidencia que lo originó.

### Recalibración

Cuando el análisis histórico detecta que los conteos físicos observados difieren sistemáticamente de las estimaciones producidas por el perfil vigente, el sistema puede presentar una sugerencia de recalibración. Esa sugerencia incluye:

- La diferencia observada y su magnitud.
- El número de semanas o ciclos en que se observó la discrepancia.
- El nuevo rango sugerido para el corte afectado.

La aprobación y activación de un perfil nuevo es siempre manual. El sistema no toca los perfiles vigentes por su cuenta.

### Límite estadístico de la muestra inicial

La semana de recolección de datos acordada con los dueños producirá una muestra de pocos animales. Con tres o cuatro animales el intervalo calculado puede ser más ancho que el que el carnicero ya conoce de memoria. El valor de ese período de recolección es crear una base formal y reproducible, no obtener precisión estadística definitiva. El perfil mejorará con el tiempo conforme se acumule evidencia.

---

## Distinciones funcionales críticas

Estas son las confusiones más comunes que deterioran un sistema de inventario. Deben reflejarse en la interfaz y en el modelo de datos.

**Ingreso ≠ transformación**
Recibir una media res confirma que la mercadería existe en el local. El desposte estima cómo se distribuye entre cortes. Son dos eventos separados: el primero es un hecho, el segundo es una estimación.

**Disponibilidad estimada ≠ existencia física**
La interfaz nunca debe mostrar la disponibilidad estimada como si fuera un hecho medido. El sistema debe comunicar visualmente cuándo un número proviene de una estimación y cuándo proviene de un conteo físico reciente.

**Conteo físico ≠ ajuste silencioso**
El conteo informa una observación real en una fecha concreta. La diferencia entre el conteo y la disponibilidad estimada previa es información, no un error a borrar. El sistema conserva esa diferencia.

**Descarte ≠ venta**
Ambos reducen disponibilidad, pero tienen significado distinto para la gestión del negocio. Mezclarlos oculta las pérdidas y distorsiona tanto el análisis de ventas como el de merma.

**Condición de disponibilidad ≠ ubicación física**
Cámara y mostrador pueden representar la misma condición operativa. El congelador representa una condición distinta. El modelo se organiza por condición, no por ubicación.

---

## Riesgos y límites conocidos

Estos riesgos no bloquean el diseño pero deben estar presentes al momento de construir la interfaz y escribir los tests.

**Calidad de los registros de entrada**
Si los ingresos se registran tarde, de forma incompleta o con pesos aproximados, todas las estimaciones derivadas heredan ese error. La trazabilidad y la posibilidad de corrección auditada son más importantes que acumular volumen de datos.

**Error acumulado intrasemanal**
Cada deducción de ventas acumula el error del perfil de rendimiento. Para el viernes de una semana con varios ingresos, la disponibilidad estimada puede estar notablemente alejada de la realidad. La interfaz debe mostrar cuántos días han pasado desde el último conteo para que el usuario calibre su confianza en el número.

**Falsa causalidad en las diferencias**
Una discrepancia repetida entre estimación y conteo puede tener múltiples causas: perfil desajustado, animal atípico, ventas no registradas, descarte no declarado, error del conteo. El sistema puede señalar la discrepancia pero no puede determinar su causa. No debe presentarla como si la causa fuera obvia.

**Cambios de contexto en el tiempo**
Los perfiles construidos con datos de un proveedor pueden no ser válidos para otro. Los cambios de proveedor, temporada o práctica de desposte deben poder anotarse para que los análisis históricos puedan segmentarse por período o contexto, evitando comparaciones entre períodos incomparables.

**Cobertura parcial del catálogo**
El modelo de perfil de rendimiento aplica naturalmente a vacuno en media res. Pollo, cerdo, embutidos y productos procesados requieren modelos distintos o simplemente no aplica. Antes de implementar el ingreso de cada categoría debe definirse qué tipo de evento representa y si tiene o no un perfil de rendimiento asociado.

---

## Decisiones pendientes antes de implementar

Las siguientes decisiones no están acordadas y bloquean partes específicas de la implementación. No avanzar en esos bloques hasta tenerlas resueltas.

1. ¿Cómo se modela el ingreso de pollo, cerdo, embutidos y congelados? (El perfil de media res vacuna no aplica directamente a ninguno de ellos.)
2. ¿Qué ocurre con las devoluciones de clientes? (¿Vuelven al stock, van a descarte, o depende del producto?)
3. ¿Cómo se registran las transferencias entre locales? (¿Quién confirma la recepción? ¿Requiere aprobación bilateral?)
4. ¿El conteo físico semanal se ingresa en la app? (Si no entra en la app, no puede usarse como ancla de corrección.)
5. ¿Las alertas de disponibilidad baja se muestran en la pantalla de caja, en el panel admin, o en ambos?
6. ¿Qué umbral define que una discrepancia es suficientemente sistemática para sugerir una recalibración?
