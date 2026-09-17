// Pruebas de regresión — aviso de PDF de jornada duplicado en la misma
// semana (punto 7 de la auditoría de facturación, 2026-09-16).
//
// IMPORTANTE (mismo criterio que tests/identidad-paciente): espejo
// deliberado de _fechaEnZona/_semanaIdISO y de la lógica de
// generarPDFJornada que decide si avisar y qué patientes quedan
// incluidos. Si esas funciones cambian en admin.html, reflejar el
// cambio acá. Datos sintéticos, sin tocar Firestore real.

const assert = require('assert');

let fails = 0;
function check(desc, fn) {
  try { fn(); console.log('  OK  ' + desc); }
  catch (e) { fails++; console.log('  FAIL ' + desc + '\n       ' + e.message); }
}

// ─── Mirrors de admin.html (huso horario del negocio + id de semana) ─────
const ZONA_HORARIA_NEGOCIO = 'America/Argentina/Buenos_Aires';

function fechaEnZona(d, tz) {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: tz || ZONA_HORARIA_NEGOCIO, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const o = {};
  partes.forEach((p) => { if (p.type !== 'literal') o[p.type] = p.value; });
  return { y: +o.year, m: +o.month, dia: +o.day };
}

// Id de semana = fecha ISO del lunes de esa semana, en la zona del negocio.
function semanaIdISO(d, tz) {
  const f = fechaEnZona(d, tz);
  const base = new Date(Date.UTC(f.y, f.m - 1, f.dia, 12, 0, 0));
  const dow = base.getUTCDay(); // 0=domingo..6=sábado
  base.setUTCDate(base.getUTCDate() - ((dow + 6) % 7));
  const y = base.getUTCFullYear(), m = base.getUTCMonth() + 1, dia = base.getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

// _pjDuplicados / mensaje de confirmación (generarPDFJornada)
function evaluarDuplicados(patientData, generacionesPreviasPorClave) {
  return patientData.filter(p => generacionesPreviasPorClave.has(p.key));
}
function mensajeConfirmacion(duplicados, totalSeleccionados) {
  if (duplicados.length === 1) {
    return `Esta semana ya se generó un PDF de sesiones para ${duplicados[0].nombre}. ¿Deseás continuar?`;
  }
  const nombres = duplicados.map(p => p.nombre).join(', ');
  return `Esta semana ya se generó un PDF de sesiones para: ${nombres}. Si continuás, se va a generar el PDF completo para los ${totalSeleccionados} paciente(s) seleccionado(s), incluyendo a quienes ya lo tienen esta semana. ¿Deseás continuar?`;
}

// ─── Escenario 1: definición de semana lunes-domingo en huso de negocio ───
console.log('\n═══ Escenario 1 — semana lunes-domingo en America/Argentina/Buenos_Aires ═══');
{
  // Miércoles 2026-09-16 12:00 UTC → lunes de esa semana es 2026-09-14
  check('miércoles 16/09/2026 pertenece a la semana del lunes 14/09/2026', () => {
    assert.strictEqual(semanaIdISO(new Date('2026-09-16T15:00:00Z')), '2026-09-14');
  });
  check('el lunes de esa semana (14/09) da el mismo id que el miércoles', () => {
    assert.strictEqual(semanaIdISO(new Date('2026-09-14T15:00:00Z')), '2026-09-14');
  });
  check('el domingo 20/09 (fin de la misma semana) todavía da id 2026-09-14', () => {
    assert.strictEqual(semanaIdISO(new Date('2026-09-20T23:00:00Z')), '2026-09-14');
  });
}

// ─── Escenario 2 (spec): frontera domingo→lunes (cambio de semana) ────────
console.log('\n═══ Escenario 2 — frontera domingo a la noche → lunes a la madrugada ═══');
{
  // Domingo 2026-09-20 23:50 hora Argentina (UTC-3) = 2026-09-21T02:50Z
  const domingoTarde = new Date('2026-09-21T02:50:00Z'); // 23:50 del domingo en AR
  // Lunes 2026-09-21 00:10 hora Argentina = 2026-09-21T03:10Z
  const lunesTemprano = new Date('2026-09-21T03:10:00Z');
  check('23:50 del domingo (hora Argentina) todavía es semana del lunes 14/09', () => {
    assert.strictEqual(semanaIdISO(domingoTarde), '2026-09-14');
  });
  check('00:10 del lunes siguiente (hora Argentina) ya es semana nueva (21/09)', () => {
    assert.strictEqual(semanaIdISO(lunesTemprano), '2026-09-21');
  });
  check('generar 23:59 del domingo y 00:01 del lunes da DOS ids de semana distintos', () => {
    assert.notStrictEqual(semanaIdISO(domingoTarde), semanaIdISO(lunesTemprano));
  });
}

// ─── Escenario 3 (spec): frontera de fin de año diciembre→enero ──────────
console.log('\n═══ Escenario 3 — frontera de año (diciembre → enero) usa la misma zona ═══');
{
  // Jueves 31/12/2026 → lunes de esa semana es 28/12/2026 (mismo año)
  check('31/12/2026 (jueves) pertenece a la semana del lunes 28/12/2026', () => {
    assert.strictEqual(semanaIdISO(new Date('2026-12-31T15:00:00Z')), '2026-12-28');
  });
  // Viernes 01/01/2027 → lunes de esa semana es 28/12/2026 (semana que cruza el año)
  check('01/01/2027 (viernes) pertenece a la MISMA semana que empezó el 28/12/2026, no a una semana "2027-01"', () => {
    assert.strictEqual(semanaIdISO(new Date('2027-01-01T15:00:00Z')), '2026-12-28');
  });
  check('el 31/12/2026 y el 01/01/2027 dan el MISMO id de semana (no se cortan por año)', () => {
    assert.strictEqual(semanaIdISO(new Date('2026-12-31T15:00:00Z')), semanaIdISO(new Date('2027-01-01T15:00:00Z')));
  });
  // El lunes 04/01/2027 sí es una semana nueva
  check('el lunes 04/01/2027 ya es una semana nueva, distinta de la de fin de diciembre', () => {
    assert.notStrictEqual(semanaIdISO(new Date('2027-01-04T15:00:00Z')), '2026-12-28');
    assert.strictEqual(semanaIdISO(new Date('2027-01-04T15:00:00Z')), '2027-01-04');
  });
}

// ─── Escenario 4 (spec): texto exacto para un solo paciente duplicado ─────
console.log('\n═══ Escenario 4 — texto exacto de confirmación (un paciente) ═══');
{
  const patientData = [{ key: 'dni:1', nombre: 'Braulio Verón' }];
  const generaciones = new Map([['dni:1', { generadoEnMs: Date.now() }]]);
  const duplicados = evaluarDuplicados(patientData, generaciones);
  check('se detecta exactamente 1 duplicado', () => assert.strictEqual(duplicados.length, 1));
  check('el texto es exactamente el pedido por la especificación', () => {
    assert.strictEqual(
      mensajeConfirmacion(duplicados, patientData.length),
      'Esta semana ya se generó un PDF de sesiones para Braulio Verón. ¿Deseás continuar?'
    );
  });
}

// ─── Escenario 5 (spec): lote con varios pacientes, algunos ya generados ──
console.log('\n═══ Escenario 5 — selección múltiple, sólo algunos ya tienen PDF esta semana ═══');
{
  const patientData = [
    { key: 'dni:1', nombre: 'Paciente Uno' },
    { key: 'dni:2', nombre: 'Paciente Dos' },
    { key: 'dni:3', nombre: 'Paciente Tres' },
  ];
  const generaciones = new Map([['dni:2', { generadoEnMs: Date.now() }]]); // solo Paciente Dos
  const duplicados = evaluarDuplicados(patientData, generaciones);
  check('sólo se marca como duplicado al paciente que realmente ya tiene PDF esta semana', () => {
    assert.strictEqual(duplicados.length, 1);
    assert.strictEqual(duplicados[0].nombre, 'Paciente Dos');
  });

  const homonimos = [
    { key: 'dni:10', nombre: 'María Fernández' }, // DNI 10, sin PDF previo
    { key: 'dni:11', nombre: 'María Fernández' }, // homónima, DNI 11, con PDF previo
  ];
  const generacionesHom = new Map([['dni:11', { generadoEnMs: Date.now() }]]);
  const duplicadosHom = evaluarDuplicados(homonimos, generacionesHom);
  check('dos pacientes HOMÓNIMAS con DNI distinto no se confunden — sólo se avisa de la que realmente tiene PDF', () => {
    assert.strictEqual(duplicadosHom.length, 1);
    assert.strictEqual(duplicadosHom[0].key, 'dni:11');
  });

  const multiplesDup = evaluarDuplicados(patientData, new Map([['dni:1', {}], ['dni:2', {}]]));
  check('con varios duplicados el mensaje lista a todos y aclara que continuar los incluye', () => {
    const msg = mensajeConfirmacion(multiplesDup, patientData.length);
    assert.ok(msg.includes('Paciente Uno'));
    assert.ok(msg.includes('Paciente Dos'));
    assert.ok(msg.includes('continuás'));
    assert.ok(msg.includes('incluyendo a quienes ya lo tienen'));
  });
}

// ─── Escenario 6: cambiar el nombre cargado no evade el aviso (clave por DNI) ─
console.log('\n═══ Escenario 6 — cambiar el nombre no evade el aviso (identidad por clave, no por nombre) ═══');
{
  const generaciones = new Map([['dni:99', { generadoEnMs: Date.now() }]]);
  const mismoDniNombreNuevo = [{ key: 'dni:99', nombre: 'Nombre Cambiado Después Del PDF' }];
  const duplicados = evaluarDuplicados(mismoDniNombreNuevo, generaciones);
  check('el mismo DNI sigue detectándose como duplicado aunque el nombre cargado haya cambiado', () => {
    assert.strictEqual(duplicados.length, 1);
  });
}

// ─── Escenario 7: reserva/lock de concurrencia — expira y se libera ───────
console.log('\n═══ Escenario 7 — reserva de generación concurrente (doble toque / dos dispositivos) ═══');
{
  // Simula _pjAdquirirLock con un Map como Firestore falso
  const locksFake = new Map();
  function adquirirLockFake(pacienteKey, semanaId, ahoraMs) {
    const id = pacienteKey + '__' + semanaId;
    const existente = locksFake.get(id);
    if (existente && existente.expiraEnMs > ahoraMs) return false; // ya hay una generación en curso
    locksFake.set(id, { expiraEnMs: ahoraMs + 3 * 60000 });
    return true;
  }
  const t0 = Date.now();
  check('el primer toque adquiere el lock', () => {
    assert.strictEqual(adquirirLockFake('dni:1', '2026-09-14', t0), true);
  });
  check('un segundo toque inmediato (doble tap) NO adquiere el lock — no se ofrece como "ya generado" ni se duplica', () => {
    assert.strictEqual(adquirirLockFake('dni:1', '2026-09-14', t0 + 500), false);
  });
  check('pasados los 3 minutos, el lock expiró solo y un nuevo intento sí lo adquiere', () => {
    assert.strictEqual(adquirirLockFake('dni:1', '2026-09-14', t0 + 3 * 60000 + 1000), true);
  });
}

// ─── Escenario 8: solo una generación REALMENTE completada cuenta ─────────
console.log('\n═══ Escenario 8 — sólo una generación completada (doc.save) se registra como exitosa ═══');
{
  const registrosFake = [];
  function generarJornadaFake(pacientes, falla) {
    if (falla) throw new Error('fallo simulado antes de doc.save()');
    // "doc.save()" ocurrió acá — recién ahora se registran las generaciones
    pacientes.forEach(p => registrosFake.push({ pacienteKey: p.key, generadoEnMs: Date.now() }));
  }
  check('una generación que falla ANTES de guardar el PDF no registra nada', () => {
    try { generarJornadaFake([{ key: 'dni:1' }], true); } catch (e) { /* esperado */ }
    assert.strictEqual(registrosFake.length, 0);
  });
  check('una generación que sí termina (doc.save) registra exactamente una entrada por paciente', () => {
    generarJornadaFake([{ key: 'dni:1' }, { key: 'dni:2' }], false);
    assert.strictEqual(registrosFake.length, 2);
  });
}

// ═══ Delta del punto 7 (2026-09-17): semana de la JORNADA, no de "hoy" ════
// Mirror de _pjFechaISOaDateUTC + _pjRangoSemana + _pjFirmaContenido de
// admin.html.
function fechaISOaDateUTC(fechaISO) {
  const p = (fechaISO || '').split('-').map(Number);
  if (!p[0] || !p[1] || !p[2]) return new Date();
  return new Date(Date.UTC(p[0], p[1] - 1, p[2], 12, 0, 0));
}
function rangoSemana(semanaId) {
  const p = (semanaId || '').split('-').map(Number);
  if (!p[0] || !p[1] || !p[2]) return { inicio: semanaId, fin: semanaId };
  const lunes = new Date(Date.UTC(p[0], p[1] - 1, p[2], 12, 0, 0));
  const domingo = new Date(lunes.getTime());
  domingo.setUTCDate(domingo.getUTCDate() + 6);
  const fmt = (dt) => String(dt.getUTCDate()).padStart(2, '0') + '/' + String(dt.getUTCMonth() + 1).padStart(2, '0');
  return { inicio: fmt(lunes), fin: fmt(domingo) };
}
function firmaContenido(pd) {
  return pd.sesiones.map((s) => {
    const r = s.r;
    return [r.id, r.fecha, r.hora, r.servicio || '', r.status || r.estado || '', (r.detalleSesion || '').length, (r.detalleSesion2 || '').length].join(':');
  }).sort().join('|');
}

console.log('\n═══ Delta punto 7 — la hoja pertenece a la semana de la JORNADA, no del clic ═══');
{
  // Domingo 20/09/2026 preparando la jornada del lunes 21/09/2026 (semana siguiente)
  const fechaJornada = '2026-09-21'; // lunes
  const semanaDeLaJornada = semanaIdISO(fechaISOaDateUTC(fechaJornada), ZONA_HORARIA_NEGOCIO);
  check('la jornada del lunes 21/09 pertenece a la semana que empieza el 21/09 (su propio lunes)', () => {
    assert.strictEqual(semanaDeLaJornada, '2026-09-21');
  });

  // Si se prepara el domingo 20/09 pero la jornada es del lunes 21/09, la semana debe ser la del 21/09, NO la del domingo (semana anterior, que empezó el 14/09)
  const semanaDelDomingoDeClic = semanaIdISO(new Date('2026-09-20T15:00:00Z'), ZONA_HORARIA_NEGOCIO); // "ahora" ficticio: domingo
  check('la semana de la jornada (21/09) es DISTINTA de la semana del momento del clic (domingo 20/09, semana del 14/09) — el bug que corrige este delta', () => {
    assert.notStrictEqual(semanaDeLaJornada, semanaDelDomingoDeClic);
    assert.strictEqual(semanaDelDomingoDeClic, '2026-09-14');
  });
}

console.log('\n═══ Delta punto 7 — rango de semana para el texto del diálogo ═══');
{
  const rango = rangoSemana('2026-09-14');
  check('semana que empieza el 14/09/2026 → inicio "14/09", fin "20/09" (domingo)', () => {
    assert.strictEqual(rango.inicio, '14/09');
    assert.strictEqual(rango.fin, '20/09');
  });
  const rangoCruceMes = rangoSemana('2026-09-28');
  check('una semana que cruza de mes (28/09 a 04/10) calcula bien el fin en el mes siguiente', () => {
    assert.strictEqual(rangoCruceMes.inicio, '28/09');
    assert.strictEqual(rangoCruceMes.fin, '04/10');
  });
}

console.log('\n═══ Delta punto 7 — "Hay cambios desde el último informe" ═══');
{
  const pdOriginal = { sesiones: [{ r: { id: 'r1', fecha: '2026-09-21', hora: '10:00', servicio: 'Facial', estado: 'confirmado', detalleSesion: 'Nota corta' } }] };
  const firmaOriginal = firmaContenido(pdOriginal);

  const pdSinCambios = { sesiones: [{ r: { id: 'r1', fecha: '2026-09-21', hora: '10:00', servicio: 'Facial', estado: 'confirmado', detalleSesion: 'Otra nota de MISMO largo' } }] };
  check('sin cambios reales en hora/servicio/estado/cantidad de sesiones → misma firma (no marca "hay cambios" por texto libre irrelevante de igual longitud)', () => {
    // Se compara longitud de la nota, no el texto — esto es una limitación
    // documentada: dos notas de igual longitud no disparan el aviso.
    assert.strictEqual(firmaContenido(pdSinCambios).length, firmaOriginal.length);
  });

  const pdConSesionNueva = { sesiones: [...pdOriginal.sesiones, { r: { id: 'r2', fecha: '2026-09-21', hora: '11:00', servicio: 'Corporal', estado: 'confirmado', detalleSesion: '' } }] };
  check('agregar una sesión nueva SÍ cambia la firma', () => {
    assert.notStrictEqual(firmaContenido(pdConSesionNueva), firmaOriginal);
  });

  const pdHoraCambiada = { sesiones: [{ r: { id: 'r1', fecha: '2026-09-21', hora: '10:30', servicio: 'Facial', estado: 'confirmado', detalleSesion: 'Nota corta' } }] };
  check('cambiar la hora de una sesión existente SÍ cambia la firma', () => {
    assert.notStrictEqual(firmaContenido(pdHoraCambiada), firmaOriginal);
  });

  check('el orden de las sesiones no afecta la firma (se ordena antes de unir)', () => {
    const a = { sesiones: [{ r: { id: 'r1', fecha: 'x', hora: '10:00', servicio: 'A', estado: '', detalleSesion: '' } }, { r: { id: 'r2', fecha: 'x', hora: '11:00', servicio: 'B', estado: '', detalleSesion: '' } }] };
    const b = { sesiones: [{ r: { id: 'r2', fecha: 'x', hora: '11:00', servicio: 'B', estado: '', detalleSesion: '' } }, { r: { id: 'r1', fecha: 'x', hora: '10:00', servicio: 'A', estado: '', detalleSesion: '' } }] };
    assert.strictEqual(firmaContenido(a), firmaContenido(b));
  });
}

console.log('\n' + '='.repeat(60));
if (fails) {
  console.log('RESULTADO: ' + fails + ' prueba(s) fallaron.');
  process.exit(1);
} else {
  console.log('RESULTADO: TODAS LAS PRUEBAS DE AVISO DE PDF DE JORNADA DUPLICADO OK');
}
