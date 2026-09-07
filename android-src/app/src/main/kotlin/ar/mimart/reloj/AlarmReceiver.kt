package ar.mimart.reloj

import android.app.*
import android.content.*
import android.media.*
import android.os.*
import androidx.core.app.NotificationCompat
import ar.mimart.reloj.data.AlarmStatus
import ar.mimart.reloj.data.AppDatabase
import ar.mimart.reloj.data.PrefsManager
import kotlinx.coroutines.*

/**
 * AlarmReceiver — se activa cuando AlarmManager dispara una alarma.
 *
 * Responsabilidades:
 *  1. Reproducir audio con AudioAttributes.USAGE_ALARM.
 *  2. Mostrar notificación de alta prioridad con acciones Detener / Posponer.
 *  3. Lanzar AlarmActivity (pantalla completa) si la pantalla está bloqueada.
 *  4. Actualizar estado en Room.
 *  5. Detener el audio después de MAX_RING_MS si nadie responde.
 */
class AlarmReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_FIRE    = "ar.mimart.reloj.ALARM_FIRE"
        const val ACTION_DISMISS = "ar.mimart.reloj.ALARM_DISMISS"
        const val ACTION_SNOOZE  = "ar.mimart.reloj.ALARM_SNOOZE"

        const val EXTRA_KEY          = "key"
        const val EXTRA_PATIENT_NAME = "patientName"
        const val EXTRA_SERVICE      = "service"
        const val EXTRA_BOX          = "box"
        const val EXTRA_TYPE         = "type"
        const val EXTRA_COLLECTION   = "collection"
        const val EXTRA_DOC_ID       = "docId"

        const val CHANNEL_ALARMS = "mimart_alarms"
        const val MAX_RING_MS    = 60_000L  // auto-silencia a los 60 s

        private var mediaPlayer: MediaPlayer? = null
        private var stopJob: Job? = null
        private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

        /** Detiene el audio activo (llamado desde AlarmActivity o ACTION_DISMISS). */
        @Synchronized
        fun stopAudio() {
            stopJob?.cancel()
            mediaPlayer?.runCatching { stop(); release() }
            mediaPlayer = null
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        val key    = intent.getStringExtra(EXTRA_KEY) ?: return
        val pName  = intent.getStringExtra(EXTRA_PATIENT_NAME) ?: "Paciente"
        val svc    = intent.getStringExtra(EXTRA_SERVICE) ?: ""
        val box    = intent.getStringExtra(EXTRA_BOX)
        val type   = intent.getStringExtra(EXTRA_TYPE) ?: "start"

        when (intent.action) {
            ACTION_DISMISS -> handleDismiss(context, key)
            ACTION_SNOOZE  -> handleSnooze(context, key, pName, svc, box, type)
            ACTION_FIRE, null -> handleFire(context, key, pName, svc, box, type)
        }
    }

    // ── Fire ──────────────────────────────────────────────────────────────

    private fun handleFire(ctx: Context, key: String, name: String, svc: String, box: String?, type: String) {
        ensureChannel(ctx)
        updateStatus(ctx, key, AlarmStatus.FIRED)
        playAlarmSound(ctx)
        showNotification(ctx, key, name, svc, box, type)
        launchAlarmActivity(ctx, key, name, svc, box, type)
    }

    private fun playAlarmSound(ctx: Context) {
        stopAudio()
        val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        try {
            mediaPlayer = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                setDataSource(ctx, uri)
                isLooping = true
                prepare()
                start()
            }
            stopJob = scope.launch {
                delay(MAX_RING_MS)
                stopAudio()
            }
        } catch (e: Exception) {
            // Silencioso si el dispositivo no puede reproducir
        }
    }

    private fun showNotification(ctx: Context, key: String, name: String, svc: String, box: String?, type: String) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val title = if (type == "advance") "En breve · $name" else "Ingreso ahora · $name"
        val body  = buildList {
            if (svc.isNotEmpty()) add(svc)
            if (!box.isNullOrEmpty()) add(box)
        }.joinToString(" · ")

        val dismissPi = buildActionPendingIntent(ctx, ACTION_DISMISS, key, name, svc, box, type, 1)
        val snoozePi  = buildActionPendingIntent(ctx, ACTION_SNOOZE,  key, name, svc, box, type, 2)
        val openPi    = buildFullScreenPendingIntent(ctx, key, name, svc, box, type)

        val notif = NotificationCompat.Builder(ctx, CHANNEL_ALARMS)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setFullScreenIntent(openPi, true)
            .setOngoing(true)
            .setAutoCancel(false)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Detener", dismissPi)
            .addAction(android.R.drawable.ic_popup_sync, "Posponer 5 min", snoozePi)
            .build()

        nm.notify(key.hashCode() and Int.MAX_VALUE, notif)
    }

    private fun launchAlarmActivity(ctx: Context, key: String, name: String, svc: String, box: String?, type: String) {
        val intent = Intent(ctx, AlarmActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION
            putExtra(EXTRA_KEY, key)
            putExtra(EXTRA_PATIENT_NAME, name)
            putExtra(EXTRA_SERVICE, svc)
            putExtra(EXTRA_BOX, box)
            putExtra(EXTRA_TYPE, type)
        }
        ctx.startActivity(intent)
    }

    // ── Dismiss / Snooze ──────────────────────────────────────────────────

    private fun handleDismiss(ctx: Context, key: String) {
        stopAudio()
        dismissNotification(ctx, key)
        updateStatus(ctx, key, AlarmStatus.DISMISSED)
    }

    private fun handleSnooze(ctx: Context, key: String, name: String, svc: String, box: String?, type: String) {
        stopAudio()
        dismissNotification(ctx, key)
        val prefs = PrefsManager(ctx)
        val snoozeMs = prefs.snoozeMinutes * 60_000L
        val newFireAt = System.currentTimeMillis() + snoozeMs

        // Reprogramar con la misma key, mismo tipo, nueva hora
        updateStatus(ctx, key, AlarmStatus.SNOOZED)
        scope.launch {
            val db = AppDatabase.get(ctx)
            val orig = db.alarmDao().getByKey(key) ?: return@launch
            val snoozed = orig.copy(
                fireAtMs = newFireAt,
                status   = AlarmStatus.SCHEDULED,
                snoozeUntilMs = newFireAt,
            )
            AlarmScheduler(ctx).schedule(snoozed)
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    private fun updateStatus(ctx: Context, key: String, status: AlarmStatus) {
        scope.launch { AppDatabase.get(ctx).alarmDao().updateStatus(key, status) }
    }

    private fun dismissNotification(ctx: Context, key: String) {
        (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .cancel(key.hashCode() and Int.MAX_VALUE)
    }

    private fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CHANNEL_ALARMS) == null) {
                val ch = NotificationChannel(
                    CHANNEL_ALARMS,
                    "Ingresos Mimar T",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "Avisos de ingresos del reloj de recepción"
                    setBypassDnd(true)
                    setShowBadge(true)
                    lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                }
                nm.createNotificationChannel(ch)
            }
        }
    }

    private fun buildActionPendingIntent(
        ctx: Context, action: String, key: String,
        name: String, svc: String, box: String?, type: String, code: Int,
    ): PendingIntent {
        val i = Intent(ctx, AlarmReceiver::class.java).apply {
            this.action = action
            putExtra(EXTRA_KEY, key)
            putExtra(EXTRA_PATIENT_NAME, name)
            putExtra(EXTRA_SERVICE, svc)
            putExtra(EXTRA_BOX, box)
            putExtra(EXTRA_TYPE, type)
        }
        return PendingIntent.getBroadcast(
            ctx, (key.hashCode() and Int.MAX_VALUE) + code * 1_000_000, i,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun buildFullScreenPendingIntent(
        ctx: Context, key: String, name: String, svc: String, box: String?, type: String,
    ): PendingIntent {
        val i = Intent(ctx, AlarmActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION
            putExtra(EXTRA_KEY, key); putExtra(EXTRA_PATIENT_NAME, name)
            putExtra(EXTRA_SERVICE, svc); putExtra(EXTRA_BOX, box); putExtra(EXTRA_TYPE, type)
        }
        return PendingIntent.getActivity(
            ctx, (key.hashCode() and Int.MAX_VALUE) + 3_000_000, i,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }
}
