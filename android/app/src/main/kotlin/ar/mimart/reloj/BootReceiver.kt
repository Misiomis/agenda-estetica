package ar.mimart.reloj

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.*

/**
 * BootReceiver — reprograma alarmas en AlarmManager tras reinicio del dispositivo.
 *
 * AlarmManager pierde todas las alarmas al apagar el teléfono.
 * Este receiver se dispara ante BOOT_COMPLETED y MY_PACKAGE_REPLACED
 * y restaura todas las alarmas con estado SCHEDULED en Room.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != Intent.ACTION_MY_PACKAGE_REPLACED &&
            action != "android.intent.action.QUICKBOOT_POWERON") return  // HTC/Samsung

        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO + SupervisorJob()).launch {
            try {
                // Restaura primero lo último conocido en Room (funciona incluso
                // sin conexión al reiniciar). Encolar la sincronización después
                // corrige contra Firestore apenas haya red: si una reserva se
                // borró mientras el teléfono estaba apagado, esto la retira en
                // vez de dejarla sonando con el estado desactualizado de Room.
                AlarmScheduler(context).rescheduleAll()
                SyncWorker.enqueueImmediate(context)
            } finally {
                pendingResult.finish()
            }
        }
    }
}
