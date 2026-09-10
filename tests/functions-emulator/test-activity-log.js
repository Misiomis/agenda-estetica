// Prueba de integración contra el Firebase Local Emulator Suite — requiere
// el emulador de Firestore+Functions corriendo (ver README.md de esta
// carpeta). Verifica activityLog (punto 2 del pedido de Mimar T Inteligente).
const path = require('path');
const admin = require(path.join(__dirname, '..', '..', 'functions', 'node_modules', 'firebase-admin'));
admin.initializeApp({ projectId: 'estetica-8d067' });
const db = admin.firestore();

function pad(n) { return String(n).padStart(2, '0'); }

async function contarActivityLog(coleccion, docId) {
  const snap = await db.collection('activityLog').where('coleccion', '==', coleccion).where('docId', '==', docId).get();
  return snap.docs.map(d => d.data());
}

// Espera (con reintentos) a que la condicion se cumpla, en vez de un sleep fijo
async function esperar(fn, { intentos = 20, esperaMs = 500 } = {}) {
  for (let i = 0; i < intentos; i++) {
    const r = await fn();
    if (r) return r;
    await new Promise(res => setTimeout(res, esperaMs));
  }
  return await fn();
}

(async () => {
  const resultados = [];

  // 1) Nueva reserva -> debe generar 1 evento "Nueva reserva"
  const r1 = await db.collection('reservas').add({ nombreLimpio: 'Ana Testigo', fecha: '2099-05-05', hora: '11:00', estado: 'confirmado' });
  let eventos = await esperar(async () => { const e = await contarActivityLog('reservas', r1.id); return e.length >= 1 ? e : null; }) || [];
  resultados.push(['reserva create -> 1 evento "Nueva reserva"', eventos.length === 1 && /Nueva reserva/.test(eventos[0].resumen), JSON.stringify(eventos.map(e=>e.resumen))]);

  // 2) Cancelar esa reserva -> debe generar 1 evento MAS "Reserva cancelada"
  await r1.update({ estado: 'cancelado', motivoCancelacion: 'prueba automatica de verificacion' });
  eventos = await esperar(async () => { const e = await contarActivityLog('reservas', r1.id); return e.length >= 2 ? e : null; }) || eventos;
  resultados.push(['reserva cancelada -> 2 eventos total, el 2do "Reserva cancelada"', eventos.length === 2 && eventos.some(e => /Reserva cancelada/.test(e.resumen)), JSON.stringify(eventos.map(e=>e.resumen))]);

  // 3) Reserva con cambio irrelevante (sin cambiar estado/fecha/hora) -> NO debe generar evento nuevo
  await r1.update({ box: 'b2' });
  await new Promise(res => setTimeout(res, 3000)); // acá esperamos que NO pase nada, no hay condicion positiva que sondear
  eventos = await contarActivityLog('reservas', r1.id);
  resultados.push(['reserva cambio irrelevante (box) -> sigue en 2 eventos (sin ruido)', eventos.length === 2, JSON.stringify(eventos.map(e=>e.resumen))]);

  // 4) Cliente nuevo con fechaNacimiento = hoy (MM-DD) -> debe generar evento "Nuevo paciente" y setear cumpleMesDia
  const hoy = new Date();
  const mesDia = `${pad(hoy.getMonth()+1)}-${pad(hoy.getDate())}`;
  const dniTest = '99999999';
  await db.collection('clients').doc(dniTest).set({ fullName: 'Cliente Cumple Test', fechaNacimiento: `1990-${mesDia}`, active: true });
  eventos = await esperar(async () => { const e = await contarActivityLog('clients', dniTest); return e.length >= 1 ? e : null; }) || [];
  const clienteSnap = await esperar(async () => { const s = await db.collection('clients').doc(dniTest).get(); return s.data().cumpleMesDia ? s : null; }) || await db.collection('clients').doc(dniTest).get();
  resultados.push(['cliente create -> 1 evento "Nuevo paciente"', eventos.length === 1 && /Nuevo paciente/.test(eventos[0].resumen), JSON.stringify(eventos.map(e=>e.resumen))]);
  resultados.push(['cliente -> cumpleMesDia calculado correctamente', clienteSnap.data().cumpleMesDia === mesDia, `esperado ${mesDia}, obtuvo ${clienteSnap.data().cumpleMesDia}`]);

  // 5) Cliente: cambio de solo hoursBalance -> NO debe generar evento nuevo (filtro de ruido)
  await db.collection('clients').doc(dniTest).update({ hoursBalance: admin.firestore.FieldValue.increment(-1) });
  await new Promise(res => setTimeout(res, 3000));
  eventos = await contarActivityLog('clients', dniTest);
  resultados.push(['cliente cambio de hoursBalance -> sigue en 1 evento (sin ruido)', eventos.length === 1, JSON.stringify(eventos.map(e=>e.resumen))]);

  // 6) Cliente: activar membresia -> SI debe generar evento
  await db.collection('clients').doc(dniTest).update({ membershipActive: true });
  eventos = await esperar(async () => { const e = await contarActivityLog('clients', dniTest); return e.length >= 2 ? e : null; }) || eventos;
  resultados.push(['cliente membresia activada -> 2 eventos, el 2do "Membresía activada"', eventos.length === 2 && eventos.some(e => /Membresía activada/.test(e.resumen)), JSON.stringify(eventos.map(e=>e.resumen))]);

  // 7) Consulta nueva -> debe generar evento
  const c1 = await db.collection('consultas').add({ nombre: 'Consulta Testigo', fecha: '2099-06-06', hora: '09:00', estado: 'pendiente' });
  eventos = await esperar(async () => { const e = await contarActivityLog('consultas', c1.id); return e.length >= 1 ? e : null; }) || [];
  resultados.push(['consulta create -> 1 evento "Nueva consulta inicial"', eventos.length === 1 && /Nueva consulta inicial/.test(eventos[0].resumen), JSON.stringify(eventos.map(e=>e.resumen))]);

  // 8) Pedido de kit nuevo -> debe generar evento
  const k1 = await db.collection('pedidosKit').add({ nombrePaciente: 'Kit Testigo', estado: 'pendiente' });
  eventos = await esperar(async () => { const e = await contarActivityLog('pedidosKit', k1.id); return e.length >= 1 ? e : null; }) || [];
  resultados.push(['pedidoKit create -> 1 evento "Nuevo pedido de kit"', eventos.length === 1 && /Nuevo pedido de kit/.test(eventos[0].resumen), JSON.stringify(eventos.map(e=>e.resumen))]);

  // 9) Reserva de depilación nueva -> debe generar evento
  const rd1 = await db.collection('reservasDepi').add({ nombre: 'Depi Testigo', fecha: '2099-08-08', hora: '14:00', estado: 'confirmado' });
  eventos = await esperar(async () => { const e = await contarActivityLog('reservasDepi', rd1.id); return e.length >= 1 ? e : null; }) || [];
  resultados.push(['reservaDepi create -> 1 evento "Nueva reserva de depilación"', eventos.length === 1 && /Nueva reserva de depilación/.test(eventos[0].resumen), JSON.stringify(eventos.map(e=>e.resumen))]);

  // 10) Inscripción a curso de automaquillaje nueva -> debe generar evento
  const cm1 = await db.collection('cursoMaquillaje').add({ nombre: 'Curso Testigo' });
  eventos = await esperar(async () => { const e = await contarActivityLog('cursoMaquillaje', cm1.id); return e.length >= 1 ? e : null; }) || [];
  resultados.push(['cursoMaquillaje create -> 1 evento "Nueva inscripción"', eventos.length === 1 && /Nueva inscripción/.test(eventos[0].resumen), JSON.stringify(eventos.map(e=>e.resumen))]);

  console.log('\n=== RESULTADOS ===');
  let fallas = 0;
  for (const [nombre, ok, detalle] of resultados) {
    console.log((ok ? 'PASS' : 'FAIL') + ' - ' + nombre + '  [' + detalle + ']');
    if (!ok) fallas++;
  }
  console.log(`\n${resultados.length - fallas}/${resultados.length} OK`);
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('ERROR EN TEST:', e); process.exit(1); });
