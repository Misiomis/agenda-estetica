package ar.mimart.reloj

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import com.getcapacitor.*
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

    @PluginMethod
    fun getScheduled(call: PluginCall) {
        scope.launch {
            try {
                val list = AppDatabase.get(context).alarmDao().getScheduled()
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
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                android.content.pm.PackageManager.PERMISSION_GRANTED
        } else true

        val fsi = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            checkSelfPermission(Manifest.permission.USE_FULL_SCREEN_INTENT) ==
                android.content.pm.PackageManager.PERMISSION_GRANTED
        } else true

        call.resolve(JSObject().apply {
            put("exactAlarm", if (exactOk) "granted" else "denied")
            put("notifications", if (notifOk) "granted" else "denied")
            put("fullScreenIntent", if (fsi) "granted" else "denied")
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
        call.getBoolean("alarmsEnabled")?.let { prefs.alarmsEnabled = it }
        call.resolve()
    }

    @PluginMethod
    fun getPrefs(call: PluginCall) {
        call.resolve(JSObject().apply {
            put("advanceMinutes", prefs.advanceMinutes)
            put("snoozeMinutes", prefs.snoozeMinutes)
            put("alarmsEnabled", prefs.alarmsEnabled)
            put("horizonDays", prefs.horizonDays)
            put("lastSyncMs", prefs.lastSyncMs)
        })
    }

    override fun handleOnDestroy() {
        scope.cancel()
        super.handleOnDestroy()
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    /** requestCode estable: 31 bits positivos derivados del hash de la key. */
    private fun stableCode(key: String): Int = key.hashCode() and Int.MAX_VALUE
}
