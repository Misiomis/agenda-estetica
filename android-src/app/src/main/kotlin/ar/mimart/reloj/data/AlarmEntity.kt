package ar.mimart.reloj.data

import androidx.room.Entity
import androidx.room.PrimaryKey

/** Estados posibles de una alarma programada. */
enum class AlarmStatus { SCHEDULED, FIRED, DISMISSED, SNOOZED, CANCELLED }

/**
 * Cada fila representa UN evento de alarma.
 * key = "{collection}_{docId}_{advance|start}"
 * requestCode = key.hashCode() & Int.MAX_VALUE  (para AlarmManager)
 */
@Entity(tableName = "alarms")
data class AlarmEntity(
    @PrimaryKey val key: String,
    val requestCode: Int,
    val fireAtMs: Long,
    val patientName: String,
    val service: String,
    val box: String?,
    val collection: String,
    val docId: String,
    val type: String,            // "advance" | "start"
    val status: AlarmStatus = AlarmStatus.SCHEDULED,
    val createdAt: Long = System.currentTimeMillis(),
    val snoozeUntilMs: Long? = null,
)
