package ar.mimart.reloj

import android.content.Context
import android.util.Log
import androidx.work.*
import ar.mimart.reloj.data.AlarmEntity
import ar.mimart.reloj.data.AppDatabase
import ar.mimart.reloj.data.PrefsManager
import com.google.firebase.FirebaseApp
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.QuerySnapshot
import kotlinx.coroutines.*
import kotlinx.coroutines.tasks.await
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.util.concurrent.TimeUnit

/**
 * SyncWorker — sincroniza reservas de Firestore y reconcilia alarmas en Room/AlarmManager.
 *
 * Se ejecuta:
 *  1. Periódicamente cada 15 min (mínimo WorkManager) — para detectar cambios sin FCM.
 *  2. Inmediatamente al recibir mensaje FCM tipo "sync".
 *  3. Al abrir la app (enqueueImmediate desde MainActivity) o al activar las alarmas.
 *
 * NO es responsable de disparar alarmas — eso lo hace AlarmManager.
 * Solo mantiene Room sincronizado y AlarmManager con las alarmas correctas.
 *
 * Los documentos NO tienen un campo "fechaMs" — usan "fecha" (string "YYYY-MM-DD")
 * y "hora" (string "HH:MM"), igual que reloj/motor.js. El horario se interpreta
 * siempre en America/Argentina/Buenos_Aires (UTC-3 fijo, sin horario de verano).
 * Debe reflejar exactamente reloj/motor.js#normalizeBooking y reloj/config.js#sources.
 */
class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    companion object {
        private const val TAG = "MimarTSync"
        private const val WORK_PERIODIC = "mimart_sync_periodic"
        private const val WORK_IMMEDIATE = "mimart_sync_immediate"
        private const val AR_OFFSET = "-03:00"
        private val AR_ZONE = ZoneId.of("America/Argentina/Buenos_Aires")

        // Debe coincidir con los `id` habilitados en reloj/config.js → CONFIG.sources.
        private val COLLECTIONS = listOf("reservas", "consultas", "reservasDepi")

        private val DATE_RE = Regex("""^\d{4}-\d{2}-\d{2}$""")
        private val TIME_RE = Regex("""^(\d{1,2})[:.](\d{2})(?::00)?$""")
        private val TIME_SUFFIX_RE = Regex("""(?i)\s*(?:hs?|hrs?)\.?$""")

        private val CANCELLED_WORDS = setOf(
            "cancelado", "cancelada", "cancelled", "canceled", "anulado", "anulada",
            "eliminado", "eliminada", "rechazado", "rechazada"
        )
        private val COMPLETED_WORDS = setOf(
            "realizado", "realizada", "completado", "completada", "completed",
            "atendido", "atendida", "finalizado", "finalizada", "consumido", "consumida",
            "ausente", "no asistio", "no_asistio", "no-show"
        )

        /** Programa sincronización periódica cada 15 minutos. */
        fun schedulePeriodic(context: Context) {
            val req = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(WORK_PERIODIC, ExistingPeriodicWorkPolicy.KEEP, req)
        }

        /** Ejecuta una sincronización inmediata (FCM, app open, activar alarmas). */
        fun enqueueImmediate(context: Context) {
            val req = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(WORK_IMMEDIATE, ExistingWorkPolicy.REPLACE, req)
        }

        /** Igual que motor.js#normalizeTime: admite "9:30", "09:30hs", "9.30 hrs.", etc. */
        private fun normalizeTime(raw: String): String? {
            val cleaned = raw.trim().replace(TIME_SUFFIX_RE, "").trim()
            val m = TIME_RE.find(cleaned) ?: return null
            val hour = m.groupValues[1].toIntOrNull() ?: return null
            val minute = m.groupValues[2].toIntOrNull() ?: return null
            if (hour > 23 || minute > 59) return null
            return "%02d:%02d".format(hour, minute)
        }

        /** Igual que motor.js#parseAppointmentTime: "fecha" + "hora" → epoch ms en America/Argentina. */
        private fun parseAppointmentMs(fecha: String, horaRaw: String): Long? {
            if (!DATE_RE.matches(fecha)) return null
            val time = normalizeTime(horaRaw) ?: return null
            return try {
                OffsetDateTime.parse("${fecha}T$time:00$AR_OFFSET").toInstant().toEpochMilli()
            } catch (e: Exception) {
                null
            }
        }

        /** Igual que motor.js#bookingState: "cancelled" | "completed" | "scheduled". */
        private fun bookingState(estado: String?, status: String?, cancelado: Boolean, cancelada: Boolean, deleted: Boolean): String {
            val folded = listOfNotNull(estado, status).map { it.trim().lowercase() }
            if (cancelado || cancelada || deleted || folded.any { it in CANCELLED_WORDS }) return "cancelled"
            if (folded.any { it in COMPLETED_WORDS }) return "completed"
            return "scheduled"
        }
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val prefs = PrefsManager(applicationContext)
        if (!prefs.alarmsEnabled) return@withContext Result.success()

        try {
            if (FirebaseApp.getApps(applicationContext).isEmpty()) {
                // Firebase no inicializado aún — reintenta más tarde.
                Log.w(TAG, "Firebase aún no inicializado, reintentando")
                return@withContext Result.retry()
            }

            val db = FirebaseFirestore.getInstance()
            val alarmDb = AppDatabase.get(applicationContext)
            val scheduler = AlarmScheduler(applicationContext)
            val now = System.currentTimeMillis()
            val today = LocalDate.now(AR_ZONE)
            // Un día hacia atrás cubre un ingreso de madrugada cuyo aviso previo cae "ayer".
            val fromStr = today.minusDays(1).toString()
            val toStr = today.plusDays(prefs.horizonDays.toLong()).toString()

            var scheduledCount = 0
            var docsSeen = 0
            // Por colección, los docId que SÍ trajo esta consulta — para el
            // paso de reconciliación de abajo: cualquier alarma SCHEDULED en
            // Room cuyo docId no aparezca acá para su colección es de una
            // reserva que ya no existe en Firestore (borrada de verdad, no
            // solo marcada "cancelado") y hay que cancelarla también.
            val seenByCollection = mutableMapOf<String, MutableSet<String>>()
            // Colecciones donde la consulta a Firestore falló: NO se reconcilia
            // nada para ellas en esta pasada (ver más abajo) para no cancelar
            // por error alarmas válidas solo porque no se pudo leer el estado real.
            val failedCollections = mutableSetOf<String>()

            for (col in COLLECTIONS) {
                val snap: QuerySnapshot = try {
                    db.collection(col)
                        .whereGreaterThanOrEqualTo("fecha", fromStr)
                        .whereLessThanOrEqualTo("fecha", toStr)
                        .get()
                        .await()
                } catch (e: Exception) {
                    Log.w(TAG, "Fallo consultando '$col': ${e.javaClass.simpleName}")
                    failedCollections.add(col)
                    continue
                }

                val seenIds = seenByCollection.getOrPut(col) { mutableSetOf() }
                for (doc in snap.documents) {
                    docsSeen++
                    val docId = doc.id
                    seenIds.add(docId)
                    val fecha = doc.getString("fecha") ?: continue
                    val hora = doc.getString("hora") ?: continue
                    val fireAtMs = parseAppointmentMs(fecha, hora) ?: continue

                    val state = bookingState(
                        estado = doc.getString("estado"),
                        status = doc.getString("status"),
                        cancelado = doc.getBoolean("cancelado") == true,
                        cancelada = doc.getBoolean("cancelada") == true,
                        deleted = doc.getBoolean("deleted") == true,
                    )
                    if (state != "scheduled") {
                        scheduler.cancelByDoc(col, docId)
                        continue
                    }

                    val patientName = doc.getString("clienteNombre")
                        ?: doc.getString("nombre")
                        ?: doc.getString("cliente")
                        ?: doc.getString("displayName")
                        ?: doc.getString("nombrePaciente")
                        ?: "Paciente"
                    val service = doc.getString("servicio")
                        ?: doc.getString("tratamiento")
                        ?: doc.getString("serviceName")
                        ?: ""
                    val box = doc.getString("box") ?: doc.getString("boxLabel")

                    // Alarma al comienzo del turno — solo si el usuario la tiene activada.
                    if (prefs.atStart && fireAtMs > now) {
                        val startKey = "${col}_${docId}_start"
                        scheduler.schedule(
                            AlarmEntity(
                                key = startKey,
                                requestCode = startKey.hashCode() and Int.MAX_VALUE,
                                fireAtMs = fireAtMs,
                                patientName = patientName,
                                service = service,
                                box = box,
                                collection = col,
                                docId = docId,
                                type = "start",
                                appointmentAtMs = fireAtMs,
                            )
                        )
                        scheduledCount++
                    } else {
                        scheduler.cancel("${col}_${docId}_start")
                    }

                    // Aviso previo — solo si advanceMinutes > 0.
                    if (prefs.advanceMinutes > 0) {
                        val advMs = fireAtMs - prefs.advanceMinutes * 60_000L
                        if (advMs > now) {
                            val advKey = "${col}_${docId}_advance"
                            scheduler.schedule(
                                AlarmEntity(
                                    key = advKey,
                                    requestCode = advKey.hashCode() and Int.MAX_VALUE,
                                    fireAtMs = advMs,
                                    patientName = patientName,
                                    service = service,
                                    box = box,
                                    collection = col,
                                    docId = docId,
                                    type = "advance",
                                    appointmentAtMs = fireAtMs,
                                )
                            )
                            scheduledCount++
                        } else {
                            scheduler.cancel("${col}_${docId}_advance")
                        }
                    } else {
                        scheduler.cancel("${col}_${docId}_advance")
                    }
                }
            }

            // ── Reconciliación: reservas BORRADAS de Firestore (no solo marcadas
            // "cancelado") ──────────────────────────────────────────────────────
            // El bucle de arriba solo recorre snap.documents, o sea, documentos
            // que TODAVÍA existen. Si alguien borra una reserva (deleteDoc, como
            // hace "Borrar reserva" en el panel), el documento simplemente deja
            // de aparecer en la consulta — nada más arriba se entera de eso, y la
            // alarma que ya estaba programada en AlarmManager queda sonando en su
            // horario original aunque la reserva ya no exista. Acá se cancela
            // cualquier alarma SCHEDULED cuyo docId no haya aparecido en esta
            // pasada, para su colección, dentro de la ventana consultada.
            var cancelledStale = 0
            val scheduledNow = alarmDb.alarmDao().getScheduled()
            val fromMs = LocalDate.parse(fromStr).atStartOfDay(AR_ZONE).toInstant().toEpochMilli()
            val toMsExclusive = LocalDate.parse(toStr).plusDays(1).atStartOfDay(AR_ZONE).toInstant().toEpochMilli()
            for (alarm in scheduledNow) {
                if (alarm.collection !in COLLECTIONS) continue
                // Sin datos frescos de esta colección en esta pasada (falló la
                // consulta): no reconciliar nada de ella para no cancelar por error.
                if (alarm.collection in failedCollections) continue
                if (alarm.appointmentAtMs < fromMs || alarm.appointmentAtMs >= toMsExclusive) continue
                val seenIds = seenByCollection[alarm.collection] ?: emptySet()
                if (alarm.docId !in seenIds) {
                    scheduler.cancel(alarm.key)
                    cancelledStale++
                }
            }
            if (cancelledStale > 0) {
                Log.d(TAG, "Reconciliación: $cancelledStale alarma(s) canceladas por reserva borrada de Firestore")
            }

            // Limpiar alarmas vencidas de Room (> 24 h atrás, ya no SCHEDULED).
            alarmDb.alarmDao().pruneOld(now - 24 * 60 * 60 * 1000L)
            prefs.lastSyncMs = now
            prefs.lastSyncError = null
            prefs.lastSyncScheduledCount = scheduledCount
            prefs.lastSyncCancelledStaleCount = cancelledStale
            Log.d(TAG, "Sync ok: $docsSeen documento(s) vistos, $scheduledCount alarma(s) programadas, $cancelledStale canceladas por borrado")
            Result.success()
        } catch (e: Exception) {
            Log.e(TAG, "Sync falló: ${e.javaClass.simpleName}: ${e.message}")
            prefs.lastSyncError = "${e.javaClass.simpleName}: ${e.message ?: "sin detalle"}"
            Result.retry()
        }
    }
}
