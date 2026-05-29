# AGENTS.md — Reglas innegociables del proyecto

Este archivo es la fuente de verdad para el agente. Se lee al inicio de cada sesión y antes de cerrar cualquier To-Do. Ninguna regla de este archivo puede ser ignorada, omitida ni relajada sin aprobación explícita del desarrollador.

---

## Gestor de paquetes

- **Usar pnpm exclusivamente.** Nunca npm ni yarn.
- Todos los comandos de instalación son `pnpm add`, `pnpm install`, `pnpm run`. Nunca `npm install` ni `npm run`.
- El archivo de lock es `pnpm-lock.yaml`. Si aparece un `package-lock.json` o `yarn.lock` en el repo, es un error y debe eliminarse.
- Configurar `.npmrc` en la raíz con `shamefully-hoist=false` y `strict-peer-dependencies=false` para compatibilidad con electron-builder.

## Selección de dependencias

Antes de agregar cualquier paquete nuevo, verificar que sea confiable. Los criterios no son rígidos sino una guía para el juicio:

- Preferir paquetes con historia probada sobre paquetes nuevos sin track record.
- Desconfiar de paquetes con menos de 1.000 descargas semanales totales salvo que sean de un autor reconocido o estén recomendados explícitamente en la documentación oficial de una herramienta del stack.
- Si el último commit tiene años pero el paquete tiene muchas descargas e issues cerrados, es una señal positiva, no negativa. Significa que está terminado, no abandonado.
- Si el paquete tiene vulnerabilidades abiertas de severidad alta o crítica reportadas en npm, buscar alternativa o justificar explícitamente antes de usarlo.
- Ante la duda entre dos opciones equivalentes, elegir la que tenga más descargas semanales.

Si el agente propone una dependencia que genera duda, debe mencionarlo antes de instalarla y esperar confirmación del desarrollador.

---

## Calidad de código y deuda técnica

El agente aplica buenas prácticas en todo código que escribe o modifica. No existe "solución rápida que ya arreglaremos después": si algo se hace mal ahora, se convierte en un problema más costoso en fases futuras.

Reglas concretas:

- **Sin atajos que generen deuda técnica.** Si la solución correcta requiere más trabajo, se hace correctamente. Si hay una restricción de tiempo o contexto que impide hacerlo bien, el agente lo indica explícitamente y espera decisión del desarrollador antes de proceder con una solución degradada.
- **Funciones y módulos con una sola responsabilidad.** Un archivo no mezcla lógica de negocio, acceso a datos y presentación.
- **Sin duplicación de lógica.** Si el mismo comportamiento se necesita en dos lugares, se extrae a una función o módulo compartido antes de copiar código.
- **Nombres descriptivos.** Variables, funciones y archivos se nombran por lo que hacen, no por lo que son (`confirmarVenta`, no `handler2`).
- **Errores siempre explícitos.** No se silencian errores con `catch` vacíos ni `console.log` sin acción. Todo error se registra con `electron-log` y se propaga o maneja de forma deliberada.
- **Si el agente detecta deuda técnica existente** mientras trabaja en un área, la señala al desarrollador aunque no sea parte del To-Do activo. No la corrige silenciosamente sin avisar (podría romper otras cosas), pero tampoco la ignora.

## UI — campos numéricos

Todo campo de entrada que espere un número entero (montos en pesos, cantidades enteras, etc.) debe seguir este patrón. **Nunca usar `type="number"`.**

- **Componente obligatorio:** `src/components/NumericInput.tsx` (utilidades en `src/lib/numericInput.ts`). No crear `<input>` numéricos ad hoc.
- **Solo dígitos:** filtrar cualquier carácter que no sea `0-9` al escribir o pegar (lo hace el componente).
- **Autoformateo:** separador de miles con punto al estilo es-AR (`1000` → `1.000`; se ajusta solo según la longitud).
- **Atributos permitidos del input:** `type="text"` e `inputMode="numeric"`. Con eso se evita el incremento/decremento con scroll y flechas de `type="number"`, y en móvil sigue apareciendo el teclado numérico.
- **Prohibido `pattern` nativo (HTML5):** no agregar `pattern="[0-9]*"` ni ningún otro `pattern` en campos con autoformateo. El navegador valida el **texto visible** del input; un valor como `1.250.000` no coincide con `[0-9]*` y bloquea el submit con *"Haz coincidir el formato solicitado."* aunque el dato sea correcto. Esta regla no tiene excepciones.
- **Validación en código, no en HTML:** la restricción a dígitos ocurre al escribir/pegar (`formatNumericInputValue`). Al enviar formulario o llamar IPC, usar `parseNumericInput()` para obtener el número entero. Mensajes de error (campo vacío, monto inválido, etc.) se muestran con lógica React/JS, no con validación nativa del browser salvo `required` si aplica.
- **Parseo al enviar:** siempre `parseNumericInput()` de `src/lib/numericInput.ts` antes de IPC o reglas de negocio. Nunca `parseFloat()` sobre el string formateado (los puntos rompen el parseo).

---

## Arquitectura — separación de capas

- Todo acceso a hardware (balanza KRETZ, caja SAM4S) y a servicios externos (Firebase) ocurre **exclusivamente en el proceso main** de Electron. Nunca en el renderer.
- El renderer (React) **nunca** abre sockets, hace fetch, ni accede a Firebase directamente.
- La comunicación entre main y renderer ocurre **únicamente mediante IPC tipado** a través del preload (`window.hw`).
- Si el agente se encuentra escribiendo código de red o hardware en el renderer, debe detenerse, reorganizar la arquitectura y avisar al desarrollador antes de continuar.

## IPC y validación

- Todo handler IPC en el proceso main **valida el payload recibido con zod** antes de procesarlo.
- Si el payload no coincide con el schema esperado, el handler lanza un error controlado y lo registra con `electron-log`.
- No hay `any` en TypeScript en ningún módulo. Si se necesita un tipo temporal, usar `unknown` y comentar el motivo.
- Todo handler IPC nuevo nace con su archivo de tests en `electron/ipc/__tests__/<handler>.test.ts` que cubre: payload válido, payload malformado (zod debe rechazar), y al menos un caso de error de negocio.

## Base de datos

- SQLite es la única fuente de verdad local. Drizzle ORM para todas las operaciones.
- Toda escritura que afecta más de una tabla va dentro de una **transacción atómica** de `better-sqlite3`. Si una transacción falla, no queda nada escrito a medias.
- Las deudas se gestionan con el **modelo de ledger** (`debt_events`). Cada cambio de estado es un evento nuevo. Nunca se sobreescribe un saldo.
- Toda tabla nueva requiere su migración generada con Drizzle Kit en la carpeta `drizzle/` antes de ser usada.
- Los tests de DB usan siempre la instancia `:memory:` de `electron/db/__tests__/helpers/inMemoryDb.ts`.

## Modo sandbox

- Los datos de sandbox **nunca se mezclan** con los de producción bajo ninguna circunstancia.
- En `APP_ENV=sandbox`: base de datos separada, hardware simulado (mocks), Firebase desactivado, banner visible en la UI.
- En `APP_ENV=production`: base de datos real, hardware real, Firebase real, sin banner.
- El `afterPack` de electron-builder verifica que ningún artefacto de sandbox ni token de Cloudflare Tunnel quede incluido en el build de producción. Si encuentra alguno, el build falla.

## Seguridad

- **Cero secretos en texto plano.** Tokens y credenciales sensibles van en `safeStorage` (Electron) o `@napi-rs/keyring`. Nunca en archivos de texto ni en el repo.
- Ningún secret, API key ni credencial se hardcodea en el código fuente. Todo va en variables de entorno inyectadas en tiempo de build.
- Las variables de entorno de producción nunca se incluyen en el repositorio (`.env*` está en `.gitignore`).
- El build de producción no contiene tokens de Cloudflare Tunnel. El Cloudflare Tunnel es exclusivamente una herramienta de desarrollo del desarrollador, no una feature de la app.

## Agnóstico al cliente

- Ningún nombre de cliente (`Arimark` u otro), logo, color de marca ni configuración visual se hardcodea en el código fuente.
- Todo valor específico del cliente viene de `config/business.json` (cargado y validado con zod al iniciar la app).
- Si el agente necesita un nombre de negocio para un ejemplo o un placeholder, usa `"Nombre del negocio"` o similar. Nunca `"Arimark"` dentro del código.

## Testing — regla de cierre de To-Do

**Ningún To-Do pasa a `completed` sin cumplir los siguientes pasos en orden:**

1. Ejecutar `pnpm run test` y esperar que la suite reporte **100% verde**.
2. Si algún test falla, corregirlo antes de continuar. No se cierra el To-Do con tests rotos.
3. Verificar cobertura mínima del 80% en líneas para los módulos de IPC, DB y reglas de negocio (`pnpm run test:coverage`).
4. Hacer commit con el formato acordado (ver sección Commits).

Esta regla no tiene excepciones. Si el agente propone cerrar un To-Do sin ejecutar los tests, el desarrollador debe rechazarlo.

## Commits

**Formato obligatorio:**
```
tipo(alcance): descripción corta en minúsculas
```

Tipos válidos:
- `feat` — funcionalidad nueva
- `fix` — corrección de bug
- `test` — agregar o corregir tests
- `chore` — configuración, infraestructura, dependencias
- `refactor` — restructuración sin cambio de comportamiento
- `docs` — documentación

Ejemplos correctos:
```
feat(fase0): implementar verificación de licencia en Firebase
fix(ipc): corregir validación zod en handler de ventas
test(db): agregar tests de transacciones de deuda
chore(bootstrap): configurar pnpm y electron-builder
```

**Reglas de commit:**
- Hacer commit **antes de cerrar cada To-Do**, después de que los tests estén en verde.
- Hacer commit **antes de cualquier migración de DB** (preservar el estado anterior).
- Al cerrar cada fase completa, crear un tag de git:
  ```
  git tag -a faseN-completa -m "Fase N cerrada: descripción breve"
  ```
- Nunca hacer un commit con tests rotos.
- Nunca hacer un commit que incluya archivos `.env`, `*.sqlite` de producción, o credenciales.

**Push a GitHub al cierre de fase:**
Al cerrar cada fase (commit + tag listos), el agente **no hace push automáticamente**. El desarrollador realizará un testeo manual para comprobar que todas las funcionalidades nuevas agregadas funcionen según lo esperado. Si todo sale bien, el desarrollador dará el permiso explícito para que el agente ejecute `git push origin` y `git push origin --tags` (siempre que exista remoto configurado).

**Checkpoint — guardado y push bajo demanda:**
Si el desarrollador escribe la palabra **checkpoint** en cualquier forma (por ejemplo: "haz un checkpoint", "checkpoint", "Checkpoint"), el agente interpreta que se está pidiendo: hacer commit de todo lo pendiente (si hay cambios), y pushear a GitHub el estado actual (`git push origin` + `git push origin --tags`).
Si el contexto del mensaje es ambiguo y no queda claro si "checkpoint" se refiere a guardar/subir a GitHub o a otra cosa, el agente **debe consultar** antes de actuar.

## Hardware — mocks

- Los mocks de hardware (`__mocks__/kretzDriver.ts` y `__mocks__/fiscalDriver.ts`) **nunca se incluyen en el bundle de producción**. El `afterPack` lo verifica.
- En `APP_ENV=sandbox`, la app usa automáticamente los mocks.
- En tests, los mocks se importan directamente.
- Los modos de fallo inyectables (`timeout`, `garbage`, `disconnect`, `malformed_response`) deben estar implementados y testeados antes de cerrar la Fase 1.

## Tareas bloqueantes — no implementar hasta tener datos

- **Modo de emergencia con escaneo de tickets de balanza:** no implementar hasta haber inspeccionado empíricamente qué datos contiene el código de barras/QR del ticket de la KRETZ RPF US30P2CAR con la configuración de código por producto activa. Esta tarea está documentada en la Fase 1 como bloqueante. Si el agente llega a ese punto sin que el desarrollador haya provisto los datos, debe detenerse y solicitar la información.
- **Fase 6 (Stock):** no codificar hasta que el desarrollador confirme haber tenido la charla con el carnicero titular sobre el manejo de ingreso de mercadería. La estructura preliminar existe en el esquema pero el flujo operativo está pendiente de definición.

---

## Checklist de cierre de fase

Al terminar cada fase, antes de crear el tag de git, verificar:

- [ ] `pnpm run test` reporta suite 100% verde.
- [ ] Cobertura ≥ 80% en módulos de IPC, DB y reglas de negocio.
- [ ] Todas las migraciones de DB de la fase están en `drizzle/` y probadas con `migrations.test.ts`.
- [ ] El checklist de seguridad del prompt fue revisado ítem por ítem.
- [ ] El build de producción fue compilado y el `afterPack` no reportó errores.
- [ ] No hay `any` introducido en esta fase sin justificación documentada.
- [ ] No hay secrets en el código ni en archivos trackeados por git.
- [ ] Commit de cierre realizado con el formato acordado.
- [ ] Tag de fase creado: `git tag -a faseN-completa -m "..."`.
