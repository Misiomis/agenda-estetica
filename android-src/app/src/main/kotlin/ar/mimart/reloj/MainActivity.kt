package ar.mimart.reloj

import android.os.Bundle
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
    }
}
