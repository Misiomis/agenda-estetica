/**
 * alarm-bridge.js — Puente entre el motor web y el plugin nativo de alarmas.
 *
 * En la web: todas las funciones son no-ops o retornan valores compatibles,
 * de modo que reloj.js funciona sin cambios.
 * En Android (Capacitor): delega al AlarmPlugin nativo vía window.Capacitor.Plugins.AlarmPlugin.
 *
 * Contrato del plugin nativo (AlarmPlugin.kt):
 *   schedule({ alarms: AlarmData[] }) → void
 *   cancelByKey({ key: string }) → void
 *   cancelAll() → void
 *   getScheduled() → { alarms: ScheduledAlarm[] }
 *   getPermissionStatus() → PermissionStatus
 *   requestExactAlarmPermission() → void  (abre Ajustes)
 *   isNativePlatform() → { value: boolean }
 *   testAlarm({ delayMs: number }) → void
 *   saveFcmToken({ token: string }) → void
 */

/** @typedef {{ key:string, fireAtMs:number, patientName:string, service:string, box:string|null, collection:string, docId:string, type:'advance'|'start' }} AlarmData */

const _plugin = () => window?.Capacitor?.Plugins?.AlarmPlugin ?? null;

export const isNativeAndroid = !!window?.Capacitor;

/**
 * Agenda alarmas nativas a partir de una lista de reservas normalizadas.
 * normalizedBookings: array de objetos de motor.js (normalizeBooking output).
 * advanceMinutes: minutos de anticipación (default 5).
 */
export async function scheduleAlarms(normalizedBookings, advanceMinutes = 5) {
  const plugin = _plugin();
  if (!plugin) return;

  const alarms = [];
  for (const b of normalizedBookings) {
    if (!Number.isFinite(b.start) || b.state !== "scheduled") continue;
    const name = b.name || "Paciente";
    const svc  = b.service || "";
    const box  = b.box || null;

    // Aviso previo
    if (advanceMinutes > 0) {
      const fireAt = b.start - advanceMinutes * 60_000;
      if (fireAt > Date.now()) {
        alarms.push({
          key: `${b.source}_${b.id}_advance`,
          fireAtMs: fireAt,
          patientName: name,
          service: svc,
          box,
          collection: b.source,
          docId: b.id,
          type: "advance",
        });
      }
    }

    // Aviso al ingreso
    if (b.start > Date.now()) {
      alarms.push({
        key: `${b.source}_${b.id}_start`,
        fireAtMs: b.start,
        patientName: name,
        service: svc,
        box,
        collection: b.source,
        docId: b.id,
        type: "start",
      });
    }
  }

  if (alarms.length > 0) {
    await plugin.schedule({ alarms });
  }
}

/** Cancela todas las alarmas de un documento específico. */
export async function cancelAlarmsForDoc(collection, docId) {
  const plugin = _plugin();
  if (!plugin) return;
  for (const type of ["advance", "start"]) {
    await plugin.cancelByKey({ key: `${collection}_${docId}_${type}` });
  }
}

/** Cancela todas las alarmas programadas. */
export async function cancelAllAlarms() {
  const plugin = _plugin();
  if (!plugin) return;
  await plugin.cancelAll();
}

/** Retorna el estado de permisos necesarios para alarmas. */
export async function getPermissionStatus() {
  const plugin = _plugin();
  if (!plugin) return { exactAlarm: "granted", notifications: "granted", ready: true };
  return plugin.getPermissionStatus();
}

/** Abre los ajustes del sistema para conceder permiso de alarmas exactas. */
export async function requestExactAlarmPermission() {
  const plugin = _plugin();
  if (!plugin) return;
  await plugin.requestExactAlarmPermission();
}

/** Retorna las alarmas actualmente programadas en el sistema. */
export async function getScheduledAlarms() {
  const plugin = _plugin();
  if (!plugin) return { alarms: [] };
  return plugin.getScheduled();
}

/** Dispara una alarma de prueba en `delayMs` milisegundos (default 5 s). */
export async function testAlarm(delayMs = 5000) {
  const plugin = _plugin();
  if (!plugin) {
    console.log("[alarm-bridge] testAlarm: plataforma web, sin alarma nativa.");
    return;
  }
  await plugin.testAlarm({ delayMs });
}

/** Envía el token FCM al servidor para recibir actualizaciones en segundo plano. */
export async function saveFcmToken(token) {
  const plugin = _plugin();
  if (!plugin || !token) return;
  await plugin.saveFcmToken({ token });
}
