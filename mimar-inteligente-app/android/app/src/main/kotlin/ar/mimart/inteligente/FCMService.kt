package ar.mimart.inteligente

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * FCMService — recibe los avisos de novedades (punto 6 del pedido):
 * consulta inicial nueva, pedido de kit nuevo, resumen de cumpleaños.
 *
 * A diferencia del FCMService de Reloj Mimar T (que solo dispara una
 * sincronización silenciosa en segundo plano), este SÍ construye una
 * notificación visible: son avisos pensados para que la operadora los vea
 * y actúe, no un sync interno.
 *
 * Todos los mensajes llegan como data messages (nunca "notification"
 * messages) — eso da control total sobre canal/agrupamiento/id acá, y
 * garantiza entrega aunque la app esté cerrada (Android no despierta la
 * app para un "notification" message cuando está en segundo plano).
 */
class FCMService : FirebaseMessagingService() {

    companion object {
        const val CANAL_NOVEDADES = "novedades"
        const val CANAL_CUMPLEANOS = "cumpleanos"
        private const val GRUPO_PREFIX = "ar.mimart.inteligente.grupo."
    }

    override fun onCreate() {
        super.onCreate()
        crearCanales()
    }

    // Canales por categoría — el usuario configura sonido/vibración por
    // canal desde los Ajustes nativos de Android (no se reinventa una
    // pantalla de preferencias propia para algo que el sistema ya resuelve
    // bien). "Pendientes de contacto" no tiene canal propio todavía porque
    // hoy no se empuja como push nativo (vive en la bandeja de la app).
    private fun crearCanales() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java) ?: return
        val novedades = NotificationChannel(
            CANAL_NOVEDADES, "Novedades (consultas y kits)", NotificationManager.IMPORTANCE_HIGH
        ).apply { description = "Consultas iniciales y pedidos de kit nuevos" }
        val cumpleanos = NotificationChannel(
            CANAL_CUMPLEANOS, "Cumpleaños", NotificationManager.IMPORTANCE_DEFAULT
        ).apply { description = "Resumen diario de cumpleaños de pacientes" }
        nm.createNotificationChannel(novedades)
        nm.createNotificationChannel(cumpleanos)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        // Sin tipoAviso no hay nada que mostrar acá — es el caso de los
        // pushes "sync" de Reloj, que de todos modos están filtrados por
        // appId en notifyAndroidDevices() y no deberían llegar a este canal.
        val tipoAviso = data["tipoAviso"] ?: return
        val titulo = data["titulo"] ?: "Espacio Mimar T"
        val texto = data["texto"] ?: ""
        val coleccion = data["collection"] ?: ""
        val docId = data["docId"] ?: ""

        val canal = if (tipoAviso == "cumpleanos") CANAL_CUMPLEANOS else CANAL_NOVEDADES
        // ID estable por documento (o por tipo+fecha en el resumen de
        // cumpleaños, que no tiene un docId de paciente propio) — así un
        // reintento o un segundo push del mismo evento ACTUALIZA la misma
        // notificación en vez de duplicarla en la barra.
        val notifId = "$coleccion:$docId:$tipoAviso".hashCode()
        val grupo = GRUPO_PREFIX + tipoAviso

        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("dl_coleccion", coleccion)
            putExtra("dl_docId", docId)
        }
        val pendingIntent = PendingIntent.getActivity(
            this, notifId, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notif = NotificationCompat.Builder(this, canal)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(titulo)
            .setContentText(texto)
            .setStyle(NotificationCompat.BigTextStyle().bigText(texto))
            .setAutoCancel(true)
            .setGroup(grupo)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        // Resumen de grupo — Android exige uno para que varias novedades del
        // mismo tipo se agrupen en la barra en vez de apilarse una por una.
        val resumenId = grupo.hashCode()
        val resumen = NotificationCompat.Builder(this, canal)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle("Espacio Mimar T")
            .setContentText("Tenés novedades nuevas")
            .setGroup(grupo)
            .setGroupSummary(true)
            .setAutoCancel(true)
            .build()

        try {
            val nm = NotificationManagerCompat.from(this)
            nm.notify(notifId, notif)
            nm.notify(resumenId, resumen)
        } catch (e: SecurityException) {
            // Permiso de notificaciones no concedido (Android 13+ sin
            // POST_NOTIFICATIONS otorgado) — la novedad igual queda
            // registrada en activityLog, solo no hay aviso visible.
        }
    }

    override fun onNewToken(token: String) {
        // El token se sube a Firestore desde el WebView, ya autenticado con
        // Firebase Auth (mismo criterio que Reloj) — acá no hay sesión de
        // Firestore propia en el proceso nativo. FcmPlugin.getToken() lo
        // vuelve a pedir la próxima vez que la app esté en primer plano.
    }
}
