#!/usr/bin/env bash
# apply-to-project.sh
# Copia los archivos nativos de android-src/ al directorio android/ generado por Capacitor.
#
# Uso:
#   cd /ruta/al/proyecto
#   bash android-src/apply-to-project.sh
#
# Ejecutar DESPUÉS de: npx cap add android

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ANDROID_DIR="$PROJECT_DIR/android"

if [ ! -d "$ANDROID_DIR" ]; then
  echo "ERROR: No existe $ANDROID_DIR — ejecutá primero: npx cap add android"
  exit 1
fi

SRC_KOTLIN="$SCRIPT_DIR/app/src/main/kotlin/ar/mimart/reloj"
DST_KOTLIN="$ANDROID_DIR/app/src/main/kotlin/ar/mimart/reloj"
SRC_RES="$SCRIPT_DIR/app/src/main/res"
DST_RES="$ANDROID_DIR/app/src/main/res"
SRC_MANIFEST="$SCRIPT_DIR/app/src/main/AndroidManifest.xml"
DST_MANIFEST="$ANDROID_DIR/app/src/main/AndroidManifest.xml"

# ── Kotlin sources ────────────────────────────────────────────────────────────
echo "→ Copiando Kotlin sources..."
mkdir -p "$DST_KOTLIN"
cp -r "$SRC_KOTLIN/." "$DST_KOTLIN/"

# Sub-paquete data/
mkdir -p "$DST_KOTLIN/data"
cp -r "$SRC_KOTLIN/data/." "$DST_KOTLIN/data/"

# ── Resources ─────────────────────────────────────────────────────────────────
echo "→ Copiando resources..."
mkdir -p "$DST_RES/layout"
cp "$SRC_RES/layout/activity_alarm.xml" "$DST_RES/layout/"

# Merge values (strings, colors, styles) — agregar si no existen
for f in strings.xml colors.xml styles.xml; do
  if [ ! -f "$DST_RES/values/$f" ]; then
    cp "$SRC_RES/values/$f" "$DST_RES/values/"
  else
    echo "  ⚠  $f ya existe en dst — verificá manualmente que los valores estén presentes"
  fi
done

# ── AndroidManifest ───────────────────────────────────────────────────────────
echo "→ Reemplazando AndroidManifest.xml..."
cp "$SRC_MANIFEST" "$DST_MANIFEST"

# ── build.gradle (app) ────────────────────────────────────────────────────────
echo "→ Reemplazando app/build.gradle..."
cp "$SCRIPT_DIR/app/build.gradle" "$ANDROID_DIR/app/build.gradle"

# ── build.gradle (root) ───────────────────────────────────────────────────────
# Solo remplazar si Capacitor no lo modificó más allá del classpath básico
echo "→ Copiando root build.gradle (compará con el existente)..."
cp "$SCRIPT_DIR/build.gradle" "$ANDROID_DIR/build.gradle.mimart-src"
echo "  ℹ  Se guardó como build.gradle.mimart-src — mergealo con el build.gradle existente si ya tiene contenido de Capacitor."

# ── settings.gradle ───────────────────────────────────────────────────────────
echo "→ Guardando settings.gradle como referencia..."
cp "$SCRIPT_DIR/settings.gradle" "$ANDROID_DIR/settings.gradle.mimart-src"
echo "  ℹ  settings.gradle.mimart-src es referencia — Capacitor ya generó el tuyo, no lo reemplaces."

# ── gradle.properties ─────────────────────────────────────────────────────────
echo "→ Verificando gradle.properties..."
if [ ! -f "$ANDROID_DIR/gradle.properties" ]; then
  cp "$SCRIPT_DIR/gradle.properties" "$ANDROID_DIR/gradle.properties"
else
  echo "  ℹ  gradle.properties ya existe — asegurate de tener: android.useAndroidX=true y android.enableJetifier=true"
fi

echo ""
echo "✅ Listo. Próximos pasos:"
echo "   1. Bajá google-services.json de Firebase Console y ponelo en android/app/"
echo "   2. Abrí android/ en Android Studio"
echo "   3. Build > Make Project (verifica dependencias)"
echo "   4. Run en dispositivo o emulador (API 26+)"
