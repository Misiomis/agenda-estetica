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
 * También resuelve el deep link de una notificación tocada (punto 5): si
 * la notificación traía collection/docId, se lo pasa al WebView como un
 * CustomEvent para que abra el detalle correspondiente.
 */
class MainActivity : BridgeActivity() {

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
