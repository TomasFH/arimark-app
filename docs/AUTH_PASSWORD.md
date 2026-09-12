# Contraseña del usuario (FEAT-AUTH-PASSWORD-01)

Cada cajera, admin o carnicero cambia o restablece **su** clave. El admin no la resetea ni la ve.

En la app:

- Login (PC y celu): **¿Olvidaste tu contraseña?** → `sendPasswordResetEmail` (el mismo que el alta de cuenta).
- Ya logueado: **Cambiar contraseña** (actual + nueva). Si Firebase pide login reciente, se reautentica con la actual o se ofrece el mail.

## Plantilla del mail — no vive en el repo

El HTML, el asunto y el cuerpo se editan **solo** en Firebase Console:

1. [Firebase Console](https://console.firebase.google.com) → el proyecto de la app.
2. **Authentication** → **Templates** → **Password reset**.
3. Pasar el idioma a **español** y pegar asunto/cuerpo (abajo hay un texto sugerido).
4. **Project settings** → **Public-facing name**: copiar el `business_name` de `apps/desktop/config/business.json`. La plantilla usa `%APP_NAME%`; así el nombre del negocio no se hardcodea en el código.

El remitente en **Spark** sigue siendo el de Firebase (`noreply@<proyecto>.firebaseapp.com`). SMTP propio o dominio propio = plan Blaze; queda fuera de este FEAT.

`sendPasswordResetEmail` **no** puede inyectar el HTML desde la app. Si el mail llega en inglés, la plantilla de la consola no se cambió.

### Texto sugerido (pegar en la consola)

Asunto:

```
Restablecé tu contraseña de %APP_NAME%
```

Cuerpo (el editor de Firebase admite HTML; `%LINK%` es obligatorio):

```
<p>Hola,</p>
<p>Recibimos un pedido para restablecer la contraseña de tu cuenta en <strong>%APP_NAME%</strong>.</p>
<p><a href="%LINK%">Restablecer contraseña</a></p>
<p>Si no pediste este cambio, ignorá este mail. Tu contraseña no se modifica hasta que uses el enlace.</p>
```

`%APP_NAME%` tiene que coincidir con `business_name` de `business.json` (nombre público del proyecto). No poner el nombre del cliente a mano en el código de la app.
