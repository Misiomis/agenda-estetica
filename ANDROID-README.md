# Mimar T Reloj — App Android

App nativa Android que envuelve el reloj de recepción (`reloj/`) en un WebView Capacitor y agrega alarmas exactas nativas, notificaciones de pantalla completa y sincronización FCM en background.

---

## Arquitectura

```
reloj/ (web app)
  └── alarm-bridge.js   ← detecta plataforma y llama a AlarmPlugin o stub web

android/ (generado por Capacitor)
  └── app/src/main/kotlin/ar/mimart/reloj/
        ├── MainActivity.kt       Capacitor BridgeActivity (punto de entrada)
        ├── AlarmPlugin.kt        Plugin Capacitor — bridge JS ↔ nativo
        ├── AlarmScheduler.kt     Wrapper de AlarmManager.setAlarmClock()
        ├── AlarmReceiver.kt      BroadcastReceiver: dispara audio + notificación + AlarmActivity
        ├── AlarmActivity.kt      UI pantalla completa sobre lock screen
        ├── BootReceiver.kt       Reprograma alarmas tras reinicio
        ├── FCMService.kt         Recibe push FCM en background → SyncWorker
        ├── SyncWorker.kt         WorkManager: sincroniza Firestore → Room → AlarmManager
        └── data/
              ├── AlarmEntity.kt  Room entity
              ├── AlarmDao.kt     Room DAO
              ├── AppDatabase.kt  Room database singleton
              └── PrefsManager.kt SharedPreferences wrapper
```

---

## Prerrequisitos

| Herramienta | Versión mínima | Notas |
|-------------|---------------|-------|
| Node.js | 18+ | `node -v` |
| Android Studio | Hedgehog (2023.1) o superior | Incluye JDK 17 y SDK Manager |
| Java (JDK) | 17 | Se instala con Android Studio |
| Android SDK | API 26–34 | Instalar via SDK Manager |
| JAVA_HOME | apuntar a JDK 17 | Se configura en Android Studio |

---

## Configuración inicial (una sola vez)

### 1. Registrar la app en Firebase

1. Abrí [Firebase Console](https://console.firebase.google.com) → proyecto `estetica-8d067`
2. **Agregar app** → Android
3. Package name: `ar.mimart.reloj`
4. Descargá `google-services.json`
5. Copialo a `android/app/google-services.json`

### 2. Instalar dependencias

```bat
npm install
```

### 3. Agregar plataforma Android

```bat
npx cap add android
```

### 4. Copiar fuentes nativas

```bat
bash android-src/apply-to-project.sh
```

O en Windows sin Git Bash, copiar manualmente:
- `android-src/app/src/main/kotlin/` → `android/app/src/main/kotlin/`
- `android-src/app/src/main/res/layout/activity_alarm.xml` → `android/app/src/main/res/layout/`
- `android-src/app/src/main/res/values/colors.xml` → `android/app/src/main/res/values/`
- `android-src/app/src/main/res/values/strings.xml` → `android/app/src/main/res/values/`
- `android-src/app/src/main/res/values/styles.xml` → `android/app/src/main/res/values/`
- `android-src/app/src/main/AndroidManifest.xml` → `android/app/src/main/AndroidManifest.xml`
- `android-src/app/build.gradle` → `android/app/build.gradle`

### 5. Abrir en Android Studio

```bat
npx cap open android
```

O abrí manualmente la carpeta `android/` desde Android Studio.

---

## Build y deploy

### Build debug (para probar)

```bat
build-android.bat
```

O manualmente:
```bat
npx cap sync android
cd android
gradlew.bat assembleDebug
cd ..
```

APK resultante: `android/app/build/outputs/apk/debug/app-debug.apk`

### Instalar en dispositivo conectado

```bat
cd android
gradlew.bat installDebug
```

### Build release (para distribuir)

1. Generar keystore (una sola vez):
   ```bat
   keytool -genkey -v -keystore mimart-release.keystore -alias mimart -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Configurar signing en `android/app/build.gradle`:
   ```groovy
   android {
       signingConfigs {
           release {
               storeFile file("../../mimart-release.keystore")
               storePassword "TU_PASSWORD"
               keyAlias "mimart"
               keyPassword "TU_PASSWORD"
           }
       }
       buildTypes {
           release { signingConfig signingConfigs.release }
       }
   }
   ```

3. Build:
   ```bat
   cd android && gradlew.bat assembleRelease
   ```

---

## Flujo de alarmas

```
Firestore (reserva/sesión)
    ↓ Cloud Function (onReservaWritten / onSesionWritten)
    ↓ FCM data message { type: "sync" }
    ↓ FCMService.kt → SyncWorker.enqueueImmediate()
    ↓ SyncWorker: lee Firestore, calcula fechaMs - advanceMinutes
    ↓ AlarmScheduler.schedule(entity) → AlarmManager.setAlarmClock()
    ↓ [a la hora indicada] AlarmReceiver.onReceive(ACTION_FIRE)
    ↓ → reproduce audio (USAGE_ALARM)
    ↓ → notificación PRIORITY_MAX con acciones Detener / Posponer
    ↓ → lanza AlarmActivity (pantalla completa sobre lock screen)
```

**Clave de deduplicación:** `"{collection}_{docId}_{advance|start}"`
Programar la misma key reemplaza la alarma previa (FLAG_UPDATE_CURRENT).

---

## Permisos que el usuario debe conceder

| Permiso | Cuándo | Cómo |
|---------|--------|------|
| Alarmas exactas (API 31+) | Primera apertura | El WebView llama a `AlarmPlugin.requestExactAlarmPermission()` → Ajustes |
| Notificaciones (API 33+) | Primera apertura | Diálogo del sistema |
| Pantalla completa (API 34+) | Automático si el canal está configurado | — |

---

## Estructura de Firestore esperada

### Colección `reservas` / `sesiones`

Cada documento debe tener:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `fechaMs` | number | Timestamp en milisegundos del inicio del turno |
| `nombrePaciente` o `nombre` | string | Nombre del paciente |
| `servicio` | string | Servicio (opcional) |
| `box` | string | Box (opcional) |
| `cancelada` | boolean | Si es `true`, se cancela la alarma |
| `estado` | string | Si es `"cancelada"`, se cancela la alarma |

### Colección `deviceTokens`

Un documento por usuario administrador:
```json
{
  "token": "FCM_TOKEN_AQUI",
  "updatedAt": 1234567890000
}
```

El token se guarda automáticamente desde `FCMService.onNewToken()` y desde `alarm-bridge.js` al iniciar el WebView.

---

## Actualizar la app web

Cada vez que modificás archivos en `reloj/`:

```bat
npx cap sync android
cd android && gradlew.bat assembleDebug
```

No necesitás re-copiar los archivos Kotlin salvo que los hayas modificado.

---

## Solución de problemas

### "SCHEDULE_EXACT_ALARM denied"
→ El usuario debe habilitar manualmente: Ajustes → Aplicaciones → Mimar T Reloj → Alarmas y recordatorios → Permitir

### Alarmas no suenan con pantalla apagada
→ Verificar que la app no esté optimizada para batería:
Ajustes → Batería → Optimización de batería → Mimar T Reloj → No optimizar

### "google-services.json not found"
→ Descargar desde Firebase Console → Proyecto `estetica-8d067` → Configuración → Tu app Android

### FCM no llega en background
→ Verificar que el mensaje sea **data message** (sin `notification` key en el payload).
Los mensajes de notificación son manejados por FCM automáticamente y NO despiertan FCMService.kt.

### Compilación falla con "Could not find :capacitor-android"
→ Verificar que `android/` fue generado por `npx cap add android` y que `settings.gradle` incluye el proyecto capacitor-android.

---

## Despliegue de Cloud Functions

```bash
cd functions && npm install
firebase deploy --only functions:onReservaWritten,functions:onSesionWritten
```

Y las reglas de Firestore:
```bash
firebase deploy --only firestore:rules
```
