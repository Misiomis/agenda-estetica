package ar.mimart.inteligente

import android.content.Intent
import android.os.Build
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * UpdatePlugin — actualización remota de la APK (punto 8), sin Google Play.
 *
 * Descarga el APK a un archivo propio de la app (getExternalFilesDir, cubre
 * con file_paths.xml → FileProvider) y abre el instalador del sistema. Si
 * la descarga falla o el hash no coincide, no se toca nada de lo que ya
 * está instalado — la app actual sigue funcionando igual.
 *
 * La firma (signingConfig de release) es lo único que de verdad garantiza
 * que Android acepte instalar "encima" de la versión actual — este plugin
 * no puede forzar eso, solo entrega el APK correcto; si la firma no
 * coincide, Android va a rechazar la instalación con
 * INSTALL_FAILED_UPDATE_INCOMPATIBLE y el instalador del sistema se lo va
 * a mostrar a la persona.
 *
 * Métodos disponibles en JS vía window.Capacitor.Plugins.UpdatePlugin:
 *   downloadAndInstall({ apkUrl, sha256 }) → void (abre el instalador)
 */
@CapacitorPlugin(name = "UpdatePlugin")
class UpdatePlugin : Plugin() {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    @PluginMethod
    fun downloadAndInstall(call: PluginCall) {
        val apkUrl = call.getString("apkUrl") ?: run { call.reject("apkUrl requerido"); return }
        val sha256Esperado = call.getString("sha256")

        scope.launch {
            val destino = File(context.getExternalFilesDir(null), "mimar-inteligente-update.apk")
            try {
                if (destino.exists()) destino.delete()

                val conn = URL(apkUrl).openConnection() as HttpURLConnection
                conn.connectTimeout = 15000
                conn.readTimeout = 30000
                conn.connect()
                if (conn.responseCode !in 200..299) {
                    throw Exception("El servidor respondió ${conn.responseCode} al descargar el APK")
                }
                conn.inputStream.use { input ->
                    destino.outputStream().use { output -> input.copyTo(output) }
                }

                if (!sha256Esperado.isNullOrBlank()) {
                    val real = calcularSha256(destino)
                    if (!real.equals(sha256Esperado, ignoreCase = true)) {
                        destino.delete()
                        withContext(Dispatchers.Main) {
                            call.reject("El archivo descargado no coincide con el hash esperado (posible descarga corrupta o incompleta) — no se instaló nada")
                        }
                        return@launch
                    }
                }

                val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", destino)
                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/vnd.android.package-archive")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }

                withContext(Dispatchers.Main) {
                    context.startActivity(intent)
                    call.resolve(JSObject().put("status", "instalador_abierto"))
                }
            } catch (e: Exception) {
                // Fallo de descarga: no se deja el archivo a medio escribir, y
                // la versión actual instalada sigue intacta y usable.
                destino.delete()
                withContext(Dispatchers.Main) {
                    call.reject("No se pudo descargar/instalar la actualización: ${e.message}")
                }
            }
        }
    }

    // Detecta si esta instalación puede recibir REQUEST_INSTALL_PACKAGES sin
    // que el sistema muestre primero la pantalla de "permitir instalar apps
    // desconocidas" — informativo para la UI, no bloquea la descarga.
    @PluginMethod
    fun getInstallPermissionStatus(call: PluginCall) {
        val puedeInstalar = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.packageManager.canRequestPackageInstalls()
        } else true
        call.resolve(JSObject().put("canInstall", puedeInstalar))
    }

    private fun calcularSha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(8192)
            var bytesRead: Int
            while (input.read(buffer).also { bytesRead = it } != -1) {
                digest.update(buffer, 0, bytesRead)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
