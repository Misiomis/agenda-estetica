package ar.mimart.reloj.data

import android.content.Context
import androidx.room.*

@Database(entities = [AlarmEntity::class], version = 1, exportSchema = false)
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
