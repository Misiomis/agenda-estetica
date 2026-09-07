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

    @Query("SELECT * FROM alarms WHERE collection = :col AND docId = :docId")
    suspend fun getByDoc(col: String, docId: String): List<AlarmEntity>

    @Query("UPDATE alarms SET status = :status WHERE key = :key")
    suspend fun updateStatus(key: String, status: AlarmStatus)

    @Query("UPDATE alarms SET status = 'CANCELLED' WHERE collection = :col AND docId = :docId AND status = 'SCHEDULED'")
    suspend fun cancelByDoc(col: String, docId: String)

    @Query("UPDATE alarms SET status = 'CANCELLED' WHERE status = 'SCHEDULED'")
    suspend fun cancelAll()

    /** Limpia registros más viejos de 7 días que ya no están SCHEDULED. */
    @Query("DELETE FROM alarms WHERE status != 'SCHEDULED' AND createdAt < :cutoff")
    suspend fun pruneOld(cutoff: Long)
}
