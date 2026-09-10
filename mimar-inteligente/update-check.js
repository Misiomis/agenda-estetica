// Actualización remota de la APK (punto 8) — sin Google Play. Compara la
// versión instalada (App.getInfo() de @capacitor/app, ya declarado como
// dependencia) contra un manifest JSON público. Descargar/instalar lo hace
// UpdatePlugin (nativo) — acá solo se decide SI corresponde ofrecerlo.
export const MANIFEST_URL = "https://espaciomimart.com/mimar-inteligente-app/update-manifest.json";

export async function verificarActualizacion() {
    const AppPlugin = window.Capacitor?.Plugins?.App;
    if (!AppPlugin?.getInfo) return null; // no estamos en la app nativa

    const info = await AppPlugin.getInfo();
    const versionActual = parseInt(info.build, 10) || 0;

    const resp = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!resp.ok) throw new Error(`No se pudo consultar actualizaciones (HTTP ${resp.status})`);
    const manifest = await resp.json();

    const versionRemota = parseInt(manifest.versionCode, 10) || 0;
    return {
        hayActualizacion: versionRemota > versionActual,
        versionActual,
        versionRemota,
        manifest
    };
}
