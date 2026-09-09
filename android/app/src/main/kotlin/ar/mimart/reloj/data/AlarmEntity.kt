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
    // Hora real del turno (igual para la fila "start" y la "advance" del mismo
    // doc — la de "advance" es fireAtMs - avisoPrevio, no el turno en sí).
    // La usa SyncWorker para saber si un doc que YA NO aparece en Firestore
    // (borrado) estaba dentro de la ventana que se acaba de consultar, sin
    // depender de fireAtMs (que difiere entre start/advance).
    val appointmentAtMs: Long = fireAtMs,
    // Se actualiza en cada transición de estado (programada, cancelada,
    // disparada, descartada, pospuesta) — a diferencia de createdAt, que solo
    // cambia cuando se reprograma la fila entera. Es lo que permite a
    // Diagnóstico mostrar "cuándo se sincronizó" cada evento, no solo cuándo
    // se creó por primera vez.
    val updatedAt: Long = System.currentTimeMillis(),
)
