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

    var horizonDays: Int
        get() = prefs.getInt("horizon_days", 7)
        set(v) = prefs.edit { putInt("horizon_days", v) }

    var lastSyncMs: Long
        get() = prefs.getLong("last_sync_ms", 0L)
        set(v) = prefs.edit { putLong("last_sync_ms", v) }

    var fcmToken: String?
        get() = prefs.getString("fcm_token", null)
        set(v) = prefs.edit { putString("fcm_token", v) }

    /** Limpia todo al cerrar sesión. NO toca las alarmas del sistema (deben cancelarse primero). */
    fun clear() = prefs.edit { clear() }
}
