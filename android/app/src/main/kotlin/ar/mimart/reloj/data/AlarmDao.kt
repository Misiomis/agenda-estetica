package ar.mimart.reloj.data

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface AlarmDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(alarm: AlarmEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(alarms: List<AlarmEntity>)

    @Query("SELECT * FROM alarms WHERE key = :key LIMIT 1")
    suspend fun getByKey(key: String): AlarmEntity?

    @Query("SELECT * FROM alarms WHERE status = 'SCHEDULED' ORDER BY fireAtMs ASC")
    fun observeScheduled(): Flow<List<AlarmEntity>>

    @Query("SELECT * FROM alarms WHERE status = 'SCHEDULED' ORDER BY fireAtMs ASC")
    suspend fun getScheduled(): List<AlarmEntity>

    /** Programadas + cualquier otro estado tocado después de :cutoff — para diagnóstico:
     *  deja ver por qué una alarma ya no está (CANCELLED/FIRED/DISMISSED), no solo las vigentes. */
    @Query("SELECT * FROM alarms WHERE status = 'SCHEDULED' OR updatedAt >= :cutoff ORDER BY fireAtMs DESC")
    suspend fun getRecent(cutoff: Long): List<AlarmEntity>

    @Query("SELECT * FROM alarms WHERE collection = :col AND docId = :docId")
    suspend fun getByDoc(col: String, docId: String): List<AlarmEntity>

    @Query("UPDATE alarms SET status = :status, updatedAt = :now WHERE key = :key")
    suspend fun updateStatus(key: String, status: AlarmStatus, now: Long)

    @Query("UPDATE alarms SET status = 'CANCELLED', updatedAt = :now WHERE collection = :col AND docId = :docId AND status = 'SCHEDULED'")
    suspend fun cancelByDoc(col: String, docId: String, now: Long)

    @Query("UPDATE alarms SET status = 'CANCELLED', updatedAt = :now WHERE status = 'SCHEDULED'")
    suspend fun cancelAll(now: Long)

    /** Limpia registros más viejos de 7 días que ya no están SCHEDULED. */
    @Query("DELETE FROM alarms WHERE status != 'SCHEDULED' AND updatedAt < :cutoff")
    suspend fun pruneOld(cutoff: Long)
}
