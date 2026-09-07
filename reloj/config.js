// Único archivo de configuración del módulo. No contiene contraseñas ni claves.
// En Capacitor/Android el webDir es reloj/, así que firebase-web.js es local.
const _isCapacitor = typeof window !== "undefined" && !!window.Capacitor;
export const CONFIG = Object.freeze({
  nombre: "Mimar T",
  firebaseModule: _isCapacitor ? "./firebase-web.js" : "../js/firebase-web.js",
  adminPage: "../admin.html",
  adminEmails: ["espaciomimart36@gmail.com"],
  timeZone: "America/Argentina/Buenos_Aires",
  // Las fechas de la agenda son YYYY-MM-DD y las horas corresponden a Argentina.
  utcOffset: "-03:00",
  graceMs: 90_000,
  sources: [
    { id: "reservas", label: "Agenda estética", enabled: true },
    { id: "consultas", label: "Consultas iniciales", enabled: true },
    { id: "reservasDepi", label: "Depilación", enabled: true },
    // Tu panel actual usa reservasDepi. Activar la variante antigua solo si
    // realmente contiene una agenda distinta, para evitar reservas duplicadas.
    { id: "reservas_depi", label: "Depilación · archivo anterior", enabled: false }
  ],
  defaults: {
    advanceMinutes: 5,
    atStart: true,
    volume: 0.5,
    tone: "campana",
    wakeLock: true,
    notifications: false
  }
});
