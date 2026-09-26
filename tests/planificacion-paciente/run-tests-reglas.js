// Reglas de Firestore para clients.planificacion. Requiere el emulador de Firestore corriendo
// (ej.: npx firebase emulators:exec "node tests/planificacion-paciente/run-tests-reglas.js" --only firestore --project estetica-8d067).
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, setLogLevel } = require('firebase/firestore');

let fails = 0;
const check = (desc, cond) => { console.log((cond ? '  OK   ' : '  FAIL ') + desc); if (!cond) fails++; };
const intenta = async (p, esperado) => { try { await (esperado === 'ok' ? assertSucceeds(p) : assertFails(p)); return true; } catch (e) { return false; } };

(async () => {
  try { setLogLevel && setLogLevel('error'); } catch (_) {}
  const host = (process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8090').split(':');
  const env = await initializeTestEnvironment({
    projectId: 'demo-reglas-planificacion',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8'), host: host[0], port: Number(host[1]) },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'clients/90000001'), { dni: '90000001', fullName: 'Paciente Prueba', phone: '1', notaAjena: 'x' });
  });
  const admin = env.authenticatedContext('adm', { email: 'espaciomimart36@gmail.com' }).firestore();
  const otro = env.authenticatedContext('otro', { email: 'otra.persona@example.com' }).firestore();
  const anon = env.unauthenticatedContext().firestore();
  const plan = { version: 1, disponibilidad: { modo: 'estricta', dias: {} } };

  console.log('\n=== clients.planificacion ===');
  check('admin puede guardar la planificación', await intenta(updateDoc(doc(admin, 'clients/90000001'), { planificacion: plan }), 'ok'));
  check('un visitante anónimo NO puede escribir la planificación', await intenta(updateDoc(doc(anon, 'clients/90000001'), { planificacion: { ...plan, observaciones: 'pisado' } }), 'fail'));
  check('un usuario logueado que no es admin NO puede escribirla', await intenta(updateDoc(doc(otro, 'clients/90000001'), { planificacion: { ...plan, observaciones: 'otro usuario' } }), 'fail'));
  check('anónimo tampoco puede modificar solo un subcampo (planificacion.observaciones)', await intenta(updateDoc(doc(anon, 'clients/90000001'), { 'planificacion.observaciones': 'x' }), 'fail'));
  check('lo que ya se permitía sigue igual: anónimo puede actualizar un campo no protegido (ej. teléfono)', await intenta(updateDoc(doc(anon, 'clients/90000001'), { phone: '3760000000' }), 'ok'));
  check('lo que ya estaba protegido sigue protegido (hoursBalance)', await intenta(updateDoc(doc(anon, 'clients/90000001'), { hoursBalance: 99 }), 'fail'));
  check('admin sigue pudiendo escribir cualquier campo', await intenta(updateDoc(doc(admin, 'clients/90000001'), { hoursBalance: 5 }), 'ok'));
  check('lectura pública de clients no cambió (sin ampliar ni recortar en esta tarea)', await intenta(getDoc(doc(anon, 'clients/90000001')), 'ok'));

  await env.cleanup();
  console.log('\n' + '='.repeat(60));
  console.log(fails ? fails + ' prueba(s) de reglas fallaron' : 'TODAS LAS PRUEBAS DE REGLAS OK');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
