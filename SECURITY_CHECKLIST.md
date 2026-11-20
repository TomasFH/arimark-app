# SECURITY_CHECKLIST.md — Sistema de gestión Arimark

## Cómo se usa

1. **Al cerrar cada módulo**, recorrer las secciones que apliquen (A a H) y marcar cada punto con `[x]` anotando la evidencia (archivo, línea o comando). Lo que no se pueda marcar queda como `[ ]` con una nota.
2. **Antes del lanzamiento**, completar la sección I y revisar todo lo marcado como CRÍTICO.
3. Un módulo **no se da por cerrado** si tiene puntos `[C]` (críticos) sin marcar.
4. Quien revise (persona o agente) **informa y no cambia código** salvo que se lo pidan aparte.

Leyenda: `[C]` = crítico, `[ ]` = pendiente, `[x]` = verificado.

---

## A. Secretos y configuración

- [C] [ ] No hay claves, tokens, contraseñas ni credenciales de servicio escritos en el código (buscar `apiKey`, `secret`, `private_key`, `token`, `password` en todo el repo).
- [C] [ ] Los archivos `.env` están en `.gitignore` y no aparecen en el historial de git.
- [ ] Las variables que empiezan con `VITE_` llegan al programa que ve el usuario: solo se usan para datos que pueden ser públicos (la configuración web de Firebase lo es; una clave de administrador **no**).
- [C] [ ] No hay credenciales de cuenta de servicio de Firebase dentro de la app ni del repo.
- [ ] Los registros (logs) no imprimen tokens, contraseñas ni datos personales de clientes.
- [ ] Los modos de prueba (por ejemplo `VITE_APP_ENV=dev` y los datos de ejemplo) no existen ni se muestran en producción.
- [ ] Se sabe qué comandos usan Firebase de producción (por ejemplo `dev:prod`) y se usan con cuidado.

## B. Reglas de Firestore (quién puede leer y escribir en la nube)

*Las reglas son el filtro que decide qué puede leer o escribir cada usuario en la base de la nube. Si están flojas, cualquiera con una sesión puede ver o cambiar datos del negocio.*

- [C] [ ] Ninguna regla es `allow read, write: if true`, ni se limita a `if request.auth != null` sin más condiciones.
- [C] [ ] El acceso depende del **rol** (cajera, admin, dueño). Está definido cómo se identifica el rol (por ejemplo un documento de usuario o claims) y las reglas lo usan.
- [C] [ ] El acceso depende del **local o licencia**: un usuario solo accede a los datos de su licencia y su local.
- [C] [ ] Los datos delicados (gastos, fichas de plata, sueldos, vales, fiados, datos de clientes) solo los lee el rol que corresponde.
- [ ] Las escrituras validan tipos y campos permitidos (montos numéricos, sin campos inesperados), y no cualquier usuario puede modificar los campos de plata de un turno cerrado.
- [ ] Las reglas se probaron con casos concretos: sin sesión, cajera de otro local, cajera intentando leer gastos o sueldos, cajera intentando modificar una ficha.
- [ ] Los índices necesarios existen y no hay consultas que bajen colecciones enteras.
- [ ] Cada cambio de reglas se hace por separado, se prueba y recién después se publica.

## C. Cuentas y acceso dentro de la app

- [C] [ ] Las pantallas de administración (Admin Hub, Resumen) solo están disponibles para el rol admin, y **se valida en el proceso principal**, no solo ocultando botones.
- [ ] Las contraseñas no se guardan en texto plano ni se muestran en pantalla.
- [ ] Las sesiones se cierran al cerrar sesión y no quedan datos de otro usuario visibles.
- [x] Está decidido qué pasa con la activación de licencias y los usuarios anónimos por PC: queda fuera de la 1.0, sin límite de dispositivos (hallazgo 2).

## D. App de escritorio (Electron)

- [C] [ ] `contextIsolation` activado y `nodeIntegration` desactivado.
- [ ] El archivo `preload` solo expone funciones concretas, no `ipcRenderer` completo ni acceso libre a archivos.
- [C] [ ] Cada canal IPC (la comunicación entre pantalla y programa principal) valida el rol de quien lo llama y los datos que recibe. Los canales de admin (correcciones de caja, cierre forzado, Resumen) exigen admin.
- [ ] La app no carga páginas externas ni ejecuta código descargado; hay una política de contenido (CSP).
- [ ] Los enlaces externos se abren en el navegador del sistema.
- [ ] Las actualizaciones de la app llegan por un canal confiable.

## E. Base de datos local (SQLite) y datos de clientes

- [C] [ ] Las migraciones nuevas se probaron **sobre una copia de la base real** antes de actualizar una PC de local.
- [ ] Las columnas nuevas aceptan vacío (nulo) cuando "sin dato" no es lo mismo que 0.
- [C] [ ] Antes de actualizar cada PC de local se hace una **copia de seguridad** de `app.sqlite`.
- [ ] Los datos personales de clientes (nombre, teléfono, deudas) solo se muestran a quien corresponde y no se exportan ni se registran sin necesidad.
- [ ] Se sabe qué acciones **escriben** en producción sin que el usuario lo note (por ejemplo, el Resumen sella fichas de turnos cerrados sin ficha).
- [ ] Hay un procedimiento escrito para reiniciar datos de prueba (base de cada PC y Firebase).

## F. Costo y cuota de Firestore

- [C] [ ] No hay listeners nuevos ni `getDocs` de colecciones enteras sin revisar.
- [ ] Cada pantalla tiene estimadas las lecturas que gasta al abrirse (con ejemplo de una semana y un mes con dos locales).
- [ ] Hay un test que falla si una pantalla lee más de lo previsto (por ejemplo, abrir un mes con fichas completas no debe leer ventas ni gastos).
- [ ] Se revisa el uso real en la consola de Firebase durante la primera semana de uso.
- [ ] Hay alertas de presupuesto o cuota configuradas.

## G. Hardware (balanzas KRETZ y otros dispositivos)

- [C] [ ] Si un dispositivo no responde, la app muestra un error claro y **la caja sigue funcionando** (no se traba una venta ni un cierre).
- [ ] Hay tiempos de espera (timeouts) y reconexión; un error de hardware no hace perder una venta.
- [ ] Los datos que llegan de la balanza se validan (peso numérico y dentro de un rango razonable).
- [ ] El acceso a puertos y controladores no queda expuesto a la parte visible de la app.

## H. Dinero y datos contables (específico de este sistema)

- [C] [ ] Un dato ausente se muestra como "sin dato", **nunca como 0**.
- [C] [ ] No se mezclan: ventas, cobranzas de fiados, aportes o ingresos de efectivo, y transferencias entre locales.
- [ ] Los totales que deben coincidir se concilian (por ejemplo débito + billetera + crédito = tarjeta y billetera). Si no coinciden, se muestra la diferencia y **no se ajusta el número**.
- [C] [ ] Un cambio en el cierre de caja **nunca puede hacer fallar el cierre** (los errores se registran y el cierre continúa).
- [ ] Anular o corregir deja registro de quién lo hizo y cuándo.

---

## I. Antes del lanzamiento (revisión final)

- [C] [ ] Revisión completa de `firestore.rules` con la sección B, con pruebas.
- [C] [ ] Búsqueda de secretos en todo el repo y en el historial de git.
- [ ] Modos de prueba, usuarios de prueba y datos de prueba eliminados.
- [ ] Todas las PC de los locales actualizadas a la misma versión, con copia de seguridad previa.
- [ ] Plan para volver atrás: cómo recuperar la versión anterior de la app y restaurar `app.sqlite`.
- [ ] Copias de seguridad periódicas de Firestore definidas.
- [ ] Acceso a las cuentas del proyecto (Firebase/Google y GitHub) protegido con verificación en dos pasos.
- [ ] Alertas de cuota y presupuesto activas.

---

## Hallazgos abiertos conocidos

*Reportados durante el desarrollo del Resumen (nov 2026). Confirmar y cerrar antes del lanzamiento.*

1. **Reglas de Firestore flojas (sección B):** según el análisis del agente, `firestore.rules` deja leer y actualizar `shifts` y leer `expenses` a cualquier usuario autenticado, sin lista de campos y sin distinguir roles.
2. **Activación de equipos (sección C) — decisión tomada, no es un pendiente:** queda fuera de la 1.0 porque la app es familiar. No se limita la cantidad de dispositivos. El arranque puede seguir con una sesión anónima y el control de activación sigue apagado a propósito. Esa sesión no entra a los datos operativos: eso lo resuelven las reglas (hallazgo 1), no la activación.
3. **Escrituras en producción por backfill (sección E):** abrir el Resumen en un período con turnos cerrados sin ficha escribe la ficha en Firestore.
4. **Migración `0059` (sección E):** probar sobre una copia de la base real y confirmar que las columnas nuevas aceptan vacío.
5. **Ficha corta con dos PC (sección H):** si dos PC vendieran en el mismo turno, la ficha podría quedar baja sin aviso. Hoy no ocurre porque hay una sola PC por local y la app rechaza abrir un turno si ya hay uno abierto.

---

## Registro de revisiones

| Fecha | Módulo | Revisó | Resultado | Pendientes |
|---|---|---|---|---|
| 2026-11-18 | Resumen en la PC de los dueños (pollo, medias, desglose de pagos, detalle de gastos) | — | Sin revisar | Secciones B, C, D y E; hallazgos 1 a 4 |
| 2026-11-20 | Horas por ficha, cobertura semanal, fiados, transferencias y los dos arreglos de sesión y copia previa | agente | Revisado en el repo, sin publicar reglas ni índices | Publicar reglas e índices; probar 0063 sobre una copia de la base real; el hallazgo 1 del texto viejo ya no está en el repo, pero la nube publicada no se verificó |
