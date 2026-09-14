package ar.mimart.inteligente

import android.content.Intent
import android.os.Bundle
import com.getcapacitor.BridgeActivity
import org.json.JSONObject

/**
 * MainActivity — punto de entrada principal.
 *
 * Extiende BridgeActivity de Capacitor, que carga el WebView con el
 * contenido de webDir ("mimar-inteligente/"). FcmPlugin se registra acá
 * (no vía @CapacitorPlugin con auto-discovery, mismo patrón que
 * AlarmPlugin en Reloj Mimar T).
 *
 * Deep link de una notificación tocada (punto 5): antes se disparaba con
 * evaluateJavascript() apenas llegaba el intent, asumiendo que el WebView
 * ya tenía el listener de "mimarDeepLink" enganchado — en un arranque en
 * frío eso es una carrera real: la página (y la sesión de Firebase Auth)
 * pueden no estar listas todavía y el evento se pierde en el vacío.
 *
 * Ahora el intent se GUARDA acá (pendingDeepLink*) y hay dos caminos:
 *   1) Si la app ya está corriendo y autenticada, se intenta un disparo
 *      inmediato (best-effort) — funciona al toque en caliente.
 *   2) FcmPlugin.consumePendingDeepLink() permite que el JS, recién
 *      cuando confirmó sesión y autorización (mismo punto donde ya pide
 *      el token FCM), "tire" del deep-link pendiente en vez de que
 *      alguien se lo empuje sin saber si hay quien lo escuche. Así se
 *      conserva la intención aunque haga falta iniciar sesión primero.
 */
class MainActivity : BridgeActivity() {

    var pendingDeepLinkColeccion: String? = null
    var pendingDeepLinkDocId: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(FcmPlugin::class.java)
        registerPlugin(UpdatePlugin::class.java)
        super.onCreate(savedInstanceState)
        handleDeepLinkIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleDeepLinkIntent(intent)
    }

    private fun handleDeepLinkIntent(intent: Intent?) {
        val coleccion = intent?.getStringExtra("dl_coleccion")
        val docId = intent?.getStringExtra("dl_docId")
        if (coleccion.isNullOrEmpty() || docId.isNullOrEmpty()) return

        pendingDeepLinkColeccion = coleccion
        pendingDeepLinkDocId = docId

        // Intento inmediato best-effort (sirve cuando la app ya está
        // abierta y lista) — si no hay nadie escuchando todavía, no pasa
        // nada malo: el pendingDeepLink queda guardado para que
        // consumePendingDeepLink() lo recupere apenas la sesión esté lista.
        dispatchDeepLinkJs(coleccion, docId)
    }

    private fun dispatchDeepLinkJs(coleccion: String, docId: String) {
        // JSONObject se encarga de escapar comillas/backslashes correctamente
        // al armar el literal — los valores vienen de nuestro propio payload
        // de servidor, pero igual no hay que confiar ciegamente en texto
        // libre dentro de un evaluateJavascript.
        val detalle = JSONObject().apply {
            put("coleccion", coleccion)
            put("docId", docId)
        }
        val js = "window.dispatchEvent(new CustomEvent('mimarDeepLink', { detail: $detalle }))"
        bridge?.webView?.post {
            bridge.webView.evaluateJavascript(js, null)
        }
    }
}
