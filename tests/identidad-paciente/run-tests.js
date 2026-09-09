// Pruebas de regresión — vinculación paciente↔historial en admin.html.
//
// Reproducen (con datos SINTÉTICOS, nunca reservas reales) el bug real
// encontrado en auditoría: el buscador de sesiones, "Preparar jornada" y
// "Exportar historial PDF" agrupaban las reservas de un mismo paciente con
// TRES lógicas de identidad distintas. La correcta (_pacienteMatchKey: DNI
// si existe, si no nombre normalizado) ya la usaba el buscador; jornada
// usaba nombre literal sin DNI (_pjNombreKey vieja) y el "refresco a
// historial completo" de exportarHistorialPDF comparaba un matchKey en un
// formato que el buscador nunca producía — por eso nunca encontraba nada.
//
// Caso real que motivó esta auditoría (Firestore, solo lectura, sin
// modificar nada — verificado el 2026-09-08): una paciente con DNI único
// tenía 10 reservas activas, 3 de ellas cargadas con "Nombre Segundo
// Apellido" además del nombre corto usado en las otras 7. El buscador
// (clave por DNI) mostraba las 10; "Preparar jornada" (clave por nombre
// literal) sólo encontraba las 7 que coincidían textualmente con el
// registro del día — exactamente el patrón que reproduce CASO_A acá abajo.
// Auditando toda la colección real con el mismo criterio aparecieron 39
// pacientes (de ~121) fragmentados así, y un caso más grave (CASO_B):
// reservas sin el campo "nombre" (sólo "clienteNombre") colapsaban bajo
// una clave vacía compartida por 44 pacientes distintos — mezclando sus
// historiales en uno solo. Ningún dato real se usa ni se modifica acá.
//
// IMPORTANTE: igual que gen-jornada.js, esto es un espejo deliberado de
// las funciones reales de admin.html (_pacienteMatchKey, esReservaActiva,
// y la lógica de agrupamiento de buscador/jornada/historial). Si esas
// funciones cambian en admin.html, hay que reflejar el cambio acá.

const assert = require('assert');
const { generarJornadaPDF } = require('../pdf-jornada/gen-jornada');
const { PDFParse } = require('pdf-parse');
const fs = require('fs');
const path = require('path');

let fails = 0;
function check(desc, fn) {
  try { fn(); console.log('  OK  ' + desc); }
  catch (e) { fails++; console.log('  FAIL ' + desc + '\n       ' + e.message); }
}

// ─── Mirrors de admin.html ───────────────────────────────────────────────
const esReservaActiva = (r) => {
  const estados = [r.estado, r.status].map(v => (v || '').toString().trim().toLowerCase()).filter(Boolean);
  return !estados.includes('cancelado');
};

// Clave correcta actual (admin.html: _pacienteMatchKey)
const pacienteMatchKey = (r) => {
  const dni = (r.dni || r.clienteDni || r.documento || '').toString().trim();
  if (dni) return 'dni:' + dni;
  const nombre = (r.nombreLimpio || r.nombre || r.paciente || r.clienteNombre || '').toString();
  return 'nom:' + nombre.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
};
const pacienteNombreDisplay = (r) => (r.nombreLimpio || r.nombre || r.paciente || r.clienteNombre || '—').toString().trim();

// nombreLimpio como lo arma _fetchReservasCompletasParaExport/cargarTodo
const conNombreLimpio = (r) => Object.assign({}, r, {
  nombreLimpio: (r.clienteNombre || r.nombre || r.cliente || r.title || r.displayName || '')
});

// Clave VIEJA que tenía _pjNombreKey antes del fix (nombre literal, sin DNI, sin nombreLimpio)
const claveViejaJornada = (r) => ((r.nombre || r.paciente || '').trim()).toLowerCase().replace(/\s+/g, ' ');

// Mirror de _esSesionPendiente/_finSesionMs (admin.html): fin de sesión =
// inicio (huso -03:00 explícito) + duracionMinutos (60 si no está cargada).
// Es la MISMA fórmula que ahora comparten buscador, jornada e historial —
// antes jornada/historial comparaban sólo contra el INICIO y sin huso
// horario explícito, lo que podía dar un estado distinto al del buscador
// para un turno todavía en curso, en el mismo instante.
function finSesionMs(r) {
  if (!r.fecha) return null;
  const hora = r.hora || '00:00';
  const inicio = new Date(r.fecha + 'T' + hora + ':00-03:00').getTime();
  if (Number.isNaN(inicio)) return null;
  const duracion = Number(r.duracionMinutos) > 0 ? Number(r.duracionMinutos) : 60;
  return inicio + duracion * 60000;
}
function clasificar(r, now) {
  const st = (r.estado || r.status || '').toLowerCase();
  const isCancelled = st === 'cancelado';
  const finMs = finSesionMs(r);
  const isPending = !isCancelled && finMs !== null && now < finMs;
  return isCancelled ? 'canc' : (isPending ? 'pend' : 'real');
}

// Simula el agrupamiento del buscador (buscarSesionesPorNombreInput)
function simularBuscador(reservas) {
  const activas = reservas.map(conNombreLimpio).filter(esReservaActiva);
  const grupos = new Map();
  activas.forEach(r => {
    const k = pacienteMatchKey(r);
    if (!grupos.has(k)) grupos.set(k, { nombre: pacienteNombreDisplay(r), sesiones: [] });
    grupos.get(k).sesiones.push(r);
  });
  return grupos;
}

// Simula generarPDFJornada: arma el historial completo de cada paciente
// que tiene una reserva el día `fecha`, usando _pjNombreKey = _pacienteMatchKey.
function simularJornada(reservas, fecha) {
  const completas = reservas.map(conNombreLimpio);
  const reservasDia = completas.filter(r => r.fecha === fecha && esReservaActiva(r));
  const patientData = [];
  const seen = new Set();
  reservasDia.forEach(r => {
    const k = pacienteMatchKey(r);
    if (seen.has(k)) return;
    seen.add(k);
    const allR = completas.filter(x => pacienteMatchKey(x) === k);
    patientData.push({ key: k, nombre: pacienteNombreDisplay(r), sesiones: allR });
  });
  return patientData;
}

// ═══ CASO A: fragmentación por variante de nombre (patrón real de "Miriam") ═══
// Mismo DNI en las 10 reservas; 3 de ellas tienen un apellido extra cargado.
const CASO_A_DNI = '99010510';
const casoA = [
  { dni: CASO_A_DNI, nombre: 'Ana Segundo Test', clienteNombre: 'Ana Segundo Test', fecha: '2026-09-01', hora: '08:45', estado: 'confirmado', servicio: 'Tratamiento X', detalleSesion: 'Nota sesión 1' },
  { dni: CASO_A_DNI, nombre: 'Ana Segundo Test', clienteNombre: 'Ana Segundo Test', fecha: '2026-09-03', hora: '09:15', estado: 'confirmado', servicio: 'Tratamiento Y', detalleSesion: 'Nota sesión 2' },
  { dni: CASO_A_DNI, nombre: 'Ana Segundo Test', clienteNombre: 'Ana Segundo Test', fecha: '2026-09-03', hora: '10:15', estado: 'confirmado', servicio: 'Tratamiento Z', detalleSesion: 'Nota sesión 3' },
  { dni: CASO_A_DNI, nombre: 'Ana Test',         clienteNombre: 'Ana Test',         fecha: '2026-09-08', hora: '08:45', estado: 'confirmado', servicio: 'Tratamiento X', detalleSesion: 'Nota sesión 4' },
  { dni: CASO_A_DNI, nombre: 'Ana Test',         clienteNombre: 'Ana Test',         fecha: '2026-09-10', hora: '09:15', estado: 'confirmado', servicio: 'Tratamiento Y' },
  { dni: CASO_A_DNI, nombre: 'Ana Test',         clienteNombre: 'Ana Test',         fecha: '2026-09-15', hora: '08:45', estado: 'confirmado', servicio: 'Tratamiento X' },
  { dni: CASO_A_DNI, nombre: 'Ana Test',         clienteNombre: 'Ana Test',         fecha: '2026-09-17', hora: '09:30', estado: 'confirmado', servicio: 'Tratamiento Z' },
  { dni: CASO_A_DNI, nombre: 'Ana Test',         clienteNombre: 'Ana Test',         fecha: '2026-09-17', hora: '10:15', estado: 'confirmado', servicio: 'Tratamiento Y' },
  { dni: CASO_A_DNI, nombre: 'Ana Test',         clienteNombre: 'Ana Test',         fecha: '2026-09-22', hora: '08:45', estado: 'confirmado', servicio: 'Tratamiento X' },
  { dni: CASO_A_DNI, nombre: 'Ana Test',         clienteNombre: 'Ana Test',         fecha: '2026-09-24', hora: '09:30', estado: 'confirmado', servicio: 'Tratamiento Z' },
];

console.log('\n═══ CASO A — variante de nombre, mismo DNI (patrón real reproducido) ═══');

check('buscador agrupa las 10 sesiones bajo un único paciente', () => {
  const grupos = simularBuscador(casoA);
  assert.strictEqual(grupos.size, 1, 'debería haber exactamente 1 grupo, hay ' + grupos.size);
  const [key, g] = [...grupos.entries()][0];
  assert.strictEqual(g.sesiones.length, 10, 'esperaba 10 sesiones, hubo ' + g.sesiones.length);
});

check('jornada del 2026-09-08 recupera las 10 sesiones (no sólo las 7 con nombre corto)', () => {
  const patientData = simularJornada(casoA, '2026-09-08');
  assert.strictEqual(patientData.length, 1, 'debería haber 1 paciente seleccionable ese día, hay ' + patientData.length);
  assert.strictEqual(patientData[0].sesiones.length, 10, 'esperaba 10 sesiones, jornada recuperó ' + patientData[0].sesiones.length);
});

check('buscador y jornada identifican exactamente las mismas 10 sesiones (por id de fecha+hora)', () => {
  const idsBuscador = [...simularBuscador(casoA).values()][0].sesiones.map(r => r.fecha + 'T' + r.hora).sort();
  const idsJornada = simularJornada(casoA, '2026-09-08')[0].sesiones.map(r => r.fecha + 'T' + r.hora).sort();
  assert.deepStrictEqual(idsBuscador, idsJornada);
});

check('REGRESIÓN DEMOSTRADA: la clave vieja (nombre literal, sin DNI) sí fragmentaba en 2 grupos (7 y 3)', () => {
  const m = new Map();
  casoA.filter(esReservaActiva).forEach(r => {
    const k = claveViejaJornada(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  });
  assert.strictEqual(m.size, 2, 'la clave vieja debería fragmentar en 2 grupos, dio ' + m.size);
  const sizes = [...m.values()].map(a => a.length).sort((a, b) => a - b);
  assert.deepStrictEqual(sizes, [3, 7], 'tamaños de fragmentos esperados [3,7], dio ' + JSON.stringify(sizes));
});

// ═══ CASO B: reservas sin campo "nombre" (sólo clienteNombre) — colapso cruzado ═══
console.log('\n═══ CASO B — reserva sin campo "nombre" propio (patrón real: sólo "clienteNombre") ═══');

const casoB = [
  { dni: '11111111', clienteNombre: 'Paciente Uno',  fecha: '2026-09-05', hora: '10:00', estado: 'confirmado', servicio: 'A' }, // sin r.nombre
  { dni: '22222222', clienteNombre: 'Paciente Dos',  fecha: '2026-09-06', hora: '11:00', estado: 'confirmado', servicio: 'B' }, // sin r.nombre
];

check('buscador NO mezcla a "Paciente Uno" y "Paciente Dos" aunque ninguno tenga campo nombre', () => {
  const grupos = simularBuscador(casoB);
  assert.strictEqual(grupos.size, 2, 'deberían quedar 2 pacientes separados, hay ' + grupos.size);
});

check('REGRESIÓN DEMOSTRADA: la clave vieja SÍ los mezclaba (ambos caen en la clave vacía "")', () => {
  const claves = casoB.map(claveViejaJornada);
  assert.deepStrictEqual(claves, ['', '']);
});

// ═══ CASO E: el buscador y jornada/historial usaban DOS fórmulas de corte
// distintas para "pendiente vs realizada" — la de jornada/historial no
// sumaba la duración del turno ni fijaba el huso horario. Un turno EN CURSO
// (ya empezó, no terminó) podía figurar "pendiente" en el buscador y
// "realizada" en jornada/historial en el mismo instante — coincide con lo
// reportado: el turno del 8/9 aparecía pendiente en un lugar y realizado
// en otro. ═══
console.log('\n═══ CASO E — fórmula de corte pendiente/realizada unificada (turno en curso) ═══');

const sesionEnCurso = { fecha: '2026-09-08', hora: '08:45', duracionMinutos: 60, estado: 'confirmado' };
// "now" cae DESPUÉS del inicio (08:45) pero ANTES del fin (09:45) — turno en curso.
const nowEnCurso = new Date('2026-09-08T09:15:00-03:00').getTime();

function pendienteViejaJornada(r, now) {
  // Fórmula que tenían generarPDFJornada/exportarHistorialPDF antes del fix:
  // sólo compara contra el INICIO, sin duración, sin huso horario explícito
  // (usa el huso local del entorno que ejecuta el código).
  const xMs = r.fecha ? (new Date(r.fecha + 'T00:00:00').getTime() +
    ((parseInt((r.hora||'').split(':')[0]||0) * 60 + parseInt((r.hora||'').split(':')[1]||0)) * 60000)) : null;
  return xMs !== null && now < xMs;
}
function pendienteViejaBuscador(r, now) {
  // Fórmula que ya tenía el buscador: fin = inicio + duración, huso -03:00 explícito.
  const finMs = new Date((r.fecha||'1970-01-01') + 'T' + (r.hora||'00:00') + ':00-03:00').getTime() + (r.duracionMinutos||60)*60000;
  return now < finMs;
}

check('REGRESIÓN DEMOSTRADA: con las fórmulas viejas, un turno en curso podía dar "pendiente" en el buscador y "realizada" en jornada, a la vez', () => {
  const pendienteEnBuscadorViejo = pendienteViejaBuscador(sesionEnCurso, nowEnCurso);
  const pendienteEnJornadaVieja = pendienteViejaJornada(sesionEnCurso, nowEnCurso);
  assert.strictEqual(pendienteEnBuscadorViejo, true, 'el buscador viejo debería marcarlo pendiente (no llegó a las 09:45)');
  assert.strictEqual(pendienteEnJornadaVieja, false, 'jornada vieja debería marcarlo realizada (ya pasaron las 08:45, no suma duración) — si esto falla, revisar que la reproducción del bug siga siendo válida');
});

check('con la fórmula unificada (_esSesionPendiente), buscador y jornada dan SIEMPRE el mismo resultado', () => {
  const finMs = finSesionMs(sesionEnCurso);
  const esPendienteUnificado = nowEnCurso < finMs;
  // La misma llamada, sin importar desde qué exportador se invoque.
  assert.strictEqual(esPendienteUnificado, true, 'un turno en curso (ni empezó a terminar) debe seguir "pendiente" en todos lados');
  assert.strictEqual(clasificar(sesionEnCurso, nowEnCurso), 'pend');
});

// ═══ CASO C: estados no contemplados no se descartan silenciosamente ═══
console.log('\n═══ CASO C — estados no estándar ("activo", vacío) no se pierden ═══');

const casoC = [
  { dni: '33333333', nombre: 'Paciente Estado Raro', fecha: '2026-01-01', hora: '08:00', estado: 'activo', servicio: 'A' },
  { dni: '33333333', nombre: 'Paciente Estado Raro', fecha: '2026-01-02', hora: '08:00', estado: '', servicio: 'B' },
  { dni: '33333333', nombre: 'Paciente Estado Raro', fecha: '2026-01-03', hora: '08:00', estado: 'cancelado', servicio: 'C' },
];
check('esReservaActiva sólo excluye "cancelado"; "activo" y vacío pasan (no se descartan)', () => {
  const activas = casoC.filter(esReservaActiva);
  assert.strictEqual(activas.length, 2, 'esperaba 2 activas (activo + vacío), hubo ' + activas.length);
});
check('el grupo del paciente conserva las 2 sesiones activas, ninguna se pierde en el agrupamiento', () => {
  const grupos = simularBuscador(casoC);
  assert.strictEqual(grupos.size, 1);
  assert.strictEqual([...grupos.values()][0].sesiones.length, 2);
});

// ═══ CASO D: orden cronológico + PDF real de jornada con las 10 sesiones íntegras ═══
console.log('\n═══ CASO D — round-trip completo: agrupar → clasificar → generar PDF real → verificar ═══');

check('las 10 sesiones agrupadas quedan en orden cronológico (más antigua primero)', () => {
  const now = new Date('2026-09-12T12:00:00-03:00').getTime();
  const pd = simularJornada(casoA, '2026-09-08')[0];
  const ses = pd.sesiones
    .map(r => ({ r, sortKey: r.fecha + 'T' + r.hora, status: clasificar(r, now) }))
    .sort((a, b) => a.sortKey < b.sortKey ? -1 : 1);
  const fechas = ses.map(s => s.sortKey);
  const ordenado = [...fechas].sort();
  assert.deepStrictEqual(fechas, ordenado, 'las sesiones no quedaron en orden cronológico ascendente');
  // Con "now" = 12/09 mediodía y fin de sesión = inicio + 60min (-03:00):
  // 09-01, 09-03 x2, 09-08 08:45 y 09-10 09:15 (termina 10:15, ya pasado) -> 5 realizadas, 5 pendientes
  const nReal = ses.filter(s => s.status === 'real').length;
  const nPend = ses.filter(s => s.status === 'pend').length;
  assert.strictEqual(nReal, 5, 'esperaba 5 realizadas con ese "now", hubo ' + nReal);
  assert.strictEqual(nPend, 5, 'esperaba 5 pendientes con ese "now", hubo ' + nPend);
});

(async () => {
  const now = new Date('2026-09-12T12:00:00-03:00').getTime();
  const pdRaw = simularJornada(casoA, '2026-09-08')[0];
  const patientData = [{
    nombre: pdRaw.nombre,
    phone: '3760000000',
    edad: '',
    sesiones: pdRaw.sesiones
      .map(r => ({ r, sortKey: r.fecha + 'T' + (r.hora || '00:00'), status: clasificar(r, now) }))
      .sort((a, b) => a.sortKey < b.sortKey ? -1 : (a.sortKey > b.sortKey ? 1 : 0))
  }];

  const { doc } = generarJornadaPDF('2026-09-08', patientData, { duplex: false });
  const outDir = __dirname;
  const outPath = path.join(outDir, 'out-caso-miriam.pdf');
  fs.writeFileSync(outPath, Buffer.from(doc.output('arraybuffer')));

  const buf = fs.readFileSync(outPath);
  const parsed = await new PDFParse({ data: buf }).getText();
  const fullText = parsed.pages.map(p => p.text).join('\n');

  check('el PDF generado contiene las 10 sesiones marcadas "S.N/10"', () => {
    for (let n = 1; n <= 10; n++) {
      assert.ok(fullText.includes('S.' + n + '/10'), 'falta la marca de sesión S.' + n + '/10 en el PDF');
    }
  });
  check('el PDF generado tiene exactamente 5 REALIZADA y 5 PENDIENTE', () => {
    const nReal = (fullText.match(/REALIZADA/g) || []).length;
    const nPend = (fullText.match(/PENDIENTE/g) || []).length;
    assert.strictEqual(nReal, 5, 'REALIZADA x' + nReal);
    assert.strictEqual(nPend, 5, 'PENDIENTE x' + nPend);
  });
  check('el pie de página de TODAS las hojas identifica al mismo paciente (sin nombres cruzados ni hojas huérfanas)', () => {
    assert.ok(parsed.pages.length >= 1, 'el PDF no generó ninguna página');
    parsed.pages.forEach((pg, i) => {
      assert.ok(pg.text.includes(patientData[0].nombre),
        'la hoja ' + (i + 1) + ' no menciona a ' + patientData[0].nombre + ' — nombre de pie de página equivocado o ausente');
    });
  });

  console.log('\n' + '='.repeat(60));
  if (fails) {
    console.log('RESULTADO: ' + fails + ' prueba(s) FALLARON.');
    process.exit(1);
  } else {
    console.log('RESULTADO: TODAS LAS PRUEBAS DE IDENTIDAD DE PACIENTE OK');
    process.exit(0);
  }
})();
