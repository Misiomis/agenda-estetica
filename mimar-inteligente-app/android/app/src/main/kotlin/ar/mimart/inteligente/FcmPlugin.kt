package ar.mimart.inteligente

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.PermissionState
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.google.firebase.messaging.FirebaseMessaging

/**
 * FcmPlugin — expone el token FCM y el permiso de notificaciones al
 * WebView. Mismo estilo que AlarmPlugin (Reloj Mimar T).
 *
 * Métodos disponibles en JS vía window.Capacitor.Plugins.FcmPlugin:
 *   getToken()                     → { token }
 *   getPermissionStatus()          → { notifications }
 *   requestNotificationPermission() → { notifications }
 *   openNotificationSettings()     → void (abre Ajustes > Notificaciones)
 */
@CapacitorPlugin(
    name = "FcmPlugin",
    permissions = [
        Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications"),
    ]
)
class FcmPlugin : Plugin() {

    @PluginMethod
    fun getToken(call: PluginCall) {
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (task.isSuccessful) {
                call.resolve(JSObject().put("token", task.result))
            } else {
                call.reject(task.exception?.message ?: "No se pudo obtener el token FCM")
            }
        }
    }

    @PluginMethod
    fun getPermissionStatus(call: PluginCall) {
        val notifOk = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        } else true
        call.resolve(JSObject().put("notifications", if (notifOk) "granted" else "denied"))
    }

    @PluginMethod
    fun requestNotificationPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissionForAlias("notifications", call, "notificationsCallback")
        } else {
            call.resolve(JSObject().put("notifications", "granted"))
        }
    }

    @PermissionCallback
    private fun notificationsCallback(call: PluginCall) {
        val granted = getPermissionState("notifications") == PermissionState.GRANTED
        call.resolve(JSObject().put("notifications", if (granted) "granted" else "denied"))
    }

    // Acceso directo a los ajustes nativos de notificaciones — ahí es donde
    // la operadora configura sonido/vibración por canal (novedades /
    // cumpleaños), en vez de reinventar esa pantalla dentro de la app.
    @PluginMethod
    fun openNotificationSettings(call: PluginCall) {
        try {
            val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            context.startActivity(intent)
        } catch (e: Exception) {
            try {
                val fallback = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.parse("package:${context.packageName}")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                context.startActivity(fallback)
            } catch (e2: Exception) { /* Ningún camino disponible en este dispositivo */ }
        }
        call.resolve()
    }
}
