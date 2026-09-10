// Prueba de integración contra el Firebase Local Emulator Suite — requiere
// el emulador de Firestore+Functions corriendo (ver README.md de esta
// carpeta). Verifica cumpleMesDia y resumenesCumpleanos (punto 4).
const path = require('path');
const admin = require(path.join(__dirname, '..', '..', 'functions', 'node_modules', 'firebase-admin'));
admin.initializeApp({ projectId: 'estetica-8d067' });
const db = admin.firestore();

function pad(n) { return String(n).padStart(2, '0'); }

// Replica exacta de la lógica de resumenCumpleanosDiario (sin el wrapper onSchedule)
async function simularResumenCumpleanos(mesDia, fechaISO) {
  const snap = await db.collection('clients').where('cumpleMesDia', '==', mesDia).get();
  const personas = [];
  snap.forEach((d) => {
    const c = d.data();
    personas.push({ clientId: d.id, nombre: c.fullName || c.nombre || 'Paciente', telefonoDisponible: !!(c.phone || c.telefono) });
  });
  await db.collection('resumenesCumpleanos').doc(fechaISO).set({
    fecha: fechaISO, estado: 'ok', generadoAt: admin.firestore.FieldValue.serverTimestamp(), personas
  });
  return personas;
}

(async () => {
  const resultados = [];
  const hoy = new Date();
  const mesDiaHoy = `${pad(hoy.getMonth()+1)}-${pad(hoy.getDate())}`;
  const fechaISO = `${hoy.getFullYear()}-${mesDiaHoy}`;

  // Cliente que cumple hoy (año arbitrario, mismo mes-dia)
  await db.collection('clients').doc('88888881').set({ fullName: 'Cumple Hoy Uno', fechaNacimiento: `1985-${mesDiaHoy}`, phone: '3764000001' });
  // Cliente que cumple hoy, sin telefono
  await db.collection('clients').doc('88888882').set({ fullName: 'Cumple Hoy Dos', fechaNacimiento: `1992-${mesDiaHoy}` });
  // Cliente que NO cumple hoy (mes-dia distinto, a proposito del 1 de enero salvo que hoy sea 1 de enero)
  const otroMesDia = mesDiaHoy === '01-01' ? '06-15' : '01-01';
  await db.collection('clients').doc('88888883').set({ fullName: 'No Cumple Hoy', fechaNacimiento: `1990-${otroMesDia}` });
  // Cliente con fecha invalida -> no debe romper nada ni aparecer
  await db.collection('clients').doc('88888884').set({ fullName: 'Fecha Invalida', fechaNacimiento: 'no-es-una-fecha' });
  // Cliente con fecha 29 de febrero (para confirmar que la comparación de string simplemente no matchea fuera de esa fecha exacta)
  await db.collection('clients').doc('88888885').set({ fullName: 'Nacido Bisiesto', fechaNacimiento: '2000-02-29' });

  // esperar a que los triggers terminen de setear cumpleMesDia en los 5
  await new Promise(res => setTimeout(res, 4000));

  const personas = await simularResumenCumpleanos(mesDiaHoy, fechaISO);
  const nombres = personas.map(p => p.nombre).sort();

  resultados.push(['incluye a los 2 que cumplen hoy', nombres.includes('Cumple Hoy Uno') && nombres.includes('Cumple Hoy Dos'), JSON.stringify(nombres)]);
  resultados.push(['NO incluye al que no cumple hoy', !nombres.includes('No Cumple Hoy'), JSON.stringify(nombres)]);
  resultados.push(['NO incluye al de fecha inválida', !nombres.includes('Fecha Invalida'), JSON.stringify(nombres)]);
  resultados.push(['telefonoDisponible correcto por persona', personas.find(p=>p.nombre==='Cumple Hoy Uno')?.telefonoDisponible === true && personas.find(p=>p.nombre==='Cumple Hoy Dos')?.telefonoDisponible === false, JSON.stringify(personas)]);

  const resumenDoc = await db.collection('resumenesCumpleanos').doc(fechaISO).get();
  resultados.push(['resumenesCumpleanos/{fecha} quedó con estado "ok"', resumenDoc.exists && resumenDoc.data().estado === 'ok', JSON.stringify(resumenDoc.data())]);

  if (mesDiaHoy !== '02-29') {
    const bisiestoSnap = await db.collection('clients').doc('88888885').get();
    resultados.push(['nacido 29/feb NO matchea cumpleMesDia de hoy (no es 29/feb)', bisiestoSnap.data().cumpleMesDia !== mesDiaHoy, `cumpleMesDia=${bisiestoSnap.data().cumpleMesDia}, hoy=${mesDiaHoy}`]);
  }

  console.log('\n=== RESULTADOS CUMPLEAÑOS ===');
  let fallas = 0;
  for (const [nombre, ok, detalle] of resultados) {
    console.log((ok ? 'PASS' : 'FAIL') + ' - ' + nombre + '  [' + detalle + ']');
    if (!ok) fallas++;
  }
  console.log(`\n${resultados.length - fallas}/${resultados.length} OK`);
  process.exit(fallas ? 1 : 0);
})().catch(e => { console.error('ERROR EN TEST:', e); process.exit(1); });
