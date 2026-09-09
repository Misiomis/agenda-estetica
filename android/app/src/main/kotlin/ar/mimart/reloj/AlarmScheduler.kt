package ar.mimart.reloj

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import ar.mimart.reloj.data.AlarmDao
import ar.mimart.reloj.data.AlarmEntity
import ar.mimart.reloj.data.AlarmStatus
import ar.mimart.reloj.data.AppDatabase

/**
 * AlarmScheduler — interfaz única para crear/cancelar alarmas en AlarmManager.
 *
 * Usa setAlarmClock() (API 21+) que:
 *  - Se muestra en la barra de estado como un reloj.
 *  - Sobrevive Doze/Standby.
 *  - Requiere SCHEDULE_EXACT_ALARM (API 31+) o USE_EXACT_ALARM (API 33+ para alarmas).
 */
class AlarmScheduler(private val context: Context) {

    private val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    private val dao: AlarmDao by lazy { AppDatabase.get(context).alarmDao() }

    /** ¿Puede programar alarmas exactas en este dispositivo? */
    fun canScheduleExact(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            am.canScheduleExactAlarms()
        } else true
    }

    /** Programa una alarma. Reemplaza cualquier alarma previa con el mismo key. */
    suspend fun schedule(entity: AlarmEntity) {
        if (!canScheduleExact()) return
        val pi = buildPendingIntent(entity)
        val info = AlarmManager.AlarmClockInfo(
            entity.fireAtMs,
            buildShowIntent(entity)
        )
        am.setAlarmClock(info, pi)
        dao.upsert(entity.copy(status = AlarmStatus.SCHEDULED))
    }

    /** Cancela la alarma del sistema y actualiza el estado en Room. */
    suspend fun cancel(key: String) {
        val entity = dao.getByKey(key) ?: return
        val pi = buildPendingIntent(entity)
        am.cancel(pi)
        pi.cancel()
        dao.updateStatus(key, AlarmStatus.CANCELLED, System.currentTimeMillis())
    }

    /** Cancela todas las alarmas de un documento (advance + start). */
    suspend fun cancelByDoc(collection: String, docId: String) {
        val entities = dao.getByDoc(collection, docId)
        for (e in entities) {
            if (e.status == AlarmStatus.SCHEDULED) cancel(e.key)
        }
        dao.cancelByDoc(collection, docId, System.currentTimeMillis())
    }

    /** Cancela absolutamente todas las alarmas programadas. */
    suspend fun cancelAll() {
        val scheduled = dao.getScheduled()
        for (e in scheduled) {
            try {
                val pi = buildPendingIntent(e)
                am.cancel(pi)
                pi.cancel()
            } catch (_: Exception) {}
        }
        dao.cancelAll(System.currentTimeMillis())
    }

    /** Re-programa todas las alarmas SCHEDULED tras reinicio del dispositivo. */
    suspend fun rescheduleAll() {
        val scheduled = dao.getScheduled()
        val now = System.currentTimeMillis()
        for (e in scheduled) {
            if (e.fireAtMs <= now) {
                // Ya venció — no sonar, marcar como disparada.
                dao.updateStatus(e.key, AlarmStatus.FIRED, now)
            } else {
                schedule(e)
            }
        }
    }

    // ── Internals ──────────────────────────────────────────────────────────

    private fun buildPendingIntent(entity: AlarmEntity): PendingIntent {
        val intent = Intent(context, AlarmReceiver::class.java).apply {
            action = AlarmReceiver.ACTION_FIRE
            putExtra(AlarmReceiver.EXTRA_KEY,          entity.key)
            putExtra(AlarmReceiver.EXTRA_PATIENT_NAME, entity.patientName)
            putExtra(AlarmReceiver.EXTRA_SERVICE,      entity.service)
            putExtra(AlarmReceiver.EXTRA_BOX,          entity.box)
            putExtra(AlarmReceiver.EXTRA_TYPE,         entity.type)
            putExtra(AlarmReceiver.EXTRA_COLLECTION,   entity.collection)
            putExtra(AlarmReceiver.EXTRA_DOC_ID,       entity.docId)
        }
        return PendingIntent.getBroadcast(
            context,
            entity.requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun buildShowIntent(entity: AlarmEntity): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(AlarmReceiver.EXTRA_KEY, entity.key)
        }
        return PendingIntent.getActivity(
            context,
            entity.requestCode + 100_000,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }
}
