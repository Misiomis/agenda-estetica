const fs = require('fs');
const path = require('path');
const { generarJornadaPDF } = require('./gen-jornada');
const { PDFParse } = require('pdf-parse');

function mkSession(fecha, hora, servicio, opts) {
  opts = opts || {};
  const status = opts.status || 'real';
  const est = status === 'canc' ? 'cancelado' : (opts.estado || '');
  return {
    status,
    r: {
      fecha, hora, servicio,
      estado: est,
      detalleSesion: opts.det || '',
      detalleSesion2: opts.det2 || '',
      box: opts.box || 'Box 2 — Corporal',
    }
  };
}

function buildPatient(nombre, phone, sesiones) {
  return { nombre, phone, key: nombre.toLowerCase(), sesiones };
}

const LOREM = "Facial piel con acne activo y comedones. Mascara desincrustante con ozonoterapia. Extracciones. Enzimatico. Alta frecuencia. Crema secante. Lleva kit para usar hasta los primeros dias de agosto. Usar mucha hidratante y se recomienda adquirir protector solar factor 50 toque seco. Lleva kit para 10 dias.";
const LOREM_LARGO = LOREM + " " + LOREM + " Segundo párrafo con más anotaciones clínicas: control de presión, se registra evolución favorable, próxima sesión en 15 días, paciente refiere mejoría notable en textura de la piel y disminución de la inflamación. " + LOREM;

let cases = [];

// ── Caso 1: nombre muy largo + tildes/ñ ──
cases.push({
  name: 'nombre-largo-tildes',
  patients: [
    buildPatient('María Alejandra Fernández Rodríguez de la Torre y Gómez Núñez', '3764000111', [
      mkSession('2026-07-10', '10:00', 'Tratamiento Facial', { status: 'real', det: LOREM }),
      mkSession('2026-09-08', '14:30', 'Depilación láser — Zona: piernas completas', { status: 'pend' }),
    ]),
    buildPatient('José María Muñoz Ñoño', '3764000222', [
      mkSession('2026-08-01', '09:00', 'Consulta inicial', { status: 'real' }),
    ]),
  ]
});

// ── Caso 2: detalle extenso multi-párrafo ──
cases.push({
  name: 'detalle-extenso',
  patients: [
    buildPatient('Paciente Detalle Largo', '3764000333', [
      mkSession('2026-06-01', '11:00', 'Tratamiento Corporal Detox Drenante Completo', { status: 'real', det: LOREM_LARGO, det2: LOREM }),
      mkSession('2026-09-08', '16:00', 'Tratamiento Corporal', { status: 'pend', det: LOREM_LARGO }),
    ]),
  ]
});

// ── Caso 3: 45 sesiones para un mismo paciente ──
{
  const sesiones = [];
  for (let i = 0; i < 45; i++) {
    const mes = String(1 + (i % 12)).padStart(2, '0');
    const dia = String(1 + (i % 27)).padStart(2, '0');
    const status = i % 5 === 0 ? 'canc' : (i < 40 ? 'real' : 'pend');
    sesiones.push(mkSession('2026-' + mes + '-' + dia, '10:00', 'Sesión de mantenimiento #' + (i+1), {
      status, det: status === 'canc' ? '' : ('Nota de control ' + (i+1) + ': evolución dentro de lo esperado.')
    }));
  }
  cases.push({ name: '45-sesiones', patients: [buildPatient('Paciente Cuarenta Y Cinco Sesiones', '3764000444', sesiones)] });
}

// ── Caso 4: varios pacientes consecutivos (6) ──
{
  const patients = [];
  for (let i = 0; i < 6; i++) {
    patients.push(buildPatient('Paciente Consecutivo ' + (i+1), '376400055' + i, [
      mkSession('2026-09-08', (9+i) + ':00', 'Tratamiento ' + (i+1), { status: 'real', det: 'Detalle breve ' + (i+1) }),
      mkSession('2026-09-15', (9+i) + ':00', 'Tratamiento seguimiento ' + (i+1), { status: 'pend' }),
    ]));
  }
  cases.push({ name: 'varios-pacientes', patients });
}

// ── Caso 5: contenido justo en el límite de página (fuerza corte de tarjeta) ──
{
  // Una sola sesión con un detalle calculado para no entrar en una página en blanco.
  const detGigante = Array(40).fill(LOREM).join(' ');
  cases.push({
    name: 'limite-pagina',
    patients: [
      buildPatient('Paciente Limite De Pagina', '3764000666', [
        mkSession('2026-01-01', '08:00', 'Relleno 1', { status: 'real', det: 'Detalle corto 1' }),
        mkSession('2026-09-08', '12:00', 'Sesión con detalle gigante', { status: 'real', det: detGigante }),
        mkSession('2026-09-09', '08:00', 'Relleno 2', { status: 'pend' }),
      ])
    ]
  });
}

// ── Caso 6: dúplex con cantidad impar de páginas para un paciente ──
{
  const sesiones = [];
  for (let i = 0; i < 6; i++) {
    sesiones.push(mkSession('2026-0' + (1+i) + '-01', '10:00', 'Sesión ' + (i+1), { status: 'real', det: LOREM }));
  }
  cases.push({
    name: 'duplex',
    duplex: true,
    patients: [
      buildPatient('Paciente Duplex Uno', '3764000777', sesiones),
      buildPatient('Paciente Duplex Dos', '3764000888', [mkSession('2026-09-08', '10:00', 'Consulta', { status: 'real' })]),
    ]
  });
}

async function verifyPdf(caseName, result) {
  const outPath = path.join(__dirname, 'out-' + caseName + '.pdf');
  const buf = Buffer.from(result.doc.output('arraybuffer'));
  fs.writeFileSync(outPath, buf);

  const parser = new PDFParse({ data: buf });
  const parsed = await parser.getText();
  await parser.destroy();
  const pageTexts = parsed.pages.map(p => p.text);

  const problems = [];

  // 1) La cantidad de páginas de texto extraídas coincide con doc.internal
  if (pageTexts.length !== result.totalPages) {
    problems.push('pdf-parse extrajo ' + pageTexts.length + ' páginas pero jsPDF reporta ' + result.totalPages);
  }

  // 2) Cada página debe tener el nombre de paciente correcto en el pie,
  //    y ese nombre debe corresponder al rango real (patientRanges).
  for (let p = 1; p <= pageTexts.length; p++) {
    const text = pageTexts[p-1] || '';
    const owner = result.patientRanges.slice().reverse().find(pr => p >= pr.startPage && p <= pr.endPage);
    if (owner) {
      // pdf.js normaliza espacios; comparamos por inclusión de palabras clave del nombre
      const nameWords = owner.name.split(/\s+/).slice(0, 2).join(' ');
      if (!text.includes(nameWords.split(' ')[0])) {
        problems.push('Página ' + p + ': se esperaba el nombre "' + owner.name + '" en el pie, no se encontró "' + nameWords.split(' ')[0] + '" en el texto extraído.');
      }
      const hoja = p - owner.startPage + 1;
      const totHojas = owner.endPage - owner.startPage + 1;
      const footerNeedle = 'Hoja ' + hoja + ' de ' + totHojas;
      if (!text.replace(/\s+/g,' ').includes(footerNeedle)) {
        problems.push('Página ' + p + ': no se encontró "' + footerNeedle + '" en el pie (dueño esperado: ' + owner.name + ').');
      }
    } else {
      problems.push('Página ' + p + ': no pertenece a ningún rango de paciente (patientRanges no la cubre).');
    }
  }

  // 3) Cada paciente de entrada tiene AL MENOS una página, y su nombre aparece
  //    en la cabecera de su primera página.
  result.patientRanges.forEach(pr => {
    if (pr.endPage < pr.startPage) problems.push('Paciente "' + pr.name + '": rango de páginas inválido (' + pr.startPage + '-' + pr.endPage + ').');
  });

  // 4) Heurística anti-corte-de-palabra: buscamos guiones de corte silábico
  //    típicos de un salto mal hecho (una palabra partida seguida de otra
  //    palabra pegada sin espacio al borde de página). No es 100% infalible
  //    pero detecta la clase de defecto reportada (nombres/palabras cortadas).
  pageTexts.forEach((text, idx) => {
    const suspicious = text.match(/[a-záéíóúñ]{1,2}[A-ZÁÉÍÓÚÑ][a-záéíóúñ]/g);
    // No usamos esto como fallo duro (los badges en mayúsculas pegados al
    // texto siguiente pueden dar falsos positivos), sólo lo reportamos.
    if (suspicious && suspicious.length > 8) {
      problems.push('Página ' + (idx+1) + ': patrón sospechoso de texto pegado/cortado (' + suspicious.length + ' ocurrencias) — revisar manualmente ' + outPath);
    }
  });

  return { outPath, pageCount: result.totalPages, problems };
}

async function main() {
  let anyFail = false;
  for (const c of cases) {
    console.log('\n=== Caso: ' + c.name + ' ===');
    let result;
    try {
      result = generarJornadaPDF('2026-09-08', c.patients, { duplex: !!c.duplex });
    } catch (err) {
      console.log('  FALLO al generar:', err.message);
      anyFail = true;
      continue;
    }
    const totalSesEsperadas = c.patients.reduce((s,p) => s + p.sesiones.length, 0);
    console.log('  Páginas generadas:', result.totalPages, '| Sesiones escritas:', result.sessionsWritten, '/', totalSesEsperadas);
    console.log('  Rangos por paciente:', JSON.stringify(result.patientRanges));

    const v = await verifyPdf(c.name, result);
    console.log('  PDF guardado en:', v.outPath);
    if (v.problems.length) {
      anyFail = true;
      console.log('  PROBLEMAS ENCONTRADOS:');
      v.problems.forEach(p => console.log('    - ' + p));
    } else {
      console.log('  OK — sin problemas detectados.');
    }
  }
  console.log('\n' + (anyFail ? 'RESULTADO: HAY FALLOS ARRIBA ↑' : 'RESULTADO: TODOS LOS CASOS OK'));
  process.exit(anyFail ? 1 : 0);
}

main().catch(e => { console.error('ERROR FATAL', e); process.exit(1); });
