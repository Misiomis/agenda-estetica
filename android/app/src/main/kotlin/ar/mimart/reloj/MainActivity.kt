package ar.mimart.reloj

import android.os.Bundle
import androidx.activity.OnBackPressedCallback
import com.getcapacitor.BridgeActivity

/**
 * MainActivity — punto de entrada principal.
 *
 * Extiende BridgeActivity de Capacitor, que carga el WebView
 * con el contenido de webDir ("reloj/").
 *
 * AlarmPlugin se registra automáticamente vía @CapacitorPlugin.
 */
class MainActivity : BridgeActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(AlarmPlugin::class.java)
        super.onCreate(savedInstanceState)

        // Sincronización inicial al abrir la app
        SyncWorker.enqueueImmediate(applicationContext)
        // Sincronización periódica en background
        SyncWorker.schedulePeriodic(applicationContext)

        // Atrás/gesto de retroceso: le preguntamos al JS si hay un diálogo
        // abierto para cerrar. Si lo maneja, no hacemos nada más. Si no,
        // dejamos que el sistema haga lo de siempre (minimizar la app).
        // El teclado en pantalla ya se cierra solo con Atrás, antes de que
        // esto se ejecute — Android lo intercepta a un nivel más bajo.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // isEnabled sigue en false mientras esperamos: si hay que
                // caer al comportamiento del sistema, onBackPressed() de acá
                // abajo debe saltar ESTE callback (no hacerlo provoca un
                // bucle infinito re-invocándose a sí mismo).
                isEnabled = false
                bridge.webView.evaluateJavascript(
                    "(window.__mimartHandleBack ? window.__mimartHandleBack() : false)"
                ) { result ->
                    if (result == "true") {
                        isEnabled = true
                    } else {
                        onBackPressedDispatcher.onBackPressed()
                        isEnabled = true
                    }
                }
            }
        })
    }
}
