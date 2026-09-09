package ar.mimart.reloj.data

import android.content.Context
import androidx.core.content.edit

private const val PREFS_NAME = "mimart_reloj_prefs"

class PrefsManager(context: Context) {
    private val prefs = context.applicationContext
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    var alarmsEnabled: Boolean
        get() = prefs.getBoolean("alarms_enabled", false)
        set(v) = prefs.edit { putBoolean("alarms_enabled", v) }

    var advanceMinutes: Int
        get() = prefs.getInt("advance_minutes", 5)
        set(v) = prefs.edit { putInt("advance_minutes", v) }

    var snoozeMinutes: Int
        get() = prefs.getInt("snooze_minutes", 5)
        set(v) = prefs.edit { putInt("snooze_minutes", v) }

    /** Avisar también a la hora exacta del ingreso (no solo el aviso previo). */
    var atStart: Boolean
        get() = prefs.getBoolean("at_start", true)
        set(v) = prefs.edit { putBoolean("at_start", v) }

    var horizonDays: Int
        get() = prefs.getInt("horizon_days", 7)
        set(v) = prefs.edit { putInt("horizon_days", v) }

    var lastSyncMs: Long
        get() = prefs.getLong("last_sync_ms", 0L)
        set(v) = prefs.edit { putLong("last_sync_ms", v) }

    /** Motivo del último fallo de sincronización; null si la última corrida fue exitosa. */
    var lastSyncError: String?
        get() = prefs.getString("last_sync_error", null)
        set(v) = prefs.edit { putString("last_sync_error", v) }

    /** Cantidad de alarmas (start + advance) programadas en la última sincronización exitosa. */
    var lastSyncScheduledCount: Int
        get() = prefs.getInt("last_sync_scheduled_count", 0)
        set(v) = prefs.edit { putInt("last_sync_scheduled_count", v) }

    /** Alarmas canceladas en la última sincronización por reserva borrada de Firestore (no solo "cancelado"). */
    var lastSyncCancelledStaleCount: Int
        get() = prefs.getInt("last_sync_cancelled_stale_count", 0)
        set(v) = prefs.edit { putInt("last_sync_cancelled_stale_count", v) }

    var fcmToken: String?
        get() = prefs.getString("fcm_token", null)
        set(v) = prefs.edit { putString("fcm_token", v) }

    /** "sound_vibration" | "sound_only" | "vibration_only" */
    var alarmMode: String
        get() = prefs.getString("alarm_mode", "sound_vibration") ?: "sound_vibration"
        set(v) = prefs.edit { putString("alarm_mode", v) }

    /** Uri (como String) del sonido de alarma elegido por el usuario; null = predeterminado del sistema. */
    var alarmSoundUri: String?
        get() = prefs.getString("alarm_sound_uri", null)
        set(v) = prefs.edit { putString("alarm_sound_uri", v) }

    /** Limpia todo al cerrar sesión. NO toca las alarmas del sistema (deben cancelarse primero). */
    fun clear() = prefs.edit { clear() }
}
