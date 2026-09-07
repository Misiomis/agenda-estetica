@echo off
REM build-android.bat — Construye y sincroniza la app Android Mimar T Reloj
REM Requiere: Node.js, Android Studio (con JDK 17), variables JAVA_HOME y ANDROID_HOME

setlocal

echo.
echo ==========================================
echo   Mimar T Reloj — Build Android
echo ==========================================
echo.

REM 1. Verificar herramientas
where node >nul 2>&1 || (echo ERROR: Node.js no encontrado. Instalalo desde nodejs.org && exit /b 1)

REM 2. Instalar dependencias si no existen
if not exist "node_modules\@capacitor\core" (
    echo [1/5] Instalando dependencias npm...
    call npm install
) else (
    echo [1/5] Dependencias OK
)

REM 3. Capacitor sync — copia reloj/ al WebView de Android
echo [2/5] Sincronizando Capacitor...
call npx cap sync android

REM 4. Copiar fuentes Kotlin nativas
echo [3/5] Copiando fuentes nativas...
if not exist "android" (
    echo ERROR: Ejecuta primero: npx cap add android
    exit /b 1
)
bash android-src/apply-to-project.sh

REM 5. Verificar google-services.json
if not exist "android\app\google-services.json" (
    echo.
    echo ATENCION: Falta android\app\google-services.json
    echo Descargalo desde Firebase Console ^> Configuracion del proyecto ^> Tu app Android
    echo.
    pause
)

REM 6. Build con Gradle
echo [4/5] Compilando APK debug...
cd android
call gradlew.bat assembleDebug
cd ..

echo.
echo [5/5] Listo!
echo APK: android\app\build\outputs\apk\debug\app-debug.apk
echo.
echo Para instalar en dispositivo conectado:
echo   cd android ^&^& gradlew.bat installDebug
echo.

endlocal
pause
