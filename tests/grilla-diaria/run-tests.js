const fs = require('fs');
const path = require('path');
const { generarGrillaPDF } = require('./gen-grilla');
const { PDFParse } = require('pdf-parse');

const BOXES = [
  { id: 'b1', title: 'Box 1', sub: 'General Corporal' },
  { id: 'b2', title: 'Box 2', sub: 'Corporal' },
  { id: 'b3', title: 'Box 3', sub: 'Facial' },
  { id: 'b4', title: 'Box 4', sub: 'Relax Corporal' },
];

function mkR(fecha, hora, nombre, servicio, boxId) {
  return { fecha, hora, nombre, servicio, boxId, estado: 'confirmado' };
}

let fails = 0;
async function check(desc, fn) {
  try { await fn(); console.log('  OK  ' + desc); }
  catch (e) { fails++; console.log('  FAIL ' + desc + '\n       ' + e.message); }
}

async function saveAndParse(name, doc) {
  const outPath = path.join(__dirname, 'out-' + name + '.pdf');
  fs.writeFileSync(outPath, Buffer.from(doc.output('arraybuffer')));
  const buf = fs.readFileSync(outPath);
  const parsed = await new PDFParse({ data: buf }).getText();
  return { outPath, pages: parsed.pages };
}

(async () => {

// ── Caso 1: solo turno mañana → 1 página ──
console.log('\n=== Caso: solo-mañana ===');
{
  const reservas = [
    mkR('2026-09-08', '08:00', 'Ana Pérez', 'Depilación láser piernas', 'b1'),
    mkR('2026-09-08', '09:30', 'Beatriz Gómez', 'Limpieza facial profunda', 'b2'),
    mkR('2026-09-08', '11:00', 'Carla Ruiz', 'Presoterapia', 'b3'),
  ];
  const result = generarGrillaPDF('2026-09-08', reservas, BOXES);
  await check('exactamente 1 página', () => { if (result.totalPages !== 1) throw new Error('páginas=' + result.totalPages); });
  const { pages } = await saveAndParse('solo-manana', result.doc);
  await check('no contiene "Turno Tarde"', () => { if (pages[0].text.includes('Turno Tarde')) throw new Error('apareció Turno Tarde'); });
  await check('los 3 nombres están presentes', () => {
    ['Ana Pérez', 'Beatriz Gómez', 'Carla Ruiz'].forEach(n => {
      if (!pages[0].text.includes(n)) throw new Error('falta ' + n);
    });
  });
}

// ── Caso 2: solo turno tarde → 1 página ──
console.log('\n=== Caso: solo-tarde ===');
{
  const reservas = [
    mkR('2026-09-08', '14:00', 'Daniela Sosa', 'Masaje descontracturante', 'b1'),
    mkR('2026-09-08', '16:30', 'Elena Torres', 'Radiofrecuencia facial', 'b4'),
  ];
  const result = generarGrillaPDF('2026-09-08', reservas, BOXES);
  await check('exactamente 1 página', () => { if (result.totalPages !== 1) throw new Error('páginas=' + result.totalPages); });
  const { pages } = await saveAndParse('solo-tarde', result.doc);
  await check('no contiene "Turno Mañana"', () => { if (pages[0].text.includes('Turno Mañana')) throw new Error('apareció Turno Mañana'); });
  await check('ambos nombres están presentes', () => {
    ['Daniela Sosa', 'Elena Torres'].forEach(n => { if (!pages[0].text.includes(n)) throw new Error('falta ' + n); });
  });
}

// ── Caso 3: mañana y tarde → exactamente 2 páginas, mañana primero ──
console.log('\n=== Caso: ambos-turnos ===');
{
  const reservas = [
    mkR('2026-09-08', '08:30', 'Fabiana Molina', 'Depilación láser axilas', 'b1'),
    mkR('2026-09-08', '10:00', 'Gabriela Núñez', 'Peeling químico', 'b2'),
    mkR('2026-09-08', '15:00', 'Hilda Acosta', 'Drenaje linfático', 'b3'),
    mkR('2026-09-08', '18:30', 'Irene Duarte', 'Consulta inicial', 'b4'),
  ];
  const result = generarGrillaPDF('2026-09-08', reservas, BOXES);
  await check('exactamente 2 páginas', () => { if (result.totalPages !== 2) throw new Error('páginas=' + result.totalPages); });
  const { pages } = await saveAndParse('ambos-turnos', result.doc);
  await check('página 1 es Turno Mañana, no Tarde', () => {
    if (!pages[0].text.includes('Turno Mañana')) throw new Error('página 1 no dice Turno Mañana');
    if (pages[0].text.includes('Turno Tarde')) throw new Error('página 1 contiene Turno Tarde');
  });
  await check('página 2 es Turno Tarde, no Mañana', () => {
    if (!pages[1].text.includes('Turno Tarde')) throw new Error('página 2 no dice Turno Tarde');
    if (pages[1].text.includes('Turno Mañana')) throw new Error('página 2 contiene Turno Mañana');
  });
  await check('nombres de mañana solo en página 1', () => {
    if (!pages[0].text.includes('Fabiana Molina') || !pages[0].text.includes('Gabriela Núñez')) throw new Error('faltan en pág 1');
    if (pages[1].text.includes('Fabiana Molina') || pages[1].text.includes('Gabriela Núñez')) throw new Error('aparecen en pág 2 (duplicado)');
  });
  await check('nombres de tarde solo en página 2', () => {
    if (!pages[1].text.includes('Hilda Acosta') || !pages[1].text.includes('Irene Duarte')) throw new Error('faltan en pág 2');
    if (pages[0].text.includes('Hilda Acosta') || pages[0].text.includes('Irene Duarte')) throw new Error('aparecen en pág 1 (duplicado)');
  });
}

// ── Caso 4: una sola reserva en todo el día → 1 página, sin fila gigante ──
console.log('\n=== Caso: una-reserva ===');
{
  const reservas = [mkR('2026-09-08', '09:00', 'Julia Fernández', 'Consulta inicial', 'b1')];
  const result = generarGrillaPDF('2026-09-08', reservas, BOXES);
  await check('exactamente 1 página', () => { if (result.totalPages !== 1) throw new Error('páginas=' + result.totalPages); });
  const { pages } = await saveAndParse('una-reserva', result.doc);
  await check('el nombre está presente', () => { if (!pages[0].text.includes('Julia Fernández')) throw new Error('falta el nombre'); });
}

// ── Caso 5: agenda completa (muchos horarios, ambos turnos) → 2 páginas, sin cortes ──
console.log('\n=== Caso: agenda-completa ===');
{
  const reservas = [];
  const nombres = ['Karina López','Laura Méndez','Mónica Ibáñez','Noelia Cabrera','Ofelia Ramírez',
    'Patricia Silva','Quimey Roldán','Rocío Benítez','Sabrina Ortiz','Tamara Vega',
    'Ursula Castro','Valeria Núñez','Wanda Ferreyra','Ximena Godoy','Yolanda Paz','Zulema Rojas'];
  let idx = 0;
  const horasManana = ['08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30'];
  const horasTarde  = ['14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30','18:00','18:30'];
  // Todos los horarios de AMBOS turnos con sus 4 boxes completos — el caso
  // "agenda llena" real, no solo mañana como quedaba con un límite global de idx.
  horasManana.concat(horasTarde).forEach(h => {
    BOXES.forEach(b => {
      reservas.push(mkR('2026-09-08', h, nombres[idx % nombres.length] + ' ' + (idx + 1), 'Tratamiento estético completo con seguimiento', b.id));
      idx++;
    });
  });
  const result = generarGrillaPDF('2026-09-08', reservas, BOXES);
  await check('exactamente 2 páginas', () => { if (result.totalPages !== 2) throw new Error('páginas=' + result.totalPages); });
  const { pages } = await saveAndParse('agenda-completa', result.doc);
  const fullText = pages.map(p => p.text).join('\n');
  await check('todas las reservas están presentes (sin cortes)', () => {
    const faltantes = reservas.filter(r => !fullText.includes(r.nombre));
    if (faltantes.length) throw new Error(faltantes.length + ' nombre(s) faltantes, ej: ' + faltantes[0].nombre);
  });
}

// ── Caso 6: nombres largos → sin truncar, sin puntos suspensivos ──
console.log('\n=== Caso: nombres-largos ===');
{
  const reservas = [
    mkR('2026-09-08', '09:00', 'María Alejandra Fernández Rodríguez de la Torre y Gómez Núñez', 'Depilación láser cuerpo completo con seguimiento post-sesión', 'b1'),
    mkR('2026-09-08', '10:00', 'José María Muñoz Ñoño Etchegaray', 'Tratamiento corporal reductor con radiofrecuencia', 'b2'),
  ];
  const result = generarGrillaPDF('2026-09-08', reservas, BOXES);
  await check('exactamente 1 página', () => { if (result.totalPages !== 1) throw new Error('páginas=' + result.totalPages); });
  const { pages } = await saveAndParse('nombres-largos', result.doc);
  await check('nombres completos sin truncar ni "..."', () => {
    if (!pages[0].text.includes('María Alejandra Fernández Rodríguez de la Torre y Gómez Núñez'.replace(/\s+/g,' ')) &&
        !pages[0].text.replace(/\s+/g,' ').includes('María Alejandra Fernández Rodríguez de la Torre y Gómez Núñez')) {
      throw new Error('nombre largo no aparece completo');
    }
    if (pages[0].text.includes('…') || /\.\.\.[^\d]/.test(pages[0].text)) throw new Error('aparecen puntos suspensivos');
  });
}

// ── Caso 7: reserva sin box asignado se muestra una sola vez ──
console.log('\n=== Caso: sin-box-asignado ===');
{
  const reservas = [
    mkR('2026-09-08', '09:00', 'Paciente Con Box', 'Tratamiento', 'b1'),
    { fecha: '2026-09-08', hora: '10:00', nombre: 'Paciente Sin Box', servicio: 'Tratamiento', boxId: '', estado: 'confirmado' },
  ];
  const result = generarGrillaPDF('2026-09-08', reservas, BOXES);
  const { pages } = await saveAndParse('sin-box', result.doc);
  await check('la reserva sin box aparece igual (no se pierde)', () => {
    if (!pages[0].text.includes('Paciente Sin Box')) throw new Error('no aparece la reserva sin box');
  });
}

console.log('\n' + '='.repeat(60));
if (fails) { console.log('RESULTADO: ' + fails + ' prueba(s) FALLARON.'); process.exit(1); }
console.log('RESULTADO: TODOS LOS CASOS DE GRILLA DIARIA OK');
})();
