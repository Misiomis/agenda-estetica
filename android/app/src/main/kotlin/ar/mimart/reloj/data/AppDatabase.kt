package ar.mimart.reloj.data

import android.content.Context
import androidx.room.*

// v2: agrega AlarmEntity.appointmentAtMs (reconciliación de reservas borradas
// en SyncWorker). fallbackToDestructiveMigration() ya estaba configurado, así
// que esto solo vacía la tabla local "alarms" — pura caché de programación de
// AlarmManager, se reconstruye sola en la próxima sincronización. No toca
// reservas (viven en Firestore) ni SharedPreferences (ajustes del usuario).
@Database(entities = [AlarmEntity::class], version = 2, exportSchema = false)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun alarmDao(): AlarmDao

    companion object {
        @Volatile private var INSTANCE: AppDatabase? = null

        fun get(context: Context): AppDatabase = INSTANCE ?: synchronized(this) {
            INSTANCE ?: Room.databaseBuilder(
                context.applicationContext,
                AppDatabase::class.java,
                "mimart_reloj.db"
            )
                .fallbackToDestructiveMigration()
                .build()
                .also { INSTANCE = it }
        }
    }
}

class Converters {
    @TypeConverter fun fromStatus(s: AlarmStatus) = s.name
    @TypeConverter fun toStatus(s: String) = AlarmStatus.valueOf(s)
}
