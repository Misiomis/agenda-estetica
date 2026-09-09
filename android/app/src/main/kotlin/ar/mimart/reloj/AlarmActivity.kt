package ar.mimart.reloj

import android.app.*
import android.content.Intent
import android.os.*
import android.view.*
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import ar.mimart.reloj.data.PrefsManager

/**
 * AlarmActivity — se muestra sobre la pantalla de bloqueo cuando dispara una alarma.
 *
 * Declarada en el Manifest con:
 *   android:showWhenLocked="true"
 *   android:turnScreenOn="true"
 *   android:theme="@style/Theme.AlarmActivity"
 */
class AlarmActivity : AppCompatActivity() {

    private lateinit var key: String
    private lateinit var patientName: String
    private lateinit var service: String
    private var box: String? = null
    private lateinit var type: String

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Mostrar sobre pantalla bloqueada
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            )
        }

        setContentView(R.layout.activity_alarm)

        key         = intent.getStringExtra(AlarmReceiver.EXTRA_KEY)          ?: finish().let { return }
        patientName = intent.getStringExtra(AlarmReceiver.EXTRA_PATIENT_NAME) ?: "Paciente"
        service     = intent.getStringExtra(AlarmReceiver.EXTRA_SERVICE)      ?: ""
        box         = intent.getStringExtra(AlarmReceiver.EXTRA_BOX)
        type        = intent.getStringExtra(AlarmReceiver.EXTRA_TYPE)         ?: "start"

        val isAdvance = type == "advance"
        val prefs = PrefsManager(this)

        // ── Textos ──────────────────────────────────────────────────────
        findViewById<TextView>(R.id.alarm_eyebrow).text =
            if (isAdvance) "EN ${prefs.advanceMinutes} MINUTOS" else "INGRESO AHORA"
        findViewById<TextView>(R.id.alarm_name).text = patientName
        val detail = buildList {
            if (service.isNotEmpty()) add(service)
            if (!box.isNullOrEmpty()) add(box!!)
        }.joinToString(" · ")
        findViewById<TextView>(R.id.alarm_detail).text = detail
        if (detail.isEmpty()) findViewById<TextView>(R.id.alarm_detail).visibility = android.view.View.GONE

        // ── Botones ─────────────────────────────────────────────────────
        findViewById<Button>(R.id.btn_dismiss).setOnClickListener { dismiss() }
        val snoozeBtn = findViewById<Button>(R.id.btn_snooze)
        snoozeBtn.text = "Posponer ${prefs.snoozeMinutes} min"
        snoozeBtn.setOnClickListener { snooze() }
    }

    private fun dismiss() {
        AlarmReceiver.stopAudio()
        sendBroadcast(Intent(this, AlarmReceiver::class.java).apply {
            action = AlarmReceiver.ACTION_DISMISS
            putExtra(AlarmReceiver.EXTRA_KEY, key)
        })
        finish()
    }

    private fun snooze() {
        AlarmReceiver.stopAudio()
        sendBroadcast(Intent(this, AlarmReceiver::class.java).apply {
            action = AlarmReceiver.ACTION_SNOOZE
            putExtra(AlarmReceiver.EXTRA_KEY, key)
            putExtra(AlarmReceiver.EXTRA_PATIENT_NAME, patientName)
            putExtra(AlarmReceiver.EXTRA_SERVICE, service)
            putExtra(AlarmReceiver.EXTRA_BOX, box)
            putExtra(AlarmReceiver.EXTRA_TYPE, type)
        })
        finish()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // Si llegó una nueva alarma mientras esta estaba visible, actualizar UI.
        intent.getStringExtra(AlarmReceiver.EXTRA_PATIENT_NAME)?.let {
            patientName = it
            service = intent.getStringExtra(AlarmReceiver.EXTRA_SERVICE) ?: ""
            box = intent.getStringExtra(AlarmReceiver.EXTRA_BOX)
            type = intent.getStringExtra(AlarmReceiver.EXTRA_TYPE) ?: "start"
            key = intent.getStringExtra(AlarmReceiver.EXTRA_KEY) ?: key
            // Re-render
            recreate()
        }
    }

    // Impedir cierre con botón atrás durante alarma activa
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { /* no-op */ }
}
