package ar.mimart.reloj

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import ar.mimart.reloj.data.AppDatabase
import ar.mimart.reloj.data.PrefsManager
import kotlinx.coroutines.*

/**
 * FCMService — recibe mensajes FCM cuando la app está cerrada o en background.
 *
 * Mensajes soportados (data messages):
 *   type = "sync"       → dispara SyncWorker inmediatamente
 *   type = "cancel"     → cancela alarmas de un docId específico
 *   type = "cancelAll"  → cancela todas las alarmas
 *
 * Los mensajes de datos (sin `notification` key) llegan aunque la app esté muerta.
 */
class FCMService : FirebaseMessagingService() {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        when (data["type"]) {
            "sync" -> {
                // Encolar trabajo de sincronización sin despertar WebView
                SyncWorker.enqueueImmediate(applicationContext)
            }
            "cancel" -> {
                val collection = data["collection"] ?: return
                val docId = data["docId"] ?: return
                scope.launch {
                    AlarmScheduler(applicationContext).cancelByDoc(collection, docId)
                }
            }
            "cancelAll" -> {
                scope.launch {
                    AlarmScheduler(applicationContext).cancelAll()
                }
            }
        }
    }

    override fun onNewToken(token: String) {
        // Guardar token localmente; se subirá a Firestore la próxima vez que el WebView esté activo
        PrefsManager(applicationContext).fcmToken = token
        // Intentar persistir en Firestore si hay conectividad
        scope.launch {
            try {
                uploadTokenToFirestore(token)
            } catch (_: Exception) { /* se reintentará desde la app */ }
        }
    }

    private suspend fun uploadTokenToFirestore(token: String) = withContext(Dispatchers.IO) {
        // Firestore SDK no está disponible directamente en el proceso nativo sin inicializar Firebase.
        // La app web (WebView) llama a alarm-bridge.js#saveFcmToken() cuando arranca.
        // Aquí simplemente guardamos en prefs; el WebView se encarga al abrir.
        PrefsManager(applicationContext).fcmToken = token
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
