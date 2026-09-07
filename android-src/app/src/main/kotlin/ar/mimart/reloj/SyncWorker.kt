package ar.mimart.reloj

import android.content.Context
import androidx.work.*
import ar.mimart.reloj.data.AlarmEntity
import ar.mimart.reloj.data.AlarmStatus
import ar.mimart.reloj.data.AppDatabase
import ar.mimart.reloj.data.PrefsManager
import com.google.firebase.FirebaseApp
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.QuerySnapshot
import kotlinx.coroutines.*
import kotlinx.coroutines.tasks.await
import java.util.concurrent.TimeUnit

/**
 * SyncWorker — sincroniza reservas de Firestore y reconcilia alarmas en Room/AlarmManager.
 *
 * Se ejecuta:
 *  1. Periódicamente cada 15 min (mínimo WorkManager) — para detectar cambios sin FCM.
 *  2. Inmediatamente al recibir mensaje FCM tipo "sync".
 *  3. Al abrir la app (enqueueImmediate desde MainActivity).
 *
 * NO es responsable de disparar alarmas — eso lo hace AlarmManager.
 * Solo mantiene Room sincronizado y AlarmManager con las alarmas correctas.
 */
class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    companion object {
        private const val WORK_PERIODIC = "mimart_sync_periodic"
        private const val WORK_IMMEDIATE = "mimart_sync_immediate"

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

        /** Ejecuta una sincronización inmediata (FCM, app open). */
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
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val prefs = PrefsManager(applicationContext)
        if (!prefs.alarmsEnabled) return@withContext Result.success()

        try {
            if (FirebaseApp.getApps(applicationContext).isEmpty()) {
                // Firebase no inicializado aún — saltear, la app web lo hará al abrirse
                return@withContext Result.retry()
            }

            val db = FirebaseFirestore.getInstance()
            val alarmDb = AppDatabase.get(applicationContext)
            val scheduler = AlarmScheduler(applicationContext)
            val now = System.currentTimeMillis()
            val horizonMs = prefs.horizonDays * 24 * 60 * 60 * 1000L
            val cutoff = now + horizonMs

            // Colecciones a sincronizar
            val collections = listOf("reservas", "sesiones")

            for (col in collections) {
                val snap: QuerySnapshot = db.collection(col)
                    .whereGreaterThan("fechaMs", now - 60_000L)  // desde hace 1 min
                    .whereLessThan("fechaMs", cutoff)
                    .get()
                    .await()

                for (doc in snap.documents) {
                    val docId = doc.id
                    val fechaMs = doc.getLong("fechaMs") ?: continue
                    val patientName = doc.getString("nombrePaciente")
                        ?: doc.getString("nombre") ?: continue
                    val service = doc.getString("servicio") ?: ""
                    val box = doc.getString("box")
                    val cancelled = doc.getBoolean("cancelada") == true
                        || doc.getString("estado") == "cancelada"

                    if (cancelled) {
                        scheduler.cancelByDoc(col, docId)
                        continue
                    }

                    // Alarma de inicio
                    val startKey = "${col}_${docId}_start"
                    val startEntity = AlarmEntity(
                        key = startKey,
                        requestCode = startKey.hashCode() and Int.MAX_VALUE,
                        fireAtMs = fechaMs,
                        patientName = patientName,
                        service = service,
                        box = box,
                        collection = col,
                        docId = docId,
                        type = "start",
                    )
                    if (fechaMs > now) scheduler.schedule(startEntity)

                    // Alarma de aviso anticipado
                    val advMs = fechaMs - prefs.advanceMinutes * 60_000L
                    if (advMs > now) {
                        val advKey = "${col}_${docId}_advance"
                        val advEntity = startEntity.copy(
                            key = advKey,
                            requestCode = advKey.hashCode() and Int.MAX_VALUE,
                            fireAtMs = advMs,
                            type = "advance",
                        )
                        scheduler.schedule(advEntity)
                    }
                }
            }

            // Limpiar alarmas vencidas de Room (> 24 h atrás)
            alarmDb.alarmDao().pruneOld(now - 24 * 60 * 60 * 1000L)
            prefs.lastSyncMs = now
            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }
}
