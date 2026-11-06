// node tests/buscador-avanzado/run-tests.js   (datos 100% sintéticos)
import { calcularBusqueda, tituloBusqueda, enPeriodo, agruparDuplicados, claveNombre, claveTelefono } from '../../js/buscador-avanzado.js';

let fails = 0;
const check = (desc, cond, extra) => { console.log((cond ? '  OK  ' : '  FAIL ') + desc); if (!cond) { fails++; if (extra !== undefined) console.log('       →', JSON.stringify(extra)); } };

const HOY = '2026-11-06';
const R = (id, dni, fecha, servicio, extra = {}) => ({ id, dni, nombreLimpio: 'P' + dni, fecha, hora: '10:00', servicio, ...extra });
const reservas = [
  // A: solo Depilación, empezó en septiembre
  R('a1', '1', '2026-09-05', 'Depilación'), R('a2', '1', '2026-10-05', 'Depilación'), R('a3', '1', '2026-11-02', 'Depilación'),
  // B: Consulta Inicial en noviembre (alta) y después Hi-Fu
  R('b1', '2', '2026-11-01', 'Consulta Inicial'), R('b2', '2', '2026-11-04', 'Hi-Fu Facial'),
  // C: Depilación + Jornada Doc (no exclusiva de Depilación)
  R('c1', '3', '2026-08-10', 'Jornada Doc'), R('c2', '3', '2026-10-20', 'Depilación'),
  // D: solo Jornada Doc, alta en octubre; un turno futuro
  R('d1', '4', '2026-10-15', 'Jornada Doc'), R('d2', '4', '2026-11-20', 'Jornada Doc'),
];
const base = { reservas, claveDe: (r) => 'dni:' + r.dni, hoy: HOY, estadoDe: (k) => (k === 'dni:3' ? 'inactivo' : 'activo'),
  precioDe: (r) => (r.servicio === 'Depilación' ? 20 : null) };
const per = (desde, hasta) => ({ desde, hasta });

console.log('\n=== Período ===');
check('meses manda sobre el rango', enPeriodo('2026-10-03', { meses: ['2026-10'], desde: '2026-11-01' }));
check('rango inclusivo', enPeriodo('2026-11-06', { desde: '2026-11-01', hasta: '2026-11-06' }) && !enPeriodo('2026-11-07', { desde: '2026-11-01', hasta: '2026-11-06' }));

console.log('\n=== Realizó el servicio ===');
let r = calcularBusqueda({ ...base, servicios: ['Depilación'], modo: 'realizo', periodo: { meses: ['2026-09', '2026-10', '2026-11'] } });
check('pacientes que hicieron Depilación: A y C', r.pacientes.map(p => p.dni).join() === '1,3');
check('4 sesiones de Depilación (sep–nov)', r.totalSesiones === 4);
check('desglose mes a mes: sep 1, oct 2, nov 1', JSON.stringify(r.porMes) === JSON.stringify([['2026-09', 1], ['2026-10', 2], ['2026-11', 1]]), r.porMes);
check('NO mezcla otros servicios en las sesiones', r.sesiones.every(s => s.r.servicio === 'Depilación'));
check('importe acumulado de las sesiones con precio (4 × 20)', r.importe === 80 && r.sesionesConPrecio === 4);
check('activos/inactivos (C inactiva)', r.porEstado.activo === 1 && r.porEstado.inactivo === 1);
check('sin servicios elegidos = todos los servicios', calcularBusqueda({ ...base, servicios: [], modo: 'realizo', periodo: { meses: ['2026-11'] } }).totalSesiones === 3);
check('turnos futuros excluidos por defecto (D 20/11)', !calcularBusqueda({ ...base, servicios: ['Jornada Doc'], modo: 'realizo', periodo: { meses: ['2026-11'] } }).totalSesiones);
check('… e incluidos si se pide', calcularBusqueda({ ...base, servicios: ['Jornada Doc'], modo: 'realizo', periodo: { meses: ['2026-11'] }, futuros: true }).totalSesiones === 1);

console.log('\n=== Exclusivo ("Solo de…") ===');
r = calcularBusqueda({ ...base, servicios: ['Depilación'], modo: 'exclusivo', periodo: per('2026-01-01', '2026-12-31') });
check('solo A es exclusiva de Depilación (C también hizo Jornada Doc)', r.pacientes.map(p => p.dni).join() === '1');
r = calcularBusqueda({ ...base, servicios: ['Jornada Doc'], modo: 'exclusivo', periodo: per('2026-01-01', '2026-12-31') });
check('solo D es exclusiva de Jornada Doc', r.pacientes.map(p => p.dni).join() === '4');
check('exclusivo sin servicio elegido no devuelve nada', !calcularBusqueda({ ...base, servicios: [], modo: 'exclusivo', periodo: per('2026-01-01', '2026-12-31') }).pacientes.length);

console.log('\n=== Ingresó con este servicio ===');
r = calcularBusqueda({ ...base, servicios: ['Consulta Inicial'], modo: 'ingreso', periodo: { meses: ['2026-11'] } });
check('sumados en noviembre con Consulta Inicial: B', r.pacientes.map(p => p.dni).join() === '2' && r.nuevos.length === 1);
check('A (Depilación desde septiembre) no es alta de noviembre', !calcularBusqueda({ ...base, servicios: ['Depilación'], modo: 'ingreso', periodo: { meses: ['2026-11'] } }).pacientes.length);
check('D se sumó en octubre con Jornada Doc', calcularBusqueda({ ...base, servicios: ['Jornada Doc'], modo: 'ingreso', periodo: { meses: ['2026-10'] } }).pacientes.map(p => p.dni).join() === '4');

console.log('\n=== Estado del paciente ===');
r = calcularBusqueda({ ...base, servicios: ['Depilación'], modo: 'realizo', periodo: per('2026-01-01', '2026-12-31'), estado: 'inactivo' });
check('filtro inactivos deja solo a C y solo sus sesiones', r.pacientes.map(p => p.dni).join() === '3' && r.totalSesiones === 1);

console.log('\n=== Títulos de reporte ===');
check('exclusivo', tituloBusqueda({ servicios: ['Depilación'], modo: 'exclusivo', periodo: {} }).titulo === 'Reporte Exclusivo: Depilación');
check('ingreso', tituloBusqueda({ servicios: ['Consulta Inicial'], modo: 'ingreso', periodo: { meses: ['2026-11'] } }).titulo === 'Pacientes sumados en noviembre 2026 — Consulta Inicial');
check('realizó con varios meses', /Septiembre|septiembre 2026 – noviembre 2026/.test(tituloBusqueda({ servicios: [], modo: 'realizo', periodo: { meses: ['2026-09', '2026-10', '2026-11'] } }).periodo));

console.log('\n=== Duplicados ===');
check('nombre sin tildes, mayúsculas, espacios ni orden', claveNombre('Pérez   ANA') === claveNombre('ana perez'));
check('nombre de una sola palabra no agrupa (evita falsos positivos)', claveNombre('Ana') === '');
check('teléfono: últimos 8 dígitos (con o sin 549)', claveTelefono('+54 9 3764 111222') === claveTelefono('3764111222'));
const g = agruparDuplicados([
  { dni: '1', fullName: 'Ana Pérez', phone: '3764000001' },
  { dni: '9', fullName: 'Perez Ana', phone: '' },
  { dni: '2', fullName: 'Laura Ruiz', phone: '3764111222' },
  { dni: '7', fullName: 'Laura R.', phone: '549 3764 111222' },
  { dni: '3', fullName: 'Marta Sosa', phone: '3764999999' },
]);
check('2 grupos (Ana por nombre invertido, Laura por teléfono)', g.length === 2, g.map(x => x.miembros.map(m => m.dni)));
check('motivos informados', g.some(x => x.motivos.has('nombre')) && g.some(x => x.motivos.has('teléfono')));
check('Marta (única) no aparece', !g.some(x => x.miembros.some(m => m.dni === '3')));

console.log('\n' + '='.repeat(60));
console.log(fails ? fails + ' prueba(s) fallaron' : 'TODAS LAS PRUEBAS DEL BUSCADOR AVANZADO OK');
process.exit(fails ? 1 : 0);
