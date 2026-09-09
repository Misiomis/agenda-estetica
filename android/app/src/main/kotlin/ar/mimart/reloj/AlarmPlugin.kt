package ar.mimart.reloj

import android.Manifest
import android.content.Context
import android.content.Intent
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.result.ActivityResult
import androidx.core.content.ContextCompat
import com.getcapacitor.*
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import ar.mimart.reloj.data.AlarmEntity
import ar.mimart.reloj.data.AlarmStatus
import ar.mimart.reloj.data.AppDatabase
import ar.mimart.reloj.data.PrefsManager
import kotlinx.coroutines.*

/**
 * AlarmPlugin — Plugin Capacitor que expone el AlarmScheduler al WebView.
 *
 * Métodos disponibles en JS via window.Capacitor.Plugins.AlarmPlugin:
 *   schedule({ alarms })           → void
 *   cancelByKey({ key })           → void
 *   cancelAll()                    → void
 *   getScheduled()                 → { alarms: [] }
 *   getPermissionStatus()          → { exactAlarm, notifications, ready }
 *   requestExactAlarmPermission()  → void (abre Ajustes)
 *   testAlarm({ delayMs })         → void
 *   saveFcmToken({ token })        → void
 *   setPrefs({ advanceMinutes, snoozeMinutes, alarmsEnabled }) → void
 *   getPrefs()                     → { advanceMinutes, snoozeMinutes, alarmsEnabled }
 */
@CapacitorPlugin(
    name = "AlarmPlugin",
    permissions = [
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications"),
    ]
)
class AlarmPlugin : Plugin() {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private lateinit var scheduler: AlarmScheduler
    private lateinit var prefs: PrefsManager

    override fun load() {
        scheduler = AlarmScheduler(context)
        prefs = PrefsManager(context)
    }

    // ── schedule ──────────────────────────────────────────────────────────

    @PluginMethod
    fun schedule(call: PluginCall) {
        val alarmsJson = call.getArray("alarms") ?: run { call.reject("alarms required"); return }
        scope.launch {
            try {
                val entities = (0 until alarmsJson.length()).mapNotNull { i ->
                    val obj = alarmsJson.getJSONObject(i)
                    val key = obj.getString("key")
                    val fireAtMs = obj.getLong("fireAtMs")
                    if (fireAtMs <= System.currentTimeMillis()) return@mapNotNull null
                    AlarmEntity(
                        key          = key,
                        requestCode  = stableCode(key),
                        fireAtMs     = fireAtMs,
                        patientName  = obj.optString("patientName", "Paciente"),
                        service      = obj.optString("service", ""),
                        box          = obj.optString("box").takeIf { it.isNotEmpty() },
                        collection   = obj.optString("collection", ""),
                        docId        = obj.optString("docId", ""),
                        type         = obj.optString("type", "start"),
                        status       = AlarmStatus.SCHEDULED,
                    )
                }
                entities.forEach { scheduler.schedule(it) }
                call.resolve()
            } catch (e: Exception) {
                call.reject("schedule failed: ${e.message}")
            }
        }
    }

    // ── cancelByKey ───────────────────────────────────────────────────────

    @PluginMethod
    fun cancelByKey(call: PluginCall) {
        val key = call.getString("key") ?: run { call.reject("key required"); return }
        scope.launch {
            try { scheduler.cancel(key); call.resolve() }
            catch (e: Exception) { call.reject(e.message) }
        }
    }

    // ── cancelAll ─────────────────────────────────────────────────────────

    @PluginMethod
    fun cancelAll(call: PluginCall) {
        scope.launch {
            try { scheduler.cancelAll(); call.resolve() }
            catch (e: Exception) { call.reject(e.message) }
        }
    }

    // ── getScheduled ──────────────────────────────────────────────────────
    // Devuelve las SCHEDULED más cualquier otra tocada en las últimas 24h
    // (CANCELLED/FIRED/DISMISSED/SNOOZED) — así Diagnóstico puede mostrar por
    // qué una alarma ya no está, no solo cuáles quedan vigentes.

    @PluginMethod
    fun getScheduled(call: PluginCall) {
        scope.launch {
            try {
                val cutoff = System.currentTimeMillis() - 24 * 60 * 60 * 1000L
                val list = AppDatabase.get(context).alarmDao().getRecent(cutoff)
                val arr = JSArray()
                list.forEach { e ->
                    arr.put(JSObject().apply {
                        put("key", e.key)
                        put("fireAtMs", e.fireAtMs)
                        put("patientName", e.patientName)
                        put("service", e.service)
                        put("box", e.box)
                        put("type", e.type)
                        put("status", e.status.name)
                        put("updatedAt", e.updatedAt)
                        put("docId", e.docId)
                        put("collection", e.collection)
                    })
                }
                call.resolve(JSObject().put("alarms", arr))
            } catch (e: Exception) { call.reject(e.message) }
        }
    }

    // ── getPermissionStatus ───────────────────────────────────────────────

    @PluginMethod
    fun getPermissionStatus(call: PluginCall) {
        val exactOk = scheduler.canScheduleExact()
        val notifOk = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
                android.content.pm.PackageManager.PERMISSION_GRANTED
        } else true

        val fsi = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.USE_FULL_SCREEN_INTENT) ==
                android.content.pm.PackageManager.PERMISSION_GRANTED
        } else true

        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val batteryUnrestricted = pm.isIgnoringBatteryOptimizations(context.packageName)

        call.resolve(JSObject().apply {
            put("exactAlarm", if (exactOk) "granted" else "denied")
            put("notifications", if (notifOk) "granted" else "denied")
            put("fullScreenIntent", if (fsi) "granted" else "denied")
            put("batteryUnrestricted", batteryUnrestricted)
            put("ready", exactOk && notifOk)
        })
    }

    // ── requestExactAlarmPermission ───────────────────────────────────────

    @PluginMethod
    fun requestExactAlarmPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
            intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
            context.startActivity(intent)
        }
        call.resolve()
    }

    // ── requestFullScreenIntentPermission ─────────────────────────────────
    // "Notificaciones emergentes" — sin esto, Android 14+ no muestra la
    // pantalla completa de alarma cuando el equipo está bloqueado.

    @PluginMethod
    fun requestFullScreenIntentPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            try {
                val intent = Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
                    data = Uri.parse("package:${context.packageName}")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                context.startActivity(intent)
            } catch (e: Exception) { /* No disponible en este dispositivo */ }
        }
        call.resolve()
    }

    // ── requestIgnoreBatteryOptimizations ──────────────────────────────────
    // Clave en Samsung/Xiaomi/etc: sin esto, el sistema puede matar el
    // proceso antes de que suene la alarma con la pantalla apagada.

    @PluginMethod
    fun requestIgnoreBatteryOptimizations(call: PluginCall) {
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (!pm.isIgnoringBatteryOptimizations(context.packageName)) {
            try {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:${context.packageName}")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                context.startActivity(intent)
            } catch (e: Exception) {
                try {
                    val fallback = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                        data = Uri.parse("package:${context.packageName}")
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                    context.startActivity(fallback)
                } catch (e2: Exception) { /* Ningún camino disponible */ }
            }
        }
        call.resolve()
    }

    // ── requestNotificationPermission ─────────────────────────────────────

    @PluginMethod
    fun requestNotificationPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissionForAlias("notifications", call, "notificationsCallback")
        } else {
            call.resolve(JSObject().put("notifications", "granted"))
        }
    }

    @PermissionCallback
    private fun notificationsCallback(call: PluginCall) {
        val granted = getPermissionState("notifications") == PermissionState.GRANTED
        call.resolve(JSObject().put("notifications", if (granted) "granted" else "denied"))
    }

    // ── testAlarm ─────────────────────────────────────────────────────────

    @PluginMethod
    fun testAlarm(call: PluginCall) {
        val delayMs = call.getLong("delayMs") ?: 5000L
        val fireAt = System.currentTimeMillis() + delayMs
        val entity = AlarmEntity(
            key         = "test_alarm",
            requestCode = stableCode("test_alarm"),
            fireAtMs    = fireAt,
            patientName = "Prueba Mimar T",
            service     = "Tratamiento de prueba",
            box         = null,
            collection  = "test",
            docId       = "test",
            type        = "start",
        )
        scope.launch {
            try { scheduler.schedule(entity); call.resolve() }
            catch (e: Exception) { call.reject(e.message) }
        }
    }

    // ── saveFcmToken ──────────────────────────────────────────────────────

    @PluginMethod
    fun saveFcmToken(call: PluginCall) {
        val token = call.getString("token") ?: run { call.reject("token required"); return }
        prefs.fcmToken = token
        // También persiste en Firestore vía FCMService si el usuario está autenticado.
        call.resolve()
    }

    // ── prefs ─────────────────────────────────────────────────────────────

    @PluginMethod
    fun setPrefs(call: PluginCall) {
        call.getInt("advanceMinutes")?.let { prefs.advanceMinutes = it }
        call.getInt("snoozeMinutes")?.let { prefs.snoozeMinutes = it }
        call.getBoolean("atStart")?.let { prefs.atStart = it }
        call.getString("alarmMode")?.let { prefs.alarmMode = it }
        val prefsChangedSchedule = call.data.has("advanceMinutes") || call.data.has("atStart")
        call.getBoolean("alarmsEnabled")?.let { alarmsEnabled ->
            prefs.alarmsEnabled = alarmsEnabled
            if (alarmsEnabled) {
                // Sincroniza de inmediato en vez de esperar los 15 min del worker periódico.
                SyncWorker.enqueueImmediate(context)
            } else {
                scope.launch { scheduler.cancelAll() }
            }
        } ?: run {
            // Si ya estaba activado y cambió el aviso previo o "atStart", re-sincronizar
            // ahora en vez de esperar hasta 15 min para que se reprogramen las alarmas.
            if (prefs.alarmsEnabled && prefsChangedSchedule) SyncWorker.enqueueImmediate(context)
        }
        call.resolve()
    }

    @PluginMethod
    fun getPrefs(call: PluginCall) {
        call.resolve(JSObject().apply {
            put("advanceMinutes", prefs.advanceMinutes)
            put("snoozeMinutes", prefs.snoozeMinutes)
            put("atStart", prefs.atStart)
            put("alarmsEnabled", prefs.alarmsEnabled)
            put("horizonDays", prefs.horizonDays)
            put("lastSyncMs", prefs.lastSyncMs)
            put("lastSyncError", prefs.lastSyncError)
            put("lastSyncScheduledCount", prefs.lastSyncScheduledCount)
            put("lastSyncCancelledStaleCount", prefs.lastSyncCancelledStaleCount)
            put("alarmMode", prefs.alarmMode)
            put("alarmSoundLabel", resolveSoundTitle(prefs.alarmSoundUri))
        })
    }

    // ── triggerSync ───────────────────────────────────────────────────────
    // Fuerza una sincronización inmediata (usado por el panel de diagnóstico).

    @PluginMethod
    fun triggerSync(call: PluginCall) {
        if (!prefs.alarmsEnabled) {
            call.reject("Las alarmas están pausadas: activalas antes de sincronizar")
            return
        }
        SyncWorker.enqueueImmediate(context)
        call.resolve()
    }

    // ── pickAlarmSound ────────────────────────────────────────────────────

    @PluginMethod
    fun pickAlarmSound(call: PluginCall) {
        val current = prefs.alarmSoundUri?.let { runCatching { Uri.parse(it) }.getOrNull() }
            ?: RingtoneManager.getActualDefaultRingtoneUri(context, RingtoneManager.TYPE_ALARM)
        val intent = Intent(RingtoneManager.ACTION_RINGTONE_PICKER).apply {
            putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, RingtoneManager.TYPE_ALARM)
            putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false)
            putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true)
            putExtra(RingtoneManager.EXTRA_RINGTONE_DEFAULT_URI, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM))
            putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, current)
        }
        startActivityForResult(call, intent, "pickAlarmSoundResult")
    }

    @ActivityCallback
    private fun pickAlarmSoundResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        @Suppress("DEPRECATION")
        val uri = result.data?.getParcelableExtra<Uri>(RingtoneManager.EXTRA_RINGTONE_PICKED_URI)
        if (uri != null) prefs.alarmSoundUri = if (uri.toString().isEmpty()) null else uri.toString()
        call.resolve(JSObject().apply {
            put("alarmSoundUri", prefs.alarmSoundUri)
            put("alarmSoundLabel", resolveSoundTitle(prefs.alarmSoundUri))
        })
    }

    private fun resolveSoundTitle(uriStr: String?): String {
        if (uriStr == null) return "Predeterminado del sistema"
        return try {
            RingtoneManager.getRingtone(context, Uri.parse(uriStr))?.getTitle(context) ?: "Personalizado"
        } catch (e: Exception) {
            "Personalizado"
        }
    }

    override fun handleOnDestroy() {
        scope.cancel()
        super.handleOnDestroy()
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    /** requestCode estable: 31 bits positivos derivados del hash de la key. */
    private fun stableCode(key: String): Int = key.hashCode() and Int.MAX_VALUE
}
