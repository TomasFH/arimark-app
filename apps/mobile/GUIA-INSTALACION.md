# POS Móvil — Guía de instalación y uso

La app móvil es el **respaldo de emergencia**: sirve para cerrar ventas desde el
celular cuando la PC no está disponible (corte de luz) o no hay lector, con o sin
internet. Se distribuye de dos formas según el teléfono:

- **Android** → app nativa (`.apk`) instalable. Siempre abre offline.
- **iPhone** → PWA que se agrega a la pantalla de inicio desde Safari.

En ambos casos **no hay PIN ni claves offline**: la cajera inicia sesión una sola
vez con internet y la app la recuerda para siempre en ese celular.

---

## 1. Android (instalar el `.apk`)

1. Compartirle a la cajera el archivo `.apk` (por WhatsApp, link, etc.).
2. Al abrirlo, Android pedirá permitir **"Instalar apps de orígenes desconocidos"**
   para esa fuente (WhatsApp/Archivos). Aceptar. Es normal en apps que no vienen
   de Play Store.
3. Instalar y abrir la app **una vez con internet**.
4. Iniciar sesión con el email y contraseña de la cajera.
5. Listo. A partir de ahí la app abre y funciona **aunque no haya internet**,
   incluso si el celular se reinició.

> La primera vez que use la cámara, Android pedirá permiso de cámara: aceptar.

---

## 2. iPhone (instalar la PWA)

> En iPhone no se usa un `.apk`. Se instala la versión web como app.

1. Abrir **Safari** (no Chrome) y entrar a la dirección de la app.
2. Iniciar sesión con email y contraseña **con internet**.
3. Tocar el botón **Compartir** (el cuadrado con la flecha hacia arriba).
4. Elegir **"Agregar a pantalla de inicio"**. (Un marcador común NO alcanza).
5. Confirmar. Ahora aparece el ícono de la app en la pantalla de inicio.

### Importante para iPhone — sincronización rutinaria

iOS puede **borrar los datos guardados de la app si pasa mucho tiempo sin abrirla**.
Para que en una emergencia la app esté lista:

- **Abrir la app desde la pantalla de inicio al menos cada pocos días**, con
  internet, aunque sea unos segundos. Con eso se mantiene la sesión y el catálogo
  actualizados.
- Si el iPhone estuvo semanas sin abrir la app, puede que pida iniciar sesión de
  nuevo (necesita internet ese momento).

Esta rutina es la que garantiza que, ante un corte inesperado, la cajera pueda
entrar a la app sin depender de internet.

---

## 3. Cómo funciona sin internet

- La app abre y deja **cerrar ventas, cobrar y cerrar turno** normalmente.
- Un **cartel amarillo** avisa "Sin conexión".
- Todo se guarda en el celular. Cuando vuelve internet, la app **sincroniza sola**:
  sube las ventas/turnos a la nube y la PC los importa.
- El catálogo (productos y precios) es el que se descargó la última vez con internet.

---

## 4. Referencia rápida para el desarrollador

### Compilar el `.apk` (requiere Android Studio + JDK)

```bash
pnpm --filter @carniceria/mobile build       # genera dist/ con las envs de Firebase
pnpm --filter @carniceria/mobile cap:sync     # copia assets al proyecto nativo
pnpm --filter @carniceria/mobile cap:open:android
# En Android Studio: Build > Build Bundle(s)/APK(s) > Build APK(s)
# (o dentro de apps/mobile/android/:  ./gradlew assembleDebug)
```

El `.apk` de debug queda en
`apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`.

### Publicar la PWA (para iPhones)

```bash
pnpm --filter @carniceria/mobile build
npx firebase-tools deploy --only hosting,firestore:rules
```

### Notas

- El `.env` de la app (`apps/mobile/.env`) se arma copiando `.env.example` con los
  valores reales de Firebase. Sin él, el build no puede autenticar.
- El ícono actual es un **placeholder neutro**. Para reemplazarlo por uno de marca
  a futuro: poner un PNG 1024×1024 y regenerar los tamaños (PWA en `public/` y, si
  se quiere el ícono nativo de Android, con `@capacitor/assets`).
